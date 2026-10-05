// app.js - Main Controller for 3D Shogi Application

import { ShogiEngine, SENTE, GOTE, PIECE_NAMES } from './shogi-engine.js';
import { Shogi3DView } from './3d-view.js?v=20261005_engine1';
import { sounds } from './sound.js';
import { P2PManager } from './p2p-manager.js';
import { YaneuraOuEngine, ENGINE_LEVELS } from './usi-engine.js';
import {
  moveToDisplay, exportKif, parseKifuText, decodeKifuBuffer, buildEngineFromRecord, HANDICAP_KIF_NAMES
} from './kifu.js';

const SIDEBAR_COLLAPSED_KEY = 'shogi3d_sidebar_collapsed';
const KIFU_HISTORY_KEY = 'shogi3d_kifu_history';
const SETTINGS_KEY = 'shogi3d_settings';
const KIFU_HISTORY_MAX = 200; // 保存件数の上限（無制限増加によるlocalStorage圧迫を防ぐ）

const MODE_LABELS = { local: '対人 (ローカル)', cpu: 'CPU戦', p2p: 'オンライン (P2P)' };
const HANDICAP_LABELS = HANDICAP_KIF_NAMES;

class ShogiApp {
  constructor() {
    this.engine = new ShogiEngine();
    this.view = null;
    this.p2p = null;
    this.aiWorker = null;
    this.usiEngine = new YaneuraOuEngine();

    this.mode = 'local'; // 'local' | 'cpu' | 'p2p'
    this.cpuLevel = 3;
    this.myRole = SENTE; // 自分の手番 (CPU戦: プレイヤーの手番 / P2P戦: 自分の役割)
    this.cpuSide = GOTE; // CPU戦の場合のみ意味を持つ、CPU側の手番
    this.gameStarted = false; // 一度でも対局が開始されたか（設定モーダルの「戻る」表示用）
    this.gameSaved = false;   // 現在の対局を履歴へ保存済みか
    this.gameMeta = { startDate: null, senteName: '', goteName: '' };

    this.selectedSquare = null;
    this.selectedHandPiece = null;
    this.pendingMove = null;
    this.searchToken = 0;      // CPU 思考のキャンセル判定用（待った・新規対局で古い結果を捨てる）
    this.cpuThinking = false;
    this.pendingStart = null;  // 読み込んだ棋譜の途中局面から開始する場合 { record, ply }
    this.replay = null;        // 棋譜再生中 { record, ply, title, meta }
    this.viewingKifuId = null; // 棋譜履歴モーダルで詳細表示中のレコードID
    this.kifuHistoryOpenedFromSetup = false; // 対局設定モーダル経由で棋譜履歴を開いたか（閉じた際の戻り先判定用）

    // タイマー管理
    this.timerInterval = null;
    this.timeSettings = {
      [SENTE]: { mainSec: 300, byoyomiSec: 20 },
      [GOTE]: { mainSec: 300, byoyomiSec: 20 }
    };
    this.currentTimers = {
      [SENTE]: { mainSec: 300, byoyomiSec: 20, inByoyomi: false },
      [GOTE]: { mainSec: 300, byoyomiSec: 20, inByoyomi: false }
    };

    this.initUI();
    this.initSidebarToggle();
    this.init3D();
    this.initAIWorker();
    this.initEngineStatus();
  }

  // サイドバー（対局履歴パネル）の開閉。状態はlocalStorageに保存し次回起動時も維持する。
  initSidebarToggle() {
    const uiLayer = document.getElementById('ui-layer');
    const btn = document.getElementById('btn-sidebar-toggle');

    const applyState = (collapsed) => {
      uiLayer.classList.toggle('sidebar-collapsed', collapsed);
      btn.textContent = collapsed ? '«' : '»';
      btn.title = collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる';
    };

    let collapsed = false;
    try {
      collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch (e) { /* noop */ }
    applyState(collapsed);

    btn.addEventListener('click', () => {
      collapsed = !collapsed;
      applyState(collapsed);
      setTimeout(() => this.view.refit(), 300); // 開閉アニメーション後に盤の表示範囲を合わせ直す
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
      } catch (e) { /* noop */ }
    });
  }

