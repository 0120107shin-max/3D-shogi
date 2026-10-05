// usi-engine.js - ブラウザ内で動く「やねうら王」(WebAssembly 版) を USI プロトコルで操作するラッパー
//
// エンジン本体: YaneuraOu (GPLv3) / WebAssembly 移植: YaneuraOu.wasm (Mizar 氏)
// 評価関数: 水匠Petite (NNUE K-P, エンジンに内蔵)
// SharedArrayBuffer を使うため、ページがクロスオリジン分離 (COOP/COEP) されている必要がある。
// GitHub Pages ではヘッダーを設定できないため coi-serviceworker.js で付与している。

const ENGINE_SCRIPT = 'vendor/yaneuraou/yaneuraou.k-p.js';
const ENGINE_GLOBAL = 'YaneuraOu_K_P';

// WebAssembly SIMD 対応判定 (wasm-feature-detect と同じ最小モジュール)
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export class YaneuraOuEngine {
  constructor() {
    this.module = null;
    this.state = 'idle'; // idle | loading | ready | error | unsupported
    this.error = null;
    this.loadPromise = null;
    this.waiters = [];       // { prefix, resolve }
    this.lastScore = null;
    this.searching = null;   // 探索中の Promise
    this.onStateChange = null;
  }

  // このブラウザで動作可能か。不可ならその理由を返す。
  static unsupportedReason() {
    if (typeof WebAssembly !== 'object') return 'WebAssembly に対応していません';
    if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) {
      return 'クロスオリジン分離が有効になっていません（ページを再読み込みしてください）';
    }
    try {
      if (!WebAssembly.validate(SIMD_TEST)) return 'WebAssembly SIMD に対応していません';
    } catch (e) {
      return 'WebAssembly SIMD に対応していません';
    }
    return null;
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    if (this.onStateChange) this.onStateChange(state, error);
  }

  load() {
    if (this.loadPromise) return this.loadPromise;
    const reason = YaneuraOuEngine.unsupportedReason();
    if (reason) {
      this.setState('unsupported', reason);
      this.loadPromise = Promise.reject(new Error(reason));
      this.loadPromise.catch(() => {});
      return this.loadPromise;
    }

    this.setState('loading');
    this.loadPromise = (async () => {
      await loadScript(ENGINE_SCRIPT);
      const factory = window[ENGINE_GLOBAL];
      if (typeof factory !== 'function') throw new Error('エンジンの読み込みに失敗しました');
      this.module = await factory();
      this.module.addMessageListener((line) => this.onLine(line));

      await this.command('usi', 'usiok');
      const threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      this.send(`setoption name Threads value ${threads}`);
      this.send('setoption name USI_Hash value 64');
      this.send('setoption name PvInterval value 0');
      this.send('setoption name ConsiderationMode value false');
      this.send('setoption name NetworkDelay value 0');
      this.send('setoption name NetworkDelay2 value 0');
      this.send('setoption name MinimumThinkingTime value 100');
      await this.command('isready', 'readyok');
      this.setState('ready');
    })().catch((e) => {
      this.setState('error', e.message || String(e));
      throw e;
    });
    return this.loadPromise;
  }

  send(cmd) {
    this.module.postMessage(cmd);
  }

  // コマンドを送り、prefix で始まる応答行を待つ
  command(cmd, prefix, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const waiter = { prefix, resolve };
      this.waiters.push(waiter);
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== waiter);
        reject(new Error(`エンジンが応答しません (${cmd})`));
      }, timeoutMs);
      waiter.resolve = (line) => { clearTimeout(timer); resolve(line); };
      this.send(cmd);
    });
  }

  onLine(line) {
    if (line.startsWith('info') && line.includes(' score ')) {
      const m = /score (cp|mate) (-?\d+)/.exec(line);
      if (m) this.lastScore = { type: m[1], value: parseInt(m[2], 10) };
    }
    const idx = this.waiters.findIndex(w => line.startsWith(w.prefix));
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1);
      w.resolve(line);
    }
  }

  // 新しい対局の準備。options: { skillLevel, enteringKingRule }
  async newGame(options = {}) {
    await this.load();
    await this.stop();
    if (options.skillLevel !== undefined) this.send(`setoption name SkillLevel value ${options.skillLevel}`);
    if (options.enteringKingRule) this.send(`setoption name EnteringKingRule value ${options.enteringKingRule}`);
    await this.command('isready', 'readyok');
    this.send('usinewgame');
  }

  // 局面 (USI position コマンド) と go コマンドを渡して最善手を得る。
  // 戻り値: { bestmove: '7g7f' | 'resign' | 'win', score }
  async think(positionCmd, goCmd) {
    await this.load();
    await this.stop();
    this.lastScore = null;
    this.send(positionCmd);
    this.searching = this.command(goCmd, 'bestmove', 600000).then((line) => {
      this.searching = null;
      const parts = line.split(/\s+/);
      return { bestmove: parts[1], score: this.lastScore };
    });
    return this.searching;
  }

  // 探索中なら中断して bestmove を待つ（結果は呼び出し側で破棄する）
  async stop() {
    if (!this.searching) return;
    const pending = this.searching;
    this.send('stop');
    try { await pending; } catch (e) { /* noop */ }
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
    document.head.appendChild(s);
  });
}

// 強さ設定（SkillLevel は 0〜20、低レベルは探索ノード数も制限して手加減する）
export const ENGINE_LEVELS = {
  1: { label: '入門', skill: 0, nodes: 800 },
  2: { label: '初級', skill: 3, nodes: 4000 },
  3: { label: '中級', skill: 7, nodes: 25000 },
  4: { label: '上級', skill: 12, nodes: 150000 },
  5: { label: '有段', skill: 20, movetime: 1000 },
  6: { label: '最強', skill: 20, movetime: 3000 }
};
