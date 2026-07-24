// app.js - Main Controller for 3D Shogi Application

import { ShogiEngine, SENTE, GOTE, PIECE_NAMES } from './shogi-engine.js';
import { Shogi3DView } from './3d-view.js?v=20260723_uxfix2';
import { sounds } from './sound.js';
import { P2PManager } from './p2p-manager.js';

const SIDEBAR_COLLAPSED_KEY = 'shogi3d_sidebar_collapsed';
const KIFU_HISTORY_KEY = 'shogi3d_kifu_history';
const KIFU_HISTORY_MAX = 200; // 保存件数の上限（無制限増加によるlocalStorage圧迫を防ぐ）

const MODE_LABELS = { local: '対人 (ローカル)', cpu: 'CPU戦', p2p: 'オンライン (P2P)' };
const HANDICAP_LABELS = {
  hirate: '平手', kyo: '香落ち', kaku: '角落ち', hisha: '飛車落ち', hishakyo: '飛香落ち',
  nimai: '二枚落ち', yonmai: '四枚落ち', rokumai: '六枚落ち', hachimai: '八枚落ち', jumai: '十枚落ち'
};

class ShogiApp {
  constructor() {
    this.engine = new ShogiEngine();
    this.view = null;
    this.p2p = null;
    this.aiWorker = null;

    this.mode = 'local'; // 'local' | 'cpu' | 'p2p'
    this.cpuLevel = 2;
    this.myRole = SENTE; // 自分の手番 (CPU戦: プレイヤーの手番 / P2P戦: 自分の役割)
    this.cpuSide = GOTE; // CPU戦の場合のみ意味を持つ、CPU側の手番
    this.gameStarted = false; // 一度でも対局が開始されたか（設定モーダルの「戻る」表示用）

    this.selectedSquare = null;
    this.selectedHandPiece = null;
    this.pendingMove = null;
    this.currentKifuMoves = []; // 現在の対局の指し手テキスト（棋譜保存用）
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
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
      } catch (e) { /* noop */ }
    });
  }

  initUI() {
    // 1. UI Buttons & Event Listeners
    document.getElementById('btn-new-game').addEventListener('click', () => this.openSetupModal());
    document.getElementById('btn-start-game').addEventListener('click', () => this.startNewGame());
    document.getElementById('btn-setup-cancel').addEventListener('click', () => this.hideModal('modal-setup'));

    document.getElementById('btn-camera-cycle').addEventListener('click', () => this.view.cycleCameraView());
    document.getElementById('btn-camera-reset').addEventListener('click', () => this.view.setCameraPerspective(this.myRole));
    document.getElementById('btn-camera-flip').addEventListener('click', () => this.view.togglePerspective());
    document.getElementById('btn-resign').addEventListener('click', () => this.resign());

    // 成りダイアログ
    document.getElementById('btn-nari-yes').addEventListener('click', () => this.handleNariChoice(true));
    document.getElementById('btn-nari-no').addEventListener('click', () => this.handleNariChoice(false));
    document.getElementById('btn-nari-cancel').addEventListener('click', () => {
      this.hideModal('modal-nari');
      this.pendingMove = null;
      this.clearSelection();
    });

    // 結果モーダル：盤面確認 / 再対局
    document.getElementById('btn-result-close').addEventListener('click', () => {
      this.hideModal('modal-result');
    });
    document.getElementById('btn-result-restart').addEventListener('click', () => {
      this.hideModal('modal-result');
      this.openSetupModal();
    });

    // モード切替ラジオ
    const modeBtns = document.querySelectorAll('#mode-selector .btn-option');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        this.updateModeOptionsUI();
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
      const val = e.target.value;
      const customBox = document.getElementById('custom-time-box');
      if (val === 'custom') {
        customBox.classList.remove('hidden');
      } else {
        customBox.classList.add('hidden');
      }
    });

    // P2P UI
    document.getElementById('btn-p2p-host').addEventListener('click', () => this.startP2PHost());
    document.getElementById('btn-p2p-join-modal').addEventListener('click', () => this.showP2PJoinUI());
    document.getElementById('btn-connect-peer').addEventListener('click', () => this.connectP2PPeer());
    document.getElementById('btn-close-p2p').addEventListener('click', () => {
      // 接続試行中だった場合は破棄してから設定画面に戻る
      if (this.p2p) {
        this.p2p.destroy?.();
        this.p2p = null;
      }
      this.hideModal('modal-p2p');
      this.openSetupModal();
    });
    document.getElementById('btn-copy-peer-id').addEventListener('click', () => {
      const input = document.getElementById('my-peer-id');
      navigator.clipboard.writeText(input.value);
      alert('対戦IDをコピーしました！');
    });

    // 棋譜履歴モーダル（サイドバーから／対局設定モーダルからの両方に対応）
    document.getElementById('btn-kifu-history').addEventListener('click', () => this.openKifuHistoryModal(false));
    document.getElementById('btn-setup-kifu-history').addEventListener('click', () => this.openKifuHistoryModal(true));
    document.getElementById('btn-kifu-history-close').addEventListener('click', () => {
      this.hideModal('modal-kifu-history');
      if (this.kifuHistoryOpenedFromSetup) {
        this.kifuHistoryOpenedFromSetup = false;
        this.openSetupModal();
      }
    });
    document.getElementById('btn-kifu-history-clear').addEventListener('click', () => {
      if (this.loadKifuHistory().length === 0) return;
      if (confirm('保存されたすべての棋譜を削除します。よろしいですか？')) {
        localStorage.removeItem(KIFU_HISTORY_KEY);
        this.renderKifuHistoryList();
      }
    });
    document.getElementById('btn-kifu-detail-back').addEventListener('click', () => this.showKifuHistoryListPane());
    document.getElementById('btn-kifu-detail-delete').addEventListener('click', () => {
      if (!this.viewingKifuId) return;
      if (confirm('この棋譜を削除しますか？')) {
        this.deleteKifuRecord(this.viewingKifuId);
        this.showKifuHistoryListPane();
      }
    });
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

  initAIWorker() {
    this.aiWorker = new Worker('js/ai-worker.js', { type: 'module' });
    this.aiWorker.onmessage = (e) => {
      const move = e.data;
      if (move) {
        this.executeMove(move.from, move.to, move.promote, move.isDrop, move.dropPieceType);
      }
    };
  }

  // 新規対局の開始
  startNewGame() {
    sounds.init(); // ユーザー操作のタイミングで AudioContext を初期化

    const handicap = document.getElementById('handicap-select').value;
    const timePreset = document.getElementById('time-preset-select').value;
    this.cpuLevel = parseInt(document.getElementById('cpu-level').value, 10) || 2;

    // 手番の決定: CPU戦は手番セレクタ、P2P戦は既にmyRole設定済み、対人ローカルは常に先手視点
    if (this.mode !== 'cpu' && this.mode !== 'p2p') {
      this.myRole = SENTE;
    }
    this.cpuSide = -this.myRole;

    // 時間設定の計算
    this.setupTimeSettings(timePreset);

    // エンジンリセット
    this.engine.reset(handicap);
    this.selectedSquare = null;
    this.selectedHandPiece = null;

    // UI & 3Dビュー更新
    this.view.updateBoardState(this.engine);
    this.view.clearHighlights();
    this.view.setCameraPerspective(this.myRole);
    this.hideModal('modal-setup');

    // 棋譜欄を新しい対局用にリセット（前局の履歴が残り続けるのを防ぐ）
    document.getElementById('kifu-list').innerHTML = '';
    this.currentKifuMoves = [];

    // プレイヤー名表示の更新
    if (this.mode === 'cpu') {
      document.getElementById(this.cpuSide === GOTE ? 'gote-name' : 'sente-name').textContent = `CPU (Lv.${this.cpuLevel})`;
      document.getElementById(this.myRole === GOTE ? 'gote-name' : 'sente-name').textContent = 'プレイヤー';
    } else if (this.mode === 'p2p') {
      document.getElementById(this.myRole === GOTE ? 'gote-name' : 'sente-name').textContent = 'プレイヤー';
      document.getElementById(this.myRole === GOTE ? 'sente-name' : 'gote-name').textContent = '対戦相手';
    } else {
      document.getElementById('sente-name').textContent = '先手 プレイヤー';
      document.getElementById('gote-name').textContent = '後手 プレイヤー';
    }
    document.getElementById('btn-resign').disabled = false;

    this.gameStarted = true;

    // タイマー開始
    this.startTimers();
    this.updateStatusUI();

    // 駒落ちハンデ戦などでCPU側（上手）が初手を持つ場合、ここで着手させる
    this.maybeTriggerCPU();
  }

  // CPUの手番であればAIワーカーに思考させる（対局開始直後の駒落ち初手にも対応）
  maybeTriggerCPU() {
    if (this.mode !== 'cpu' || this.engine.isGameOver) return;
    if (this.engine.turn !== this.cpuSide) return;

    setTimeout(() => {
      this.aiWorker.postMessage({
        board: this.engine.board,
        hands: this.engine.hands,
        turn: this.cpuSide,
        level: this.cpuLevel
      });
    }, 400);
  }

  setupTimeSettings(preset) {
    let mainSec = 300;
    let byoyomiSec = 20;

    if (preset === 'hayazashi') {
      mainSec = 60; byoyomiSec = 10;
    } else if (preset === 'jikkuri') {
      mainSec = 600; byoyomiSec = 30;
    } else if (preset === 'custom') {
      const sMin = parseInt(document.getElementById('sente-min').value) || 5;
      const sSec = parseInt(document.getElementById('sente-sec').value) || 20;
      const gMin = parseInt(document.getElementById('gote-min').value) || 5;
      const gSec = parseInt(document.getElementById('gote-sec').value) || 20;

      this.timeSettings[SENTE] = { mainSec: sMin * 60, byoyomiSec: sSec };
      this.timeSettings[GOTE] = { mainSec: gMin * 60, byoyomiSec: gSec };

      this.resetTimersState();
      return;
    }

    this.timeSettings[SENTE] = { mainSec, byoyomiSec };
    this.timeSettings[GOTE] = { mainSec, byoyomiSec };
    this.resetTimersState();
  }

  resetTimersState() {
    this.currentTimers[SENTE] = {
      mainSec: this.timeSettings[SENTE].mainSec,
      byoyomiSec: this.timeSettings[SENTE].byoyomiSec,
      inByoyomi: false
    };
    this.currentTimers[GOTE] = {
      mainSec: this.timeSettings[GOTE].mainSec,
      byoyomiSec: this.timeSettings[GOTE].byoyomiSec,
      inByoyomi: false
    };
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
    clearInterval(this.timerInterval);
    sounds.playGameOver();
    this.engine.isGameOver = true;
    this.engine.winner = -loserOwner;

    const winnerText = this.engine.winner === SENTE ? '先手の勝利' : '後手の勝利';
    this.showGameOverModal(`時間切れ！${winnerText}です。`);
  }

  updateTimerDisplays() {
    const formatTime = (totalSec) => {
      const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const s = (totalSec % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    };

    // 先手
    const tSente = this.currentTimers[SENTE];
    document.getElementById('sente-main-time').textContent = formatTime(tSente.mainSec);
    document.getElementById('sente-byoyomi').textContent = tSente.inByoyomi
      ? `秒読み ${tSente.byoyomiSec}秒`
      : `秒読み ${this.timeSettings[SENTE].byoyomiSec}秒`;

    // 後手
    const tGote = this.currentTimers[GOTE];
    document.getElementById('gote-main-time').textContent = formatTime(tGote.mainSec);
    document.getElementById('gote-byoyomi').textContent = tGote.inByoyomi
      ? `秒読み ${tGote.byoyomiSec}秒`
      : `秒読み ${this.timeSettings[GOTE].byoyomiSec}秒`;
  }

  // マスクリックイベント (3D盤面)
  onSquareClick(y, x) {
    if (this.engine.isGameOver) return;

    // P2P対戦・CPU対戦で自分の手番でない場合は無視（CPU思考中にCPUの駒を操作させない）
    if ((this.mode === 'p2p' || this.mode === 'cpu') && this.engine.turn !== this.myRole) return;

    // 1. 持ち駒を選択中の場合 -> 打駒
    if (this.selectedHandPiece) {
      const drops = this.engine.getLegalDrops(this.selectedHandPiece);
      if (drops.some(d => d.y === y && d.x === x)) {
        this.executeMove(null, { y, x }, false, true, this.selectedHandPiece);
      }
      this.clearSelection();
      return;
    }

    const clickedPiece = this.engine.board[y][x];

    // 2. 自分の駒を選択
    if (clickedPiece && clickedPiece.owner === this.engine.turn) {
      this.selectedSquare = { y, x };
      const legalMoves = this.engine.getLegalMoves(y, x);
      this.view.showLegalMoveHighlights(legalMoves);
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

        const promote = mustProm || false;
        this.executeMove(this.selectedSquare, { y, x }, promote, false, null);
      }
      this.clearSelection();
    }
  }

  // 持ち駒クリック
  onHandPieceClick(pieceType, owner) {
    if (this.engine.isGameOver || owner !== this.engine.turn) return;
    if ((this.mode === 'p2p' || this.mode === 'cpu') && owner !== this.myRole) return;

    this.selectedSquare = null;
    this.selectedHandPiece = pieceType;

    const drops = this.engine.getLegalDrops(pieceType);
    this.view.showLegalMoveHighlights(drops);
  }

  clearSelection() {
    this.selectedSquare = null;
    this.selectedHandPiece = null;
    this.view.clearHighlights();
  }

  handleNariChoice(promote) {
    this.hideModal('modal-nari');
    if (this.pendingMove) {
      this.executeMove(this.pendingMove.from, this.pendingMove.to, promote, false, null);
      this.pendingMove = null;
    }
    this.clearSelection();
  }

  // 着手の実行
  executeMove(from, to, promote, isDrop, dropPieceType) {
    const success = this.engine.makeMove(from, to, promote, isDrop, dropPieceType);
    if (!success) return;

    // 着手後の秒読みリセット
    const lastTurn = -this.engine.turn;
    this.currentTimers[lastTurn].byoyomiSec = this.timeSettings[lastTurn].byoyomiSec;

    // サウンド再生
    if (promote) {
      sounds.playPromote();
    } else {
      sounds.playPiecePlace();
    }

    // 3D盤面 & UI更新
    this.view.updateBoardState(this.engine);
    this.addKifuEntry(from, to, promote, isDrop, dropPieceType, lastTurn);
    this.updateStatusUI();

    // P2P通信で相手に送信
    if (this.mode === 'p2p') {
      this.p2p.sendMove({ from, to, promote, isDrop, dropPieceType });
    }

    // 詰み・勝利チェック
    if (this.engine.isGameOver) {
      sounds.playGameOver();
      const winnerName = this.engine.winner === SENTE ? '先手' : '後手';
      const reason = this.engine.gameOverReason || '詰み';
      this.showGameOverModal(`${reason}です！${winnerName}の勝利。`);
      return;
    }
    // 王手の通知
    if (this.engine.isInCheck(this.engine.turn)) {
      const checkedName = this.engine.turn === SENTE ? '先手' : '後手';
      document.getElementById('turn-indicator').textContent = `王手！ ${checkedName}玉`;
    }

    // CPU思考Trigger
    this.maybeTriggerCPU();
  }

  addKifuEntry(from, to, promote, isDrop, dropPieceType, turn) {
    const kifuContainer = document.getElementById('kifu-list');
    const placeholder = kifuContainer.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    const turnSymbol = turn === SENTE ? '▲' : '△';
    const toText = `${9 - to.x}${to.y + 1}`;
    let pieceText = '';

    if (isDrop) {
      pieceText = `${PIECE_NAMES[dropPieceType]}打`;
    } else {
      const piece = this.engine.board[to.y][to.x];
      pieceText = PIECE_NAMES[piece.type];
      if (promote) pieceText += '成';
    }

    const text = `${this.engine.moveCount}. ${turnSymbol}${toText}${pieceText}`;
    this.currentKifuMoves.push(text);

    const entry = document.createElement('div');
    entry.className = 'kifu-entry latest';
    entry.textContent = text;

    // 過去のlatestを解除
    kifuContainer.querySelectorAll('.kifu-entry').forEach(e => e.classList.remove('latest'));

    kifuContainer.appendChild(entry);
    kifuContainer.scrollTop = kifuContainer.scrollHeight;
  }

  updateStatusUI() {
    const turnText = this.engine.turn === SENTE ? '▲ 先手番' : '△ 後手番';
    document.getElementById('turn-indicator').textContent = `${turnText} (${this.engine.moveCount}手目)`;

    document.getElementById('sente-panel').classList.toggle('active', this.engine.turn === SENTE);
    document.getElementById('gote-panel').classList.toggle('active', this.engine.turn === GOTE);
  }

  resign() {
    if (this.engine.isGameOver) return;
    if (confirm('投了しますか？')) {
      this.engine.isGameOver = true;
      this.engine.winner = -this.engine.turn;
      sounds.playGameOver();

      if (this.mode === 'p2p') this.p2p.sendResign();

      const winnerText = this.engine.winner === SENTE ? '先手' : '後手';
      this.showGameOverModal(`投了がありました。${winnerText}の勝利です。`);
    }
  }

  // P2P Matchmaking
  async startP2PHost() {
    this.myRole = SENTE;
    this.p2p = new P2PManager(
      (isHost) => {
        document.getElementById('p2p-status-text').textContent = '対戦相手が接続しました！';
        setTimeout(() => {
          this.hideModal('modal-p2p');
          this.startNewGame();
        }, 1000);
      },
      (data) => this.handleP2PData(data),
      (err) => alert(err)
    );

    const peerId = await this.p2p.init();
    document.getElementById('my-peer-id').value = peerId;
    document.getElementById('p2p-host-box').classList.remove('hidden');
    document.getElementById('p2p-join-box').classList.add('hidden');
    document.getElementById('p2p-status-text').textContent = '対戦相手の接続を待っています...';
    this.hideModal('modal-setup');
    this.showModal('modal-p2p');
  }

  showP2PJoinUI() {
    this.myRole = GOTE;
    document.getElementById('p2p-join-box').classList.remove('hidden');
    document.getElementById('p2p-host-box').classList.add('hidden');
    this.hideModal('modal-setup');
    this.showModal('modal-p2p');
  }

  async connectP2PPeer() {
    const targetId = document.getElementById('target-peer-id').value.trim();
    if (!targetId) return;

    this.p2p = new P2PManager(
      () => {
        document.getElementById('p2p-status-text').textContent = 'ホストへ接続成功！';
        setTimeout(() => {
          this.hideModal('modal-p2p');
          this.startNewGame();
        }, 1000);
      },
      (data) => this.handleP2PData(data),
      (err) => alert(err)
    );

    await this.p2p.init();
    this.p2p.connectToHost(targetId);
  }

  handleP2PData(data) {
    if (data.type === 'MOVE') {
      const { from, to, promote, isDrop, dropPieceType } = data.move;
      this.executeMove(from, to, promote, isDrop, dropPieceType);
    } else if (data.type === 'RESIGN') {
      this.engine.isGameOver = true;
      this.showGameOverModal('相手が投了しました。あなたの勝利！');
    }
  }

  // 対局設定モーダルを開く。既に対局中の場合のみ「戻る」ボタンを表示する
  openSetupModal() {
    const canCancel = this.gameStarted && !this.engine.isGameOver;
    document.getElementById('btn-setup-cancel').classList.toggle('hidden', !canCancel);
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
    this.showModal('modal-result');
    this.saveCurrentGameToHistory(msg);
  }

  // ===== 棋譜のアプリ内保存 (localStorage) =====

  // 対局終了時に現在の棋譜をlocalStorageへ自動保存する
  saveCurrentGameToHistory(resultMessage) {
    if (this.currentKifuMoves.length === 0) return; // 一手も指されていない対局は保存しない

    const record = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      mode: this.mode,
      handicap: this.engine.handicap,
      cpuLevel: this.mode === 'cpu' ? this.cpuLevel : null,
      playerSide: (this.mode === 'cpu' || this.mode === 'p2p') ? this.myRole : null,
      result: resultMessage,
      moves: [...this.currentKifuMoves]
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
    localStorage.setItem(KIFU_HISTORY_KEY, JSON.stringify(history));
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
      main.innerHTML = `
        <span class="kifu-history-date">${this.formatKifuDate(record.savedAt)}</span>
        <span class="kifu-history-mode">${MODE_LABELS[record.mode] || record.mode}</span>
        <span class="kifu-history-movecount">${record.moves.length}手</span>
      `;

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

    document.getElementById('kifu-history-list-pane').classList.add('hidden');
    document.getElementById('kifu-history-detail-pane').classList.remove('hidden');
  }
}

// App Initialization
window.addEventListener('DOMContentLoaded', () => {
  window.app = new ShogiApp();
});