  initUI() {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

    // 1. UI Buttons & Event Listeners
    on('btn-new-game', () => this.openSetupModal());
    on('btn-start-game', () => this.startNewGame());
    on('btn-setup-cancel', () => this.hideModal('modal-setup'));

    on('btn-camera-cycle', () => this.view.cycleCameraView());
    on('btn-camera-reset', () => this.view.setCameraPerspective(this.myRole));
    on('btn-camera-flip', () => this.view.togglePerspective());
    on('btn-resign', () => this.resign());
    on('btn-undo', () => this.undo());
    on('btn-declare', () => this.declareByPlayer());

    // 成りダイアログ
    on('btn-nari-yes', () => this.handleNariChoice(true));
    on('btn-nari-no', () => this.handleNariChoice(false));
    on('btn-nari-cancel', () => {
      this.hideModal('modal-nari');
      this.pendingMove = null;
      this.clearSelection();
    });

    // 結果モーダル：盤面確認 / 再対局
    on('btn-result-close', () => this.hideModal('modal-result'));
    on('btn-result-restart', () => {
      this.hideModal('modal-result');
      this.openSetupModal();
    });

    // モード切替ラジオ
    const modeBtns = document.querySelectorAll('#mode-selector .btn-option');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        this.updateModeOptionsUI();
        // CPU戦を選んだ時点でエンジンの読み込みを始めておく（対局開始時の待ち時間を減らす）
        if (this.mode === 'cpu') this.usiEngine.load().catch(() => {});
      });
    });

    // 手番（先手/後手）選択：CPU戦でどちらの手番を持つか
    const sideBtns = document.querySelectorAll('#side-selector .btn-option');
    sideBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        sideBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.myRole = btn.dataset.side === 'gote' ? GOTE : SENTE;
      });
    });

    // タイムプリセット切替
    document.getElementById('time-preset-select').addEventListener('change', (e) => {
      document.getElementById('custom-time-box').classList.toggle('hidden', e.target.value !== 'custom');
    });

    // P2P UI
    on('btn-p2p-host', () => this.startP2PHost());
    on('btn-p2p-join-modal', () => this.showP2PJoinUI());
    on('btn-connect-peer', () => this.connectP2PPeer());
    on('btn-close-p2p', () => {
      // 接続試行中だった場合は破棄してから設定画面に戻る
      if (this.p2p) {
        this.p2p.destroy?.();
        this.p2p = null;
      }
      this.hideModal('modal-p2p');
      this.openSetupModal();
    });
    on('btn-copy-peer-id', () => this.copyText(document.getElementById('my-peer-id').value, '対戦IDをコピーしました！'));

    // 棋譜履歴モーダル（サイドバーから／対局設定モーダルからの両方に対応）
    on('btn-kifu-history', () => this.openKifuHistoryModal(false));
    on('btn-setup-kifu-history', () => this.openKifuHistoryModal(true));
    on('btn-kifu-history-close', () => {
      this.hideModal('modal-kifu-history');
      if (this.kifuHistoryOpenedFromSetup) {
        this.kifuHistoryOpenedFromSetup = false;
        this.openSetupModal();
      }
    });
    on('btn-kifu-history-clear', () => {
      if (this.loadKifuHistory().length === 0) return;
      if (confirm('保存されたすべての棋譜を削除します。よろしいですか？')) {
        try { localStorage.removeItem(KIFU_HISTORY_KEY); } catch (e) { /* noop */ }
        this.renderKifuHistoryList();
      }
    });
    on('btn-kifu-detail-back', () => this.showKifuHistoryListPane());
    on('btn-kifu-detail-delete', () => {
      if (!this.viewingKifuId) return;
      if (confirm('この棋譜を削除しますか？')) {
        this.deleteKifuRecord(this.viewingKifuId);
        this.showKifuHistoryListPane();
      }
    });
    on('btn-kifu-detail-replay', () => this.replaySavedRecord(this.viewingKifuId));
    on('btn-kifu-detail-download', () => {
      const record = this.loadKifuHistory().find(r => r.id === this.viewingKifuId);
      if (record?.kif) this.downloadText(record.kif, this.kifFileName(new Date(record.savedAt)));
    });

    // 棋譜の出力・読み込み
    on('btn-kifu-export', () => this.openExportModal());
    on('btn-kifu-import', () => this.openImportModal());
    on('btn-export-close', () => this.hideModal('modal-export'));
    on('btn-export-download', () => this.downloadText(document.getElementById('export-kif').value, this.kifFileName(new Date())));
    on('btn-export-copy-kif', () => this.copyText(document.getElementById('export-kif').value, 'KIFをコピーしました'));
    on('btn-export-copy-sfen', () => this.copyText(document.getElementById('export-sfen').value, 'SFENをコピーしました'));
    on('btn-export-copy-usi', () => this.copyText(document.getElementById('export-usi').value, 'USI position をコピーしました'));
    on('btn-import-close', () => {
      this.hideModal('modal-import');
      if (this.importOpenedFromSetup) this.openSetupModal();
      this.importOpenedFromSetup = false;
    });
    on('btn-setup-kifu-import', () => this.openImportModal(true));
    on('btn-import-load', () => this.importFromText(document.getElementById('import-text').value));
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = decodeKifuBuffer(await file.arrayBuffer());
      document.getElementById('import-text').value = text;
      this.importFromText(text, file.name);
    });

    // 棋譜再生バー
    on('btn-replay-first', () => this.setReplayPly(0));
    on('btn-replay-prev', () => this.setReplayPly(this.replay.ply - 1));
    on('btn-replay-next', () => this.setReplayPly(this.replay.ply + 1));
    on('btn-replay-last', () => this.setReplayPly(this.replay.record.moves.length));
    document.getElementById('replay-slider').addEventListener('input', (e) => this.setReplayPly(parseInt(e.target.value, 10)));
    on('btn-replay-close', () => this.exitReplay());
    on('btn-replay-export', () => this.openExportModal());
    on('btn-replay-play-from', () => {
      this.pendingStart = { record: this.replay.record, ply: this.replay.ply };
      this.exitReplay();
      this.openSetupModal();
    });
    document.addEventListener('keydown', (e) => {
      if (!this.replay || e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') this.setReplayPly(this.replay.ply - 1);
      if (e.key === 'ArrowRight') this.setReplayPly(this.replay.ply + 1);
    });

    // 結果モーダルからの KIF 保存・待った
    on('btn-result-kif', () => this.downloadText(this.currentKif(), this.kifFileName(new Date())));
    on('btn-result-undo', () => this.undo());
    on('btn-help', () => this.showModal('modal-about'));

    // Esc: 駒の選択解除／手前のモーダルを閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const closable = ['modal-about', 'modal-export', 'modal-import', 'modal-nari', 'modal-result', 'modal-kifu-history'];
      const open = closable.find(id => document.getElementById(id).classList.contains('active'));
      if (open === 'modal-nari') document.getElementById('btn-nari-cancel').click();
      else if (open === 'modal-kifu-history') document.getElementById('btn-kifu-history-close').click();
      else if (open === 'modal-import') document.getElementById('btn-import-close').click();
      else if (open) this.hideModal(open);
      else if (document.getElementById('modal-setup').classList.contains('active') && this.gameStarted && !this.engine.isGameOver) this.hideModal('modal-setup');
      else this.clearSelection();
    });

    this.restoreSettings();

    on('btn-clear-start-position', () => {
      this.pendingStart = null;
      this.updateStartPositionUI();
    });

    // このサイトについて
    document.getElementById('link-about').addEventListener('click', (e) => {
      e.preventDefault();
      this.showModal('modal-about');
    });
    on('btn-about-close', () => this.hideModal('modal-about'));
  }

  updateModeOptionsUI() {
    document.querySelectorAll('.mode-option').forEach(el => el.classList.add('hidden'));

    if (this.mode === 'cpu') {
      document.querySelectorAll('.cpu-only').forEach(el => el.classList.remove('hidden'));
    } else if (this.mode === 'p2p') {
      document.querySelectorAll('.p2p-only').forEach(el => el.classList.remove('hidden'));
    }
  }

  init3D() {
    this.view = new Shogi3DView(
      'canvas-container',
      (y, x) => this.onSquareClick(y, x),
      (type, owner) => this.onHandPieceClick(type, owner)
    );
  }

  // 予備の簡易AI（やねうら王が動かない環境向け）
  initAIWorker() {
    this.aiWorker = new Worker('js/ai-worker.js', { type: 'module' });
    this.aiWorkerResolve = null;
    this.aiWorker.onmessage = (e) => {
      const resolve = this.aiWorkerResolve;
      this.aiWorkerResolve = null;
      if (resolve) resolve(e.data);
    };
  }

  initEngineStatus() {
    const el = document.getElementById('engine-status');
    const render = (state, error) => {
      const texts = {
        idle: 'CPU エンジン: やねうら王 (WebAssembly)',
        loading: 'CPU エンジン: やねうら王を読み込み中…',
        ready: 'CPU エンジン: やねうら王 準備完了 ✓',
        unsupported: `CPU エンジン: このブラウザではやねうら王を使えないため簡易AIで対局します（${error}）`,
        error: `CPU エンジン: やねうら王の起動に失敗したため簡易AIで対局します（${error}）`
      };
      el.textContent = texts[state] || '';
      el.classList.toggle('warn', state === 'unsupported' || state === 'error');
    };
    this.usiEngine.onStateChange = render;
    render(this.usiEngine.state);
  }

  // 前回の対局設定を復元する
  restoreSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { /* noop */ }
    if (!saved) return;
    const setVal = (id, v) => { if (v !== undefined && v !== null) document.getElementById(id).value = v; };
    setVal('cpu-level', saved.cpuLevel);
    setVal('handicap-select', saved.handicap);
    setVal('time-preset-select', saved.timePreset);
    for (const id of ['sente-min', 'sente-sec', 'gote-min', 'gote-sec']) setVal(id, saved[id]);
    document.getElementById('custom-time-box').classList.toggle('hidden', saved.timePreset !== 'custom');
    if (saved.mode && saved.mode !== 'p2p') document.querySelector(`#mode-selector [data-mode="${saved.mode}"]`)?.click();
    if (saved.side) document.querySelector(`#side-selector [data-side="${saved.side}"]`)?.click();
  }

  saveSettings() {
    const saved = {
      mode: this.mode,
      side: this.myRole === GOTE ? 'gote' : 'sente',
      cpuLevel: document.getElementById('cpu-level').value,
      handicap: document.getElementById('handicap-select').value,
      timePreset: document.getElementById('time-preset-select').value
    };
    for (const id of ['sente-min', 'sente-sec', 'gote-min', 'gote-sec']) saved[id] = document.getElementById(id).value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved)); } catch (e) { /* noop */ }
  }

  // 対局設定モーダルの入力内容を集める（P2P ではホストの設定をゲストへ送る）
  gatherSettings() {
    const settings = {
      handicap: document.getElementById('handicap-select').value,
      timeSettings: this.computeTimeSettings(document.getElementById('time-preset-select').value),
      start: null
    };
    if (this.pendingStart) {
      const { record, ply } = this.pendingStart;
      const eng = buildEngineFromRecord(record, ply);
      settings.start = { initialSfen: record.initialSfen, handicap: record.handicap || 'hirate', moves: eng.history.map(h => ShogiEngine.moveToUsi(h)) };
    }
    return settings;
  }

  // 新規対局の開始
  async startNewGame(settings = null) {
    sounds.init(); // ユーザー操作のタイミングで AudioContext を初期化
    if (this.replay) this.exitReplay();
    if (!settings) {
      settings = this.gatherSettings();
      this.saveSettings();
    }
    this.cpuLevel = parseInt(document.getElementById('cpu-level').value, 10) || 3;

    // 手番の決定: CPU戦は手番セレクタ、P2P戦は既にmyRole設定済み、対人ローカルは常に先手視点
    if (this.mode !== 'cpu' && this.mode !== 'p2p') {
      this.myRole = SENTE;
    }
    this.cpuSide = -this.myRole;

    // 進行中の思考を破棄
    this.cancelThinking();
    if (this.timerInterval) clearInterval(this.timerInterval);

    // 時間設定
    this.timeSettings = settings.timeSettings;
    this.resetTimersState();

    // エンジンリセット（読み込んだ棋譜の途中局面から始める場合はその局面まで進める）
    if (settings.start) {
      this.engine.loadSfen(settings.start.initialSfen, settings.start.handicap);
      for (const usi of settings.start.moves) {
        const mv = ShogiEngine.usiToMove(usi);
        this.engine.makeMove(mv.from, mv.to, mv.promote, mv.isDrop, mv.dropPieceType);
      }
      if (this.engine.isGameOver) {
        alert('この局面は既に終局しています。別の局面を選んでください。');
        return;
      }
    } else {
      this.engine.reset(settings.handicap);
    }
    this.pendingStart = null;
    this.updateStartPositionUI();
    this.selectedSquare = null;
    this.selectedHandPiece = null;
    this.gameSaved = false;

    // UI & 3Dビュー更新
    this.view.updateBoardState(this.engine);
    this.view.clearHighlights();
    this.view.setLastMove(this.engine.history.at(-1)?.to || null);
    this.view.setCameraPerspective(this.myRole);
    this.hideModal('modal-setup');
    this.hideModal('modal-result');
    this.renderKifuList();
    this.setEvalDisplay(null);

    // プレイヤー名表示の更新
    const names = { [SENTE]: '', [GOTE]: '' };
    if (this.mode === 'cpu') {
      const engineName = this.usiEngine.state === 'unsupported' || this.usiEngine.state === 'error' ? '簡易AI' : 'やねうら王';
      names[this.cpuSide] = `${engineName} Lv.${this.cpuLevel} ${ENGINE_LEVELS[this.cpuLevel].label}`;
      names[this.myRole] = 'あなた';
    } else if (this.mode === 'p2p') {
      names[this.myRole] = 'あなた';
      names[-this.myRole] = '対戦相手';
    } else {
      names[SENTE] = '先手 プレイヤー';
      names[GOTE] = '後手 プレイヤー';
    }
    document.getElementById('sente-name').textContent = names[SENTE];
    document.getElementById('gote-name').textContent = names[GOTE];
    this.gameMeta = { startDate: new Date().toISOString(), senteName: names[SENTE], goteName: names[GOTE] };

    this.gameStarted = true;
    this.updateStatusUI();
    this.updateActionButtons();

    // CPU戦: やねうら王の準備（初回は読み込みに数秒かかる）
    if (this.mode === 'cpu') {
      await this.prepareCpuEngine();
    }

    // タイマー開始
    this.startTimers();
    this.updateStatusUI();

    // 駒落ちハンデ戦などでCPU側（上手）が初手を持つ場合、ここで着手させる
    this.maybeTriggerCPU();
  }

  async prepareCpuEngine() {
    if (this.usiEngine.state === 'unsupported') return;
    const indicator = document.getElementById('turn-indicator');
    const startBtn = document.getElementById('btn-start-game');
    try {
      if (this.usiEngine.state !== 'ready') indicator.textContent = 'やねうら王を準備中…';
      startBtn.disabled = true;
      await this.usiEngine.newGame({
        skillLevel: ENGINE_LEVELS[this.cpuLevel].skill,
        enteringKingRule: this.engine.handicap === 'hirate' ? 'CSARule24' : 'CSARule24H'
      });
    } catch (e) {
      console.warn('やねうら王を使えないため簡易AIで対局します', e);
      const nameEl = document.getElementById(this.cpuSide === GOTE ? 'gote-name' : 'sente-name');
      nameEl.textContent = nameEl.textContent.replace('やねうら王', '簡易AI');
    } finally {
      startBtn.disabled = false;
    }
  }

  // ===== CPU 思考 =====

  // CPUの手番であれば思考させる（対局開始直後の駒落ち初手にも対応）
  maybeTriggerCPU() {
    if (this.mode !== 'cpu' || this.engine.isGameOver || this.replay) return;
    if (this.engine.turn !== this.cpuSide) return;
    if (this.cpuThinking) return;

    const token = ++this.searchToken;
    this.cpuThinking = true;
    this.updateStatusUI();
    this.updateActionButtons();

    this.thinkCpuMove().then((result) => {
      if (token !== this.searchToken) return; // 待った・新規対局などで無効になった結果
      this.cpuThinking = false;
      this.applyCpuResult(result);
    }).catch((e) => {
      if (token !== this.searchToken) return;
      this.cpuThinking = false;
      console.error(e);
      this.updateStatusUI();
    });
  }

  async thinkCpuMove() {
    const started = performance.now();
    let result = null;
    if (this.usiEngine.state === 'ready') {
      try {
        result = await this.usiEngine.think(this.engine.toUsiPosition(), this.buildGoCommand());
      } catch (e) {
        console.warn('やねうら王の思考に失敗したため簡易AIで指します', e);
      }
    }
    if (!result) result = await this.thinkWithFallbackAI();

    // 一瞬で指されると何が起きたか分かりにくいので最低限の間を置く
    const elapsed = performance.now() - started;
    if (elapsed < 350) await new Promise(r => setTimeout(r, 350 - elapsed));
    return result;
  }

  // 持ち時間に収まるよう思考時間を決める
  buildGoCommand() {
    const lv = ENGINE_LEVELS[this.cpuLevel];
    if (lv.nodes) return `go nodes ${lv.nodes}`;
    const t = this.currentTimers[this.cpuSide];
    const byoyomiMs = this.timeSettings[this.cpuSide].byoyomiSec * 1000;
    const available = t.inByoyomi ? t.byoyomiSec * 1000 : t.mainSec * 1000 / 10 + byoyomiMs;
    const movetime = Math.max(200, Math.min(lv.movetime, available - 1500));
    return `go movetime ${Math.floor(movetime)}`;
  }

  thinkWithFallbackAI() {
    return new Promise((resolve) => {
      this.aiWorkerResolve = (move) => resolve({ move, score: null });
      this.aiWorker.postMessage({
        board: this.engine.board,
        hands: this.engine.hands,
        turn: this.cpuSide,
        level: Math.min(3, Math.ceil(this.cpuLevel / 2))
      });
    });
  }

  applyCpuResult(result) {
    if (result.bestmove === 'resign') {
      this.engine.setGameOver(this.myRole, '投了');
      this.finishGame('CPUが投了しました。あなたの勝ちです！');
      return;
    }
    if (result.bestmove === 'win') {
      const ev = this.engine.declare(this.cpuSide);
      if (ev && ev.result !== 'invalid') {
        this.finishGame(this.declarationMessage(this.cpuSide, ev));
        return;
      }
    }

    let move = result.move || null;
    if (result.bestmove && !move) move = ShogiEngine.usiToMove(result.bestmove);
    if (!move || !this.engine.isLegalMove(move)) {
      // 想定外の応答（または宣言不成立）時は合法手から簡易AIで指し直す
      console.warn('CPUの指し手が不正なため簡易AIで指し直します', result);
      const token = ++this.searchToken;
      this.cpuThinking = true;
      this.thinkWithFallbackAI().then((r) => {
        if (token !== this.searchToken) return;
        this.cpuThinking = false;
        if (r.move && this.engine.isLegalMove(r.move)) this.executeMove(r.move);
      });
      return;
    }

    if (result.score) this.setEvalDisplay(result.score, this.cpuSide);
    this.executeMove(move);
  }

  cancelThinking() {
    this.searchToken++;
    this.cpuThinking = false;
    if (this.usiEngine.state === 'ready') this.usiEngine.stop();
  }

  // 評価値表示（エンジン視点の値を先手視点に直して表示）
  setEvalDisplay(score, side) {
    const el = document.getElementById('eval-display');
    if (!score) {
      el.classList.add('hidden');
      return;
    }
    const sign = side === SENTE ? 1 : -1;
    let text;
    if (score.type === 'mate') {
      const v = score.value * sign;
      text = v > 0 ? `先手勝ち（${Math.abs(score.value)}手詰）` : `後手勝ち（${Math.abs(score.value)}手詰）`;
    } else {
      const v = score.value * sign;
      text = `${v >= 0 ? '+' : ''}${v}`;
    }
    el.textContent = `やねうら王の形勢判断（先手視点）: ${text}`;
    el.classList.remove('hidden');
  }

  // ===== 時間 =====

  computeTimeSettings(preset) {
    let mainSec = 300;
    let byoyomiSec = 20;

    if (preset === 'hayazashi') {
      mainSec = 60; byoyomiSec = 10;
    } else if (preset === 'jikkuri') {
      mainSec = 600; byoyomiSec = 30;
    } else if (preset === 'custom') {
      const num = (id, def) => {
        const v = parseInt(document.getElementById(id).value, 10);
        return Number.isFinite(v) && v >= 0 ? v : def;
      };
      const sMain = num('sente-min', 5) * 60;
      const sByo = num('sente-sec', 20);
      const gMain = num('gote-min', 5) * 60;
      const gByo = num('gote-sec', 20);
      return {
        [SENTE]: { mainSec: sMain, byoyomiSec: sMain + sByo > 0 ? sByo : 10 },
        [GOTE]: { mainSec: gMain, byoyomiSec: gMain + gByo > 0 ? gByo : 10 }
      };
    }
    return { [SENTE]: { mainSec, byoyomiSec }, [GOTE]: { mainSec, byoyomiSec } };
  }

  resetTimersState() {
    for (const side of [SENTE, GOTE]) {
      this.currentTimers[side] = {
        mainSec: this.timeSettings[side].mainSec,
        byoyomiSec: this.timeSettings[side].byoyomiSec,
        inByoyomi: this.timeSettings[side].mainSec === 0
      };
    }
    this.updateTimerDisplays();
  }

  startTimers() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      if (this.engine.isGameOver) {
        clearInterval(this.timerInterval);
        return;
      }

      const turn = this.engine.turn;
      const timer = this.currentTimers[turn];

      if (!timer.inByoyomi) {
        if (timer.mainSec > 0) {
          timer.mainSec--;
        } else {
          timer.inByoyomi = true;
          sounds.playBeep(true);
        }
      } else {
        if (timer.byoyomiSec > 0) {
          timer.byoyomiSec--;
          if (timer.byoyomiSec <= 5) sounds.playBeep(true);
        } else {
          // 時間切れ負け
          this.handleTimeOut(turn);
        }
      }

      this.updateTimerDisplays();
    }, 1000);
  }

  handleTimeOut(loserOwner) {
    this.engine.setGameOver(-loserOwner, '時間切れ');
    const winnerText = this.engine.winner === SENTE ? '先手の勝利' : '後手の勝利';
    this.finishGame(`時間切れ！${winnerText}です。`);
  }

  updateTimerDisplays() {
    const formatTime = (totalSec) => {
      const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const s = (totalSec % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    };

    for (const [side, prefix] of [[SENTE, 'sente'], [GOTE, 'gote']]) {
      const t = this.currentTimers[side];
      document.getElementById(`${prefix}-main-time`).textContent = formatTime(t.mainSec);
      document.getElementById(`${prefix}-byoyomi`).textContent = t.inByoyomi
        ? `秒読み ${t.byoyomiSec}秒`
        : `秒読み ${this.timeSettings[side].byoyomiSec}秒`;
      document.getElementById(`${prefix}-panel`).classList.toggle('warning', t.inByoyomi && t.byoyomiSec <= 5 && !this.engine.isGameOver);
    }
  }

  // ===== 盤面操作 =====

  isHumanTurn() {
    if (this.engine.isGameOver || this.replay || !this.gameStarted) return false;
    if (this.mode === 'p2p' || this.mode === 'cpu') return this.engine.turn === this.myRole && !this.cpuThinking;
    return true;
  }

  // マスクリックイベント (3D盤面)
  onSquareClick(y, x) {
    // P2P対戦・CPU対戦で自分の手番でない場合は無視（CPU思考中にCPUの駒を操作させない）
    if (!this.isHumanTurn()) return;

    // 1. 持ち駒を選択中の場合 -> 打駒
    if (this.selectedHandPiece) {
      const drops = this.engine.getLegalDrops(this.selectedHandPiece);
      if (drops.some(d => d.y === y && d.x === x)) {
        this.executeMove({ from: null, to: { y, x }, promote: false, isDrop: true, dropPieceType: this.selectedHandPiece });
      }
      this.clearSelection();
      return;
    }

    const clickedPiece = this.engine.board[y][x];

    // 2. 自分の駒を選択
    if (clickedPiece && clickedPiece.owner === this.engine.turn) {
      // 選択中の駒をもう一度押したら選択解除
      if (this.selectedSquare && this.selectedSquare.y === y && this.selectedSquare.x === x) {
        this.clearSelection();
        return;
      }
      this.selectedSquare = { y, x };
      this.selectedHandPiece = null;
      const legalMoves = this.engine.getLegalMoves(y, x);
      this.view.showLegalMoveHighlights(legalMoves, { y, x });
      if (legalMoves.length === 0) this.showToast('その駒は動かせる場所がありません');
      return;
    }

    // 3. 移動先を選択
    if (this.selectedSquare) {
      const legalMoves = this.engine.getLegalMoves(this.selectedSquare.y, this.selectedSquare.x);
      if (legalMoves.some(m => m.y === y && m.x === x)) {
        const piece = this.engine.board[this.selectedSquare.y][this.selectedSquare.x];
        const canProm = this.engine.canPromote(this.selectedSquare.y, y, piece.type, piece.owner);
        const mustProm = this.engine.mustPromote(y, piece.type, piece.owner);

        if (canProm && !mustProm) {
          // 成り選択ダイアログを表示
          this.pendingMove = { from: this.selectedSquare, to: { y, x } };
          this.showModal('modal-nari');
          return;
        }

        this.executeMove({ from: this.selectedSquare, to: { y, x }, promote: mustProm, isDrop: false, dropPieceType: null });
      }
      this.clearSelection();
    }
  }

  // 持ち駒クリック
  onHandPieceClick(pieceType, owner) {
    if (!this.isHumanTurn() || owner !== this.engine.turn) return;

    this.selectedSquare = null;
    this.selectedHandPiece = pieceType;

    const drops = this.engine.getLegalDrops(pieceType);
    this.view.showLegalMoveHighlights(drops);
    if (drops.length === 0) this.showToast(`${PIECE_NAMES[pieceType]}を打てる場所がありません（二歩・打ち歩詰めなど）`);
    else this.showToast(`持ち駒の${PIECE_NAMES[pieceType]}を選択中 — 打つマスを選んでください`);
  }

  clearSelection() {
    this.selectedSquare = null;
    this.selectedHandPiece = null;
    this.view.clearHighlights();
  }

  handleNariChoice(promote) {
    this.hideModal('modal-nari');
    if (this.pendingMove) {
      this.executeMove({ ...this.pendingMove, promote, isDrop: false, dropPieceType: null });
      this.pendingMove = null;
    }
    this.clearSelection();
  }

  // 着手の実行。fromRemote: P2P で相手から受信した手
  executeMove(move, fromRemote = false) {
    if (!this.engine.isLegalMove(move)) {
      console.warn('不正な指し手を無視しました', move);
      return false;
    }
    const { from, to, promote, isDrop, dropPieceType } = move;
    const mover = this.engine.turn;
    this.engine.makeMove(from, to, promote, isDrop, dropPieceType);

    // 着手後の秒読みリセット
    this.currentTimers[mover].byoyomiSec = this.timeSettings[mover].byoyomiSec;
    this.updateTimerDisplays();

    // サウンド再生
    if (promote) {
      sounds.playPromote();
    } else {
      sounds.playPiecePlace();
    }

    // 3D盤面 & UI更新
    this.refreshBoard();
    this.renderKifuList();
    this.updateStatusUI();
    this.updateActionButtons();

    // P2P通信で相手に送信
    if (this.mode === 'p2p' && !fromRemote && this.p2p) {
      this.p2p.sendMove({ from, to, promote, isDrop, dropPieceType });
    }

    if (this.engine.isGameOver) {
      this.finishGame(this.gameOverMessage());
      return true;
    }

    // CPU思考Trigger
    this.maybeTriggerCPU();
    return true;
  }

  gameOverMessage() {
    const e = this.engine;
    const winnerName = e.winner === SENTE ? '先手' : '後手';
    switch (e.gameOverReason) {
      case '千日手': return '千日手です。引き分け（指し直し）となります。';
      case '連続王手の千日手': return `連続王手の千日手です。${winnerName}の勝利。`;
      case '手詰まり': return `手詰まり（指せる手がありません）。${winnerName}の勝利。`;
      default: return `${e.gameOverReason || '詰み'}です！${winnerName}の勝利。`;
    }
  }

  declarationMessage(side, ev) {
    const who = side === SENTE ? '先手' : '後手';
    if (ev.result === 'win') return `${who}の入玉宣言（${ev.points}点）。${who}の勝利です。`;
    return `${who}の入玉宣言（${ev.points}点）。持将棋（引き分け）です。`;
  }

  // 終局処理（タイマー停止・効果音・結果表示・履歴保存）
  finishGame(message) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.cancelThinking();
    this.clearSelection();
    sounds.playGameOver();
    this.updateStatusUI();
    this.updateTimerDisplays();
    this.updateActionButtons();
    this.showGameOverModal(message);
  }

  // 盤面・最終手・王手マーカーをまとめて更新する
  refreshBoard(eng = this.engine) {
    this.view.updateBoardState(eng);
    this.view.setLastMove(eng.history.at(-1)?.to || null);
    const inCheck = !eng.isGameOver && eng.isInCheck(eng.turn);
    const mated = eng.isGameOver && eng.gameOverReason === '詰み' ? eng.findKing(-eng.winner) : null;
    this.view.setCheckSquare(mated || (inCheck ? eng.findKing(eng.turn) : null));
  }

  renderKifuList() {
    const container = document.getElementById('kifu-list');
    container.innerHTML = '';
    const history = this.engine.history;
    if (history.length === 0) {
      container.innerHTML = '<div class="kifu-entry placeholder">まだ指し手はありません</div>';
      return;
    }
    history.forEach((rec, i) => {
      const entry = document.createElement('div');
      entry.className = 'kifu-entry' + (i === history.length - 1 ? ' latest' : '');
      entry.textContent = `${i + 1}. ${moveToDisplay(rec, history[i - 1])}`;
      container.appendChild(entry);
    });
    container.scrollTop = container.scrollHeight;
  }

  updateStatusUI() {
    const indicator = document.getElementById('turn-indicator');
    const e = this.engine;
    if (this.replay) return;
    if (e.isGameOver) {
      indicator.textContent = `終局（${e.gameOverReason || '対局終了'}） ${e.moveCount}手`;
    } else {
      const turnText = e.turn === SENTE ? '▲ 先手番' : '△ 後手番';
      let text = `${turnText} (${e.moveCount + 1}手目)`;
      if (e.moveCount > 0 && e.isInCheck(e.turn)) text = `王手！ ${text}`;
      if (this.cpuThinking) text += ' — CPU思考中…';
      indicator.textContent = text;
    }

    document.getElementById('sente-panel').classList.toggle('active', e.turn === SENTE && !e.isGameOver);
    document.getElementById('gote-panel').classList.toggle('active', e.turn === GOTE && !e.isGameOver);
  }

  updateActionButtons() {
    const e = this.engine;
    const playing = this.gameStarted && !e.isGameOver && !this.replay;
    document.getElementById('btn-resign').disabled = !playing;
    document.getElementById('btn-declare').disabled = !playing || !this.isHumanTurn();
    const undoable = this.gameStarted && !this.replay && this.mode !== 'p2p' && e.canUndo() &&
      (this.mode !== 'cpu' || e.history.some(h => h.turn === this.myRole));
    document.getElementById('btn-undo').disabled = !undoable;
  }

  // ===== 待った =====

  undo() {
    if (this.mode === 'p2p' || this.replay || !this.engine.canUndo()) return;
    const wasOver = this.engine.isGameOver;
    this.cancelThinking();

    if (this.mode === 'cpu') {
      // 自分の手を取り消すまで戻す（CPU の応手も一緒に戻る）
      if (!this.engine.history.some(h => h.turn === this.myRole)) return;
      while (this.engine.canUndo()) {
        const last = this.engine.history.at(-1);
        this.engine.undoMove();
        if (last.turn === this.myRole) break;
      }
    } else {
      this.engine.undoMove();
    }

    this.hideModal('modal-result');
    this.clearSelection();
    this.refreshBoard();
    this.renderKifuList();
    this.setEvalDisplay(null);
    if (wasOver && !this.engine.isGameOver) {
      this.gameSaved = false;
      this.startTimers();
    }
    this.updateStatusUI();
    this.updateTimerDisplays();
    this.updateActionButtons();
    this.maybeTriggerCPU();
  }

  // ===== 入玉宣言 =====

  declareByPlayer() {
    if (!this.isHumanTurn()) return;
    const side = this.engine.turn;
    const ev = this.engine.evaluateDeclaration(side);
    if (ev.result === 'invalid') {
      this.showToast(`入玉宣言できません：${ev.reason}（条件は「このサイトについて」を参照）`, 4500);
      return;
    }
    const outcome = ev.result === 'win' ? '勝ち' : '持将棋（引き分け）';
    if (!confirm(`入玉宣言しますか？\n現在 ${ev.points}点・敵陣の駒 ${ev.piecesInCamp}枚 → ${outcome}`)) return;
    this.engine.declare(side);
    if (this.mode === 'p2p' && this.p2p) this.p2p.send({ type: 'DECLARE' });
    this.finishGame(this.declarationMessage(side, ev));
  }

  resign() {
    if (this.engine.isGameOver || !this.gameStarted) return;
    if (!confirm('投了しますか？')) return;
    // CPU戦・P2P戦では常に自分が負け。対人ローカルでは手番側が投了する。
    const loser = (this.mode === 'cpu' || this.mode === 'p2p') ? this.myRole : this.engine.turn;
    this.engine.setGameOver(-loser, '投了');
    if (this.mode === 'p2p' && this.p2p) this.p2p.sendResign();

    const winnerText = this.engine.winner === SENTE ? '先手' : '後手';
    this.finishGame(`投了がありました。${winnerText}の勝利です。`);
  }

  // ===== P2P Matchmaking =====

  async startP2PHost() {
    this.myRole = SENTE;
    // 接続前に設定を確定しておき、接続時にゲストへ送る
    const settings = this.gatherSettings();
    this.p2p = new P2PManager(
      () => {
        document.getElementById('p2p-status-text').textContent = '対戦相手が接続しました！';
        this.p2p.sendGameSettings(settings);
        setTimeout(() => {
          this.hideModal('modal-p2p');
          this.startNewGame(settings);
        }, 800);
      },
      (data) => this.handleP2PData(data),
      (err) => this.handleP2PError(err)
    );

    this.hideModal('modal-setup');
    this.showModal('modal-p2p');
    document.getElementById('p2p-status-text').textContent = 'PeerJS に接続中...';
    try {
      const peerId = await this.p2p.init();
      document.getElementById('my-peer-id').value = peerId;
      document.getElementById('p2p-host-box').classList.remove('hidden');
      document.getElementById('p2p-join-box').classList.add('hidden');
      document.getElementById('p2p-status-text').textContent = '対戦相手の接続を待っています...';
    } catch (e) {
      document.getElementById('p2p-status-text').textContent = 'P2P サーバーに接続できませんでした。時間をおいて再度お試しください。';
    }
  }

  showP2PJoinUI() {
    this.myRole = GOTE;
    document.getElementById('p2p-join-box').classList.remove('hidden');
    document.getElementById('p2p-host-box').classList.add('hidden');
    document.getElementById('p2p-status-text').textContent = 'ホストから共有された対戦IDを入力してください';
    this.hideModal('modal-setup');
    this.showModal('modal-p2p');
  }

  async connectP2PPeer() {
    const targetId = document.getElementById('target-peer-id').value.trim();
    if (!targetId) return;

    this.p2p = new P2PManager(
      () => {
        document.getElementById('p2p-status-text').textContent = 'ホストへ接続成功！対局設定を受信中…';
      },
      (data) => this.handleP2PData(data),
      (err) => this.handleP2PError(err)
    );

    try {
      await this.p2p.init();
      this.p2p.connectToHost(targetId);
    } catch (e) {
      document.getElementById('p2p-status-text').textContent = 'P2P サーバーに接続できませんでした。';
    }
  }

  handleP2PError(err) {
    console.error(err);
    const msg = typeof err === 'string' ? err : (err?.type === 'peer-unavailable' ? '指定した対戦IDが見つかりません' : '通信エラーが発生しました');
    if (this.gameStarted && this.mode === 'p2p' && !this.engine.isGameOver) {
      this.showToast(`オンライン対戦: ${msg}`, 5000);
    } else {
      document.getElementById('p2p-status-text').textContent = msg;
    }
  }

  handleP2PData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'SETTINGS') {
      // ゲスト側: ホストの設定で対局開始
      this.hideModal('modal-p2p');
      this.startNewGame(data.settings);
    } else if (data.type === 'MOVE') {
      if (this.engine.turn === this.myRole) return; // 自分の手番に相手の手は来ない
      this.executeMove(data.move, true);
    } else if (data.type === 'RESIGN') {
      if (this.engine.isGameOver) return;
      this.engine.setGameOver(this.myRole, '投了');
      this.finishGame('相手が投了しました。あなたの勝利！');
    } else if (data.type === 'DECLARE') {
      if (this.engine.isGameOver) return;
      const side = -this.myRole;
      const ev = this.engine.declare(side);
      if (ev && ev.result !== 'invalid') this.finishGame(this.declarationMessage(side, ev));
    }
  }

  // ===== 棋譜の出力・読み込み =====

  kifFileName(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `shogi3d_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}.kif`;
  }

  currentKif() {
    return exportKif(this.engine, this.gameMeta);
  }

  openExportModal() {
    let kif;
    let shown;
    if (this.replay) {
      const full = buildEngineFromRecord(this.replay.record);
      kif = exportKif(full, this.replay.meta);
      shown = buildEngineFromRecord(this.replay.record, this.replay.ply);
    } else {
      kif = this.currentKif();
      shown = this.engine;
    }
    document.getElementById('export-kif').value = kif;
    document.getElementById('export-sfen').value = `sfen ${shown.toSfen()}`;
    document.getElementById('export-usi').value = shown.toUsiPosition();
    this.showModal('modal-export');
  }

  openImportModal(fromSetup = false) {
    this.importOpenedFromSetup = fromSetup;
    if (fromSetup) this.hideModal('modal-setup');
    document.getElementById('import-error').classList.add('hidden');
    document.getElementById('import-file').value = '';
    this.showModal('modal-import');
  }

  importFromText(text, name = '') {
    const errEl = document.getElementById('import-error');
    let record;
    try {
      record = parseKifuText(text);
    } catch (e) {
      errEl.textContent = `読み込めませんでした: ${e.message}`;
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    this.hideModal('modal-import');
    this.importOpenedFromSetup = false;
    const title = name || `読込棋譜（${record.format}）`;
    this.enterReplay(record, title, { senteName: record.senteName, goteName: record.goteName }, record.moves.length);
  }

  // ===== 棋譜再生 =====

  enterReplay(record, title, meta = {}, ply = 0) {
    if (this.gameStarted && !this.engine.isGameOver) {
      if (!confirm('対局中です。対局を中断して棋譜を再生しますか？')) return false;
      this.engine.setGameOver(null, '中断');
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.cancelThinking();
      this.updateActionButtons();
    }
    ['modal-setup', 'modal-kifu-history', 'modal-result'].forEach(id => this.hideModal(id));
    this.clearSelection();
    this.replay = { record, ply: 0, title, meta };
    document.getElementById('replay-bar').classList.remove('hidden');
    const slider = document.getElementById('replay-slider');
    slider.max = String(record.moves.length);
    this.view.refit();
    this.updateActionButtons();
    this.setReplayPly(ply);
    return true;
  }

  setReplayPly(ply) {
    if (!this.replay) return;
    const total = this.replay.record.moves.length;
    ply = Math.max(0, Math.min(total, ply));
    this.replay.ply = ply;
    const eng = buildEngineFromRecord(this.replay.record, ply);
    this.refreshBoard(eng);
    document.getElementById('replay-slider').value = String(ply);
    const last = eng.history.at(-1);
    const moveText = last ? moveToDisplay(last, eng.history.at(-2)) : '開始局面';
    document.getElementById('replay-info').textContent = `${this.replay.title}　${ply} / ${total}手　${moveText}`;
    document.getElementById('turn-indicator').textContent = `棋譜再生中 — ${ply}手目 ${moveText}`;

    // サイドバーの棋譜も再生中の棋譜を表示する
    const container = document.getElementById('kifu-list');
    container.innerHTML = '';
    const full = buildEngineFromRecord(this.replay.record);
    full.history.forEach((rec, i) => {
      const entry = document.createElement('div');
      entry.className = 'kifu-entry clickable' + (i === ply - 1 ? ' latest' : '');
      entry.textContent = `${i + 1}. ${moveToDisplay(rec, full.history[i - 1])}`;
      entry.addEventListener('click', () => this.setReplayPly(i + 1));
      container.appendChild(entry);
    });
    const cur = container.children[ply - 1];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  exitReplay() {
    if (!this.replay) return;
    this.replay = null;
    document.getElementById('replay-bar').classList.add('hidden');
    this.view.refit();
    this.refreshBoard();
    this.renderKifuList();
    this.updateStatusUI();
    this.updateActionButtons();
  }

  replaySavedRecord(id) {
    const saved = this.loadKifuHistory().find(r => r.id === id);
    if (!saved) return;
    let record;
    try {
      record = saved.usi ? parseKifuText(saved.usi) : parseKifuText(saved.kif || '');
      if (saved.handicap) record.handicap = saved.handicap;
    } catch (e) {
      alert('この棋譜は古い形式で保存されているため再生できません。');
      return;
    }
    this.enterReplay(record, this.formatKifuDate(saved.savedAt), { senteName: saved.senteName, goteName: saved.goteName, startDate: saved.savedAt });
  }

  updateStartPositionUI() {
    const box = document.getElementById('start-position-box');
    const handicapGroup = document.getElementById('handicap-group');
    if (this.pendingStart) {
      box.classList.remove('hidden');
      handicapGroup.classList.add('hidden');
      document.getElementById('start-position-text').textContent = `読み込んだ棋譜の ${this.pendingStart.ply}手目の局面から`;
    } else {
      box.classList.add('hidden');
      handicapGroup.classList.remove('hidden');
    }
  }

  downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  showToast(message, ms = 2600) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  async copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(message);
    } catch (e) {
      prompt('コピーできませんでした。以下を手動でコピーしてください。', text);
    }
  }

  // ===== モーダル =====

  // 対局設定モーダルを開く。既に対局中の場合のみ「戻る」ボタンを表示する
  openSetupModal() {
    const canCancel = this.gameStarted && !this.engine.isGameOver;
    document.getElementById('btn-setup-cancel').classList.toggle('hidden', !canCancel);
    this.updateStartPositionUI();
    this.showModal('modal-setup');
  }

  showModal(id) {
    document.getElementById(id).classList.add('active');
  }

  hideModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  showGameOverModal(msg) {
    document.getElementById('result-message').textContent = msg;
    document.getElementById('btn-result-undo').classList.toggle('hidden', this.mode === 'p2p' || !this.engine.canUndo());
    document.getElementById('btn-result-kif').classList.toggle('hidden', this.engine.history.length === 0);
    this.showModal('modal-result');
    this.saveCurrentGameToHistory(msg);
  }

  // ===== 棋譜のアプリ内保存 (localStorage) =====

  // 対局終了時に現在の棋譜をlocalStorageへ自動保存する
  saveCurrentGameToHistory(resultMessage) {
    if (this.engine.history.length === 0 || this.gameSaved) return; // 一手も指されていない対局は保存しない
    this.gameSaved = true;

    const record = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      mode: this.mode,
      handicap: this.engine.handicap,
      cpuLevel: this.mode === 'cpu' ? this.cpuLevel : null,
      playerSide: (this.mode === 'cpu' || this.mode === 'p2p') ? this.myRole : null,
      senteName: this.gameMeta.senteName,
      goteName: this.gameMeta.goteName,
      result: resultMessage,
      moves: this.engine.history.map((rec, i) => `${i + 1}. ${moveToDisplay(rec, this.engine.history[i - 1])}`),
      usi: this.engine.toUsiPosition(),
      kif: this.currentKif()
    };

    const history = this.loadKifuHistory();
    history.unshift(record);
    if (history.length > KIFU_HISTORY_MAX) history.length = KIFU_HISTORY_MAX;

    try {
      localStorage.setItem(KIFU_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('棋譜の保存に失敗しました（ストレージ容量の可能性があります）', e);
    }
  }

  loadKifuHistory() {
    try {
      const raw = localStorage.getItem(KIFU_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  deleteKifuRecord(id) {
    const history = this.loadKifuHistory().filter(r => r.id !== id);
    try {
      localStorage.setItem(KIFU_HISTORY_KEY, JSON.stringify(history));
    } catch (e) { /* noop */ }
  }

  formatKifuDate(isoString) {
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  openKifuHistoryModal(fromSetup = false) {
    this.kifuHistoryOpenedFromSetup = fromSetup;
    if (fromSetup) this.hideModal('modal-setup');
    this.showKifuHistoryListPane();
    this.showModal('modal-kifu-history');
  }

  showKifuHistoryListPane() {
    this.viewingKifuId = null;
    document.getElementById('kifu-history-detail-pane').classList.add('hidden');
    document.getElementById('kifu-history-list-pane').classList.remove('hidden');
    this.renderKifuHistoryList();
  }

  renderKifuHistoryList() {
    const container = document.getElementById('kifu-history-list');
    const history = this.loadKifuHistory();
    container.innerHTML = '';

    if (history.length === 0) {
      container.innerHTML = '<div class="kifu-entry placeholder">保存された対局はまだありません</div>';
      return;
    }

    history.forEach(record => {
      const item = document.createElement('div');
      item.className = 'kifu-history-item';

      const main = document.createElement('div');
      main.className = 'kifu-history-item-main';
      const date = document.createElement('span');
      date.className = 'kifu-history-date';
      date.textContent = this.formatKifuDate(record.savedAt);
      const mode = document.createElement('span');
      mode.className = 'kifu-history-mode';
      mode.textContent = MODE_LABELS[record.mode] || record.mode;
      const count = document.createElement('span');
      count.className = 'kifu-history-movecount';
      count.textContent = `${record.moves.length}手`;
      main.append(date, mode, count);

      const resultLine = document.createElement('div');
      resultLine.className = 'kifu-history-result';
      resultLine.textContent = record.result;

      item.appendChild(main);
      item.appendChild(resultLine);
      item.addEventListener('click', () => this.openKifuDetail(record.id));
      container.appendChild(item);
    });
  }

  openKifuDetail(id) {
    const record = this.loadKifuHistory().find(r => r.id === id);
    if (!record) return;
    this.viewingKifuId = id;

    let metaText = `${this.formatKifuDate(record.savedAt)}　${MODE_LABELS[record.mode] || record.mode}`;
    metaText += `　${HANDICAP_LABELS[record.handicap] || record.handicap || '平手'}`;
    if (record.mode === 'cpu' && record.cpuLevel) {
      metaText += `　CPU Lv.${record.cpuLevel}`;
    }
    if (record.mode === 'cpu' || record.mode === 'p2p') {
      metaText += record.playerSide === GOTE ? '　あなた: 後手' : '　あなた: 先手';
    }
    metaText += `\n${record.result}`;

    document.getElementById('kifu-history-detail-meta').textContent = metaText;

    const movesContainer = document.getElementById('kifu-history-detail-moves');
    movesContainer.innerHTML = '';
    record.moves.forEach(text => {
      const entry = document.createElement('div');
      entry.className = 'kifu-entry';
      entry.textContent = text;
      movesContainer.appendChild(entry);
    });

    // 旧形式（指し手テキストのみ）の記録は再生・KIF保存できない
    document.getElementById('btn-kifu-detail-replay').classList.toggle('hidden', !record.usi);
    document.getElementById('btn-kifu-detail-download').classList.toggle('hidden', !record.kif);

    document.getElementById('kifu-history-list-pane').classList.add('hidden');
    document.getElementById('kifu-history-detail-pane').classList.remove('hidden');
  }
}

// App Initialization
window.addEventListener('DOMContentLoaded', () => {
  window.app = new ShogiApp();
});
