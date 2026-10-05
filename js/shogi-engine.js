// shogi-engine.js - Shogi Game Logic & Rules Engine

export const PIECE_TYPES = {
  FU: 'FU',     // 歩
  KY: 'KY',     // 香
  KE: 'KE',     // 桂
  GI: 'GI',     // 銀
  KI: 'KI',     // 金
  KA: 'KA',     // 角
  HI: 'HI',     // 飛
  OU: 'OU',     // 王 / 玉
  TO: 'TO',     // と
  NY: 'NY',     // 成香
  NK: 'NK',     // 成桂
  NG: 'NG',     // 成銀
  UM: 'UM',     // 馬
  RY: 'RY'      // 竜
};

export const SENTE = 1; // 先手 (下手)
export const GOTE = -1; // 後手 (上手)

export const PIECE_NAMES = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉',
  TO: 'と', NY: '杏', NK: '圭', NG: '全', UM: '馬', RY: '竜'
};

export const STARTPOS_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

const SFEN_CHARS = {
  FU: 'P', KY: 'L', KE: 'N', GI: 'S', KI: 'G', KA: 'B', HI: 'R', OU: 'K',
  TO: '+P', NY: '+L', NK: '+N', NG: '+S', UM: '+B', RY: '+R'
};
const SFEN_TYPES = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI', K: 'OU' };
const HAND_ORDER = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];

export class ShogiEngine {
  constructor() {
    this.board = Array(9).fill(null).map(() => Array(9).fill(null));
    this.hands = {
      [SENTE]: { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 },
      [GOTE]: { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 }
    };
    this.turn = SENTE;
    this.history = [];
    this.moveCount = 0;
    this.isGameOver = false;
    this.winner = null;
    this.isDraw = false;
    this.gameOverReason = null;
    this.handicap = 'hirate';
    this.initialSfen = STARTPOS_SFEN;
    this.snapshots = [];     // 待った用: 各着手前の状態
    this.positionKeys = [];  // 千日手判定用: 各局面のキー（index = その局面までの手数）
  }

  // 初期盤面セットアップ (平手および各種駒落ち)
  reset(handicap = 'hirate') {
    this.handicap = handicap;
    this.board = Array(9).fill(null).map(() => Array(9).fill(null));
    this.hands[SENTE] = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
    this.hands[GOTE] = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
    this.history = [];
    this.moveCount = 0;
    this.isGameOver = false;
    this.winner = null;

    // 平手標準配置
    // 0: 9段目(先手陣), 8: 1段目(後手陣)
    // 後手 (GOTE): y = 0..2
    this.board[0][0] = { type: PIECE_TYPES.KY, owner: GOTE };
    this.board[0][1] = { type: PIECE_TYPES.KE, owner: GOTE };
    this.board[0][2] = { type: PIECE_TYPES.GI, owner: GOTE };
    this.board[0][3] = { type: PIECE_TYPES.KI, owner: GOTE };
    this.board[0][4] = { type: PIECE_TYPES.OU, owner: GOTE };
    this.board[0][5] = { type: PIECE_TYPES.KI, owner: GOTE };
    this.board[0][6] = { type: PIECE_TYPES.GI, owner: GOTE };
    this.board[0][7] = { type: PIECE_TYPES.KE, owner: GOTE };
    this.board[0][8] = { type: PIECE_TYPES.KY, owner: GOTE };
    // 座標系: file = 9 - x, rank = y + 1。後手の飛車は8二(x=1)、角は2二(x=7)。
    this.board[1][1] = { type: PIECE_TYPES.HI, owner: GOTE };
    this.board[1][7] = { type: PIECE_TYPES.KA, owner: GOTE };
    for (let x = 0; x < 9; x++) {
      this.board[2][x] = { type: PIECE_TYPES.FU, owner: GOTE };
    }

    // 先手 (SENTE): y = 6..8
    for (let x = 0; x < 9; x++) {
      this.board[6][x] = { type: PIECE_TYPES.FU, owner: SENTE };
    }
    // 先手の飛車は2八(x=7)、角は8八(x=1)。
    this.board[7][1] = { type: PIECE_TYPES.KA, owner: SENTE };
    this.board[7][7] = { type: PIECE_TYPES.HI, owner: SENTE };
    this.board[8][0] = { type: PIECE_TYPES.KY, owner: SENTE };
    this.board[8][1] = { type: PIECE_TYPES.KE, owner: SENTE };
    this.board[8][2] = { type: PIECE_TYPES.GI, owner: SENTE };
    this.board[8][3] = { type: PIECE_TYPES.KI, owner: SENTE };
    this.board[8][4] = { type: PIECE_TYPES.OU, owner: SENTE };
    this.board[8][5] = { type: PIECE_TYPES.KI, owner: SENTE };
    this.board[8][6] = { type: PIECE_TYPES.GI, owner: SENTE };
    this.board[8][7] = { type: PIECE_TYPES.KE, owner: SENTE };
    this.board[8][8] = { type: PIECE_TYPES.KY, owner: SENTE };

    // 駒落ちハンデの調整 (後手/上手側の駒を取り外す)
    this.applyHandicap(handicap);

    // 駒落ちは上手（GOTE）が初手
    this.turn = (handicap === 'hirate') ? SENTE : GOTE;
    this.isDraw = false;
    this.gameOverReason = null;
    this.startPly = 0;
    this.initialSfen = this.toSfen();
    this.snapshots = [];
    this.positionKeys = [this.positionKey()];
  }

  applyHandicap(handicap) {
    if (handicap === 'hirate') return;

    const remove = (y, x) => { this.board[y][x] = null; };

    // 後手陣: 飛車=board[1][1](8二), 角=board[1][7](2二)
    switch (handicap) {
      case 'kyo':      remove(0, 0); break; // 香落ち
      case 'kaku':     remove(1, 7); break; // 角落ち
      case 'hisha':    remove(1, 1); break; // 飛車落ち
      case 'hishakyo': remove(1, 1); remove(0, 0); break; // 飛香落ち
      case 'nimai':    remove(1, 1); remove(1, 7); break; // 二枚落ち
      case 'yonmai':   remove(1, 1); remove(1, 7); remove(0, 0); remove(0, 8); break; // 四枚落ち
      case 'rokumai':  // 六枚落ち (飛角香香桂桂)
        remove(1, 1); remove(1, 7); remove(0, 0); remove(0, 8); remove(0, 1); remove(0, 7);
        break;
      case 'hachimai': // 八枚落ち (+銀銀)
        remove(1, 1); remove(1, 7); remove(0, 0); remove(0, 8); remove(0, 1); remove(0, 7); remove(0, 2); remove(0, 6);
        break;
      case 'jumai':    // 十枚落ち (玉と歩以外全て)
        remove(1, 1); remove(1, 7);
        remove(0, 0); remove(0, 1); remove(0, 2); remove(0, 3); remove(0, 5); remove(0, 6); remove(0, 7); remove(0, 8);
        break;
    }
  }

  // 指定座標(y, x)にある駒の移動可能マスを全て返す
  getLegalMoves(y, x) {
    const piece = this.board[y][x];
    if (!piece || piece.owner !== this.turn || this.isGameOver) return [];

    const pseudoMoves = this.getPseudoMoves(y, x, piece);
    // 王手放置・自家自殺手を排除する厳密フィルタ
    return pseudoMoves.filter(m => !this.willBeInCheckAfterMove({ from: {y, x}, to: m, isDrop: false }));
  }

  // 持ち駒の打駒可能マスを返す
  getLegalDrops(pieceType) {
    if (this.hands[this.turn][pieceType] <= 0 || this.isGameOver) return [];

    const drops = [];
    const isSente = (this.turn === SENTE);

    for (let y = 0; y < 9; y++) {
      // 行き所のない駒の制限
      if (pieceType === PIECE_TYPES.FU || pieceType === PIECE_TYPES.KY) {
        if (isSente && y === 0) continue;
        if (!isSente && y === 8) continue;
      }
      if (pieceType === PIECE_TYPES.KE) {
        if (isSente && y <= 1) continue;
        if (!isSente && y >= 7) continue;
      }

      for (let x = 0; x < 9; x++) {
        if (this.board[y][x] !== null) continue;

        // 二歩の禁止チェック
        if (pieceType === PIECE_TYPES.FU && this.hasPawnInColumn(x, this.turn)) {
          continue;
        }

        // 打ち歩詰めのチェック
        if (pieceType === PIECE_TYPES.FU && this.isUchifuZume(y, x, this.turn)) {
          continue;
        }

        drops.push({ y, x });
      }
    }
    return drops;
  }

  // 二歩判定
  hasPawnInColumn(x, owner) {
    for (let y = 0; y < 9; y++) {
      const p = this.board[y][x];
      if (p && p.owner === owner && p.type === PIECE_TYPES.FU) {
        return true;
      }
    }
    return false;
  }

  // 打ち歩詰め判定
  isUchifuZume(y, x, owner) {
    const enemyOwner = -owner;
    const enemyKingPos = this.findKing(enemyOwner);
    if (!enemyKingPos) return false;

    // 歩を打つ場所が相手玉の目の前でなければ打ち歩詰めではない
    const forwardY = (owner === SENTE) ? y - 1 : y + 1;
    if (enemyKingPos.y !== forwardY || enemyKingPos.x !== x) return false;

    // 仮に打ってみて、相手玉が詰むかどうかを判定
    this.board[y][x] = { type: PIECE_TYPES.FU, owner };
    const isMate = this.isKingMated(enemyOwner);
    this.board[y][x] = null;

    return isMate;
  }

  // 王の座標を取得
  findKing(owner) {
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const p = this.board[y][x];
        if (p && p.owner === owner && p.type === PIECE_TYPES.OU) {
          return { y, x };
        }
      }
    }
    return null;
  }

  // 王手がかかっているか？
  isInCheck(owner) {
    const kingPos = this.findKing(owner);
    if (!kingPos) return false;
    const attackerOwner = -owner;

    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const p = this.board[y][x];
        if (p && p.owner === attackerOwner) {
          const pseudo = this.getPseudoMoves(y, x, p);
          if (pseudo.some(m => m.y === kingPos.y && m.x === kingPos.x)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // 指定の側に合法手が1つでも存在するか（盤上の駒移動＋持ち駒打ち、いずれも自玉が王手に晒されない手）
  hasAnyLegalMove(owner) {
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const p = this.board[y][x];
        if (p && p.owner === owner) {
          const moves = this.getPseudoMoves(y, x, p);
          for (const m of moves) {
            if (!this.willBeInCheckAfterMove({ from: {y, x}, to: m, isDrop: false })) {
              return true;
            }
          }
        }
      }
    }

    for (const [type, count] of Object.entries(this.hands[owner])) {
      if (count <= 0) continue;
      // 二歩・行き所のない駒・打ち歩詰めを考慮した合法な打ち場所があるか
      const savedTurn = this.turn;
      this.turn = owner;
      const drops = this.getLegalDrops(type);
      this.turn = savedTurn;
      for (const d of drops) {
        if (!this.willBeInCheckAfterMove({ from: null, to: d, isDrop: true, pieceType: type, owner })) {
          return true;
        }
      }
    }
    return false;
  }

  // 指定の側が詰んでいるか判定（王手 かつ 合法手なし）
  isKingMated(owner) {
    if (!this.isInCheck(owner)) return false;
    return !this.hasAnyLegalMove(owner);
  }

  willBeInCheckAfterMove(move) {
    const { from, to, isDrop, pieceType, owner } = move;
    const moveOwner = isDrop ? owner : this.board[from.y][from.x].owner;
    let savedTarget = null;
    let savedSource = null;

    if (isDrop) {
      this.board[to.y][to.x] = { type: pieceType, owner: moveOwner };
    } else {
      savedSource = this.board[from.y][from.x];
      savedTarget = this.board[to.y][to.x];
      this.board[to.y][to.x] = savedSource;
      this.board[from.y][from.x] = null;
    }

    const inCheck = this.isInCheck(moveOwner);

    // 元に戻す
    if (isDrop) {
      this.board[to.y][to.x] = null;
    } else {
      this.board[from.y][from.x] = savedSource;
      this.board[to.y][to.x] = savedTarget;
    }

    return inCheck;
  }

  // 指し手の実行
  makeMove(from, to, promote = false, isDrop = false, dropPieceType = null) {
    if (this.isGameOver) return false;
    if (isDrop) {
      if (!this.hands[this.turn][dropPieceType] || this.hands[this.turn][dropPieceType] <= 0) return false;
    } else if (!this.board[from.y][from.x]) {
      return false;
    }

    this.snapshots.push(this.captureState());

    let moveRecord = {
      turn: this.turn,
      from,
      to,
      promote,
      isDrop,
      dropPieceType,
      pieceType: isDrop ? dropPieceType : this.board[from.y][from.x].type, // 移動前の駒種（KIF表記用）
      captured: null,
      givesCheck: false
    };

    if (isDrop) {
      this.hands[this.turn][dropPieceType]--;
      this.board[to.y][to.x] = { type: dropPieceType, owner: this.turn };
    } else {
      const piece = this.board[from.y][from.x];
      const target = this.board[to.y][to.x];
      if (target) {
        // 王（玉）を直接取った場合はその瞬間に即時勝利！
        if (target.type === PIECE_TYPES.OU) {
          this.isGameOver = true;
          this.winner = this.turn;
        }

        // 駒を取得して持ち駒に加える（成駒は元の駒に戻す）
        const unpromotedType = this.unpromote(target.type);
        if (unpromotedType !== PIECE_TYPES.OU) this.hands[this.turn][unpromotedType]++;
        moveRecord.captured = target.type;
      }

      let finalType = piece.type;
      if (promote) {
        finalType = this.promote(piece.type);
      }

      this.board[to.y][to.x] = { type: finalType, owner: this.turn };
      this.board[from.y][from.x] = null;
    }

    this.history.push(moveRecord);
    this.moveCount++;

    // 王を取ってゲーム終了していない場合、相手手番の合法手有無をチェック
    if (!this.isGameOver) {
      const nextTurn = -this.turn;
      moveRecord.givesCheck = this.isInCheck(nextTurn);
      // 相手に合法手が1つも無ければ終局（王手中なら詰み、そうでなければ手詰まり）。いずれも着手側の勝ち。
      if (!this.hasAnyLegalMove(nextTurn)) {
        this.isGameOver = true;
        this.winner = this.turn;
        this.gameOverReason = moveRecord.givesCheck ? '詰み' : '手詰まり';
      } else {
        this.turn = nextTurn;
      }
    }

    this.positionKeys.push(this.positionKey());
    if (!this.isGameOver) this.checkRepetition();

    return true;
  }

  // ===== 待った（一手戻し） =====

  captureState() {
    return {
      board: this.board.map(row => row.map(c => (c ? { ...c } : null))),
      hands: { [SENTE]: { ...this.hands[SENTE] }, [GOTE]: { ...this.hands[GOTE] } },
      turn: this.turn,
      isGameOver: this.isGameOver,
      winner: this.winner,
      isDraw: this.isDraw,
      gameOverReason: this.gameOverReason
    };
  }

  canUndo() {
    return this.snapshots.length > 0;
  }

  // 直前の一手を取り消す。終局後でも取り消せる（終局状態も着手前に戻る）。
  undoMove() {
    if (!this.canUndo()) return false;
    const s = this.snapshots.pop();
    this.board = s.board;
    this.hands = s.hands;
    this.turn = s.turn;
    this.isGameOver = s.isGameOver;
    this.winner = s.winner;
    this.isDraw = s.isDraw;
    this.gameOverReason = s.gameOverReason;
    this.history.pop();
    this.positionKeys.pop();
    this.moveCount--;
    return true;
  }

  // 終局を外部から確定させる（投了・時間切れ・宣言など）
  setGameOver(winner, reason) {
    this.isGameOver = true;
    this.winner = winner;
    this.isDraw = winner === null;
    this.gameOverReason = reason;
  }

  // ===== 千日手 =====

  // 同一局面（盤面・持ち駒・手番）が4回現れたら千日手。
  // その間ずっと一方が王手をかけ続けていた場合は「連続王手の千日手」で王手をかけた側の負け。
  checkRepetition() {
    const key = this.positionKeys[this.positionKeys.length - 1];
    const occ = [];
    this.positionKeys.forEach((k, i) => { if (k === key) occ.push(i); });
    if (occ.length < 4) return;

    const startIdx = occ[occ.length - 4];
    const endIdx = occ[occ.length - 1];
    // history[i] は positionKeys[i] の局面から指された手
    const moves = this.history.slice(startIdx, endIdx);
    for (const side of [SENTE, GOTE]) {
      const sideMoves = moves.filter(m => m.turn === side);
      if (sideMoves.length > 0 && sideMoves.every(m => m.givesCheck)) {
        this.setGameOver(-side, '連続王手の千日手');
        return;
      }
    }
    this.setGameOver(null, '千日手');
  }

  // ===== 入玉宣言 (24点法) =====

  // 大駒5点・小駒1点。玉は数えない。
  static piecePoint(type) {
    const base = { KA: 5, HI: 5, UM: 5, RY: 5, OU: 0 };
    return base[type] ?? 1;
  }

  // 平手の総点数(54点)との差分を、駒落ちで上手が落とした駒の点数として上手に加算する（CSA 24点法 駒落ち規定）
  missingPointsForHandicap() {
    let total = 0;
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const p = this.board[y][x];
        if (p) total += ShogiEngine.piecePoint(p.type);
      }
    }
    for (const owner of [SENTE, GOTE]) {
      for (const [t, c] of Object.entries(this.hands[owner])) total += ShogiEngine.piecePoint(t) * c;
    }
    return Math.max(0, 54 - total);
  }

  // 手番側が入玉宣言できるかを判定する。
  // 戻り値 { result: 'win' | 'draw' | 'invalid', points, piecesInCamp, reason }
  evaluateDeclaration(owner = this.turn) {
    const inCamp = (y) => (owner === SENTE ? y <= 2 : y >= 6);
    const king = this.findKing(owner);
    const res = { result: 'invalid', points: 0, piecesInCamp: 0, reason: '' };
    if (owner !== this.turn) { res.reason = '自分の手番ではありません'; return res; }
    if (!king || !inCamp(king.y)) { res.reason = '玉が敵陣三段目以内に入っていません'; return res; }
    if (this.isInCheck(owner)) { res.reason = '王手がかかっています'; return res; }

    let points = 0;
    let pieces = 0;
    for (let y = 0; y < 9; y++) {
      if (!inCamp(y)) continue;
      for (let x = 0; x < 9; x++) {
        const p = this.board[y][x];
        if (p && p.owner === owner && p.type !== PIECE_TYPES.OU) {
          pieces++;
          points += ShogiEngine.piecePoint(p.type);
        }
      }
    }
    for (const [t, c] of Object.entries(this.hands[owner])) points += ShogiEngine.piecePoint(t) * c;
    if (owner === GOTE && this.handicap !== 'hirate') points += this.missingPointsForHandicap();

    res.points = points;
    res.piecesInCamp = pieces;
    if (pieces < 10) { res.reason = `敵陣の駒が10枚未満です（${pieces}枚）`; return res; }
    if (points >= 31) { res.result = 'win'; return res; }
    if (points >= 24) { res.result = 'draw'; return res; }
    res.reason = `点数が24点未満です（${points}点）`;
    return res;
  }

  // 入玉宣言を実行する。条件不成立なら宣言しない（false を返す）。
  declare(owner = this.turn) {
    if (this.isGameOver) return null;
    const ev = this.evaluateDeclaration(owner);
    if (ev.result === 'win') this.setGameOver(owner, '入玉宣言勝ち');
    else if (ev.result === 'draw') this.setGameOver(null, '持将棋');
    return ev;
  }

  // ===== SFEN / USI =====

  toSfen(includeMoveNumber = true) {
    const rows = [];
    for (let y = 0; y < 9; y++) {
      let row = '';
      let empty = 0;
      for (let x = 0; x < 9; x++) {
        const p = this.board[y][x];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        let ch = SFEN_CHARS[p.type];
        if (p.owner === GOTE) ch = ch.toLowerCase();
        row += ch;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let hand = '';
    for (const owner of [SENTE, GOTE]) {
      for (const t of HAND_ORDER) {
        const c = this.hands[owner][t];
        if (!c) continue;
        const ch = owner === SENTE ? SFEN_CHARS[t] : SFEN_CHARS[t].toLowerCase();
        hand += (c > 1 ? c : '') + ch;
      }
    }
    const parts = [rows.join('/'), this.turn === SENTE ? 'b' : 'w', hand || '-'];
    if (includeMoveNumber) parts.push(String((this.startPly || 0) + this.moveCount + 1));
    return parts.join(' ');
  }

  positionKey() {
    return this.toSfen(false);
  }

  // SFEN 文字列（"sfen" 接頭辞・"startpos" も可）から局面を読み込む
  loadSfen(sfen, handicap = 'hirate') {
    let text = sfen.trim();
    if (text === 'startpos') text = STARTPOS_SFEN;
    text = text.replace(/^sfen\s+/, '');
    const [boardPart, turnPart, handPart, plyPart] = text.split(/\s+/);
    const rows = (boardPart || '').split('/');
    if (rows.length !== 9) throw new Error('SFEN の盤面が不正です');

    const board = Array(9).fill(null).map(() => Array(9).fill(null));
    rows.forEach((row, y) => {
      let x = 0;
      for (let i = 0; i < row.length; i++) {
        let ch = row[i];
        if (/[1-9]/.test(ch)) { x += parseInt(ch, 10); continue; }
        let promoted = false;
        if (ch === '+') { promoted = true; ch = row[++i]; }
        const owner = ch === ch.toUpperCase() ? SENTE : GOTE;
        let type = SFEN_TYPES[ch.toUpperCase()];
        if (!type || x > 8) throw new Error('SFEN の盤面が不正です');
        if (promoted) type = this.promote(type);
        board[y][x++] = { type, owner };
      }
      if (x !== 9) throw new Error('SFEN の盤面が不正です');
    });

    const hands = {
      [SENTE]: { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 },
      [GOTE]: { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 }
    };
    if (handPart && handPart !== '-') {
      const re = /(\d*)([PLNSGBRplnsgbr])/g;
      let m;
      let consumed = 0;
      while ((m = re.exec(handPart))) {
        const owner = m[2] === m[2].toUpperCase() ? SENTE : GOTE;
        hands[owner][SFEN_TYPES[m[2].toUpperCase()]] += m[1] ? parseInt(m[1], 10) : 1;
        consumed += m[0].length;
      }
      if (consumed !== handPart.length) throw new Error('SFEN の持ち駒が不正です');
    }

    this.board = board;
    this.hands = hands;
    this.turn = turnPart === 'w' ? GOTE : SENTE;
    this.startPly = Math.max(0, (parseInt(plyPart, 10) || 1) - 1);
    this.handicap = handicap;
    this.history = [];
    this.moveCount = 0;
    this.isGameOver = false;
    this.winner = null;
    this.isDraw = false;
    this.gameOverReason = null;
    this.initialSfen = this.toSfen();
    this.snapshots = [];
    this.positionKeys = [this.positionKey()];
  }

  // 内部の指し手 → USI 文字列 ("7g7f", "8h2b+", "P*5e")
  static moveToUsi(move) {
    const sq = (p) => `${9 - p.x}${String.fromCharCode(97 + p.y)}`;
    if (move.isDrop) return `${SFEN_CHARS[move.dropPieceType]}*${sq(move.to)}`;
    return `${sq(move.from)}${sq(move.to)}${move.promote ? '+' : ''}`;
  }

  // USI 文字列 → 内部の指し手。形式が不正なら null。
  static usiToMove(usi) {
    const parseSq = (f, r) => ({ x: 9 - parseInt(f, 10), y: r.charCodeAt(0) - 97 });
    let m = /^([PLNSGBR])\*([1-9])([a-i])$/.exec(usi);
    if (m) return { from: null, to: parseSq(m[2], m[3]), promote: false, isDrop: true, dropPieceType: SFEN_TYPES[m[1]] };
    m = /^([1-9])([a-i])([1-9])([a-i])(\+?)$/.exec(usi);
    if (m) return { from: parseSq(m[1], m[2]), to: parseSq(m[3], m[4]), promote: m[5] === '+', isDrop: false, dropPieceType: null };
    return null;
  }

  // 現在の手番で指し手が合法か（成り・不成の可否も含めて）厳密に判定する
  isLegalMove(move) {
    if (this.isGameOver || !move || !move.to) return false;
    const { from, to, promote, isDrop, dropPieceType } = move;
    if (isDrop) {
      if (promote) return false;
      return this.getLegalDrops(dropPieceType).some(d => d.y === to.y && d.x === to.x);
    }
    if (!from || from.y < 0 || from.y > 8 || from.x < 0 || from.x > 8) return false;
    const piece = this.board[from.y][from.x];
    if (!piece || piece.owner !== this.turn) return false;
    if (!this.getLegalMoves(from.y, from.x).some(m => m.y === to.y && m.x === to.x)) return false;
    if (promote && !this.canPromote(from.y, to.y, piece.type, piece.owner)) return false;
    if (!promote && this.mustPromote(to.y, piece.type, piece.owner)) return false;
    return true;
  }

  // 手番側の全合法手（成・不成の両方、打ち駒を含む）
  generateAllLegalMoves() {
    const owner = this.turn;
    const moves = [];
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const p = this.board[y][x];
        if (!p || p.owner !== owner) continue;
        for (const m of this.getLegalMoves(y, x)) {
          const base = { from: { y, x }, to: { y: m.y, x: m.x }, isDrop: false, dropPieceType: null };
          if (!this.mustPromote(m.y, p.type, owner)) moves.push({ ...base, promote: false });
          if (this.canPromote(y, m.y, p.type, owner)) moves.push({ ...base, promote: true });
        }
      }
    }
    for (const [type, count] of Object.entries(this.hands[owner])) {
      if (count <= 0) continue;
      for (const d of this.getLegalDrops(type)) {
        moves.push({ from: null, to: { y: d.y, x: d.x }, promote: false, isDrop: true, dropPieceType: type });
      }
    }
    return moves;
  }

  // 現局面を USI の position コマンド文字列で返す（初期局面＋指し手列）
  toUsiPosition() {
    const moves = this.history.map(h => ShogiEngine.moveToUsi(h));
    const base = this.initialSfen === STARTPOS_SFEN ? 'position startpos' : `position sfen ${this.initialSfen}`;
    return moves.length ? `${base} moves ${moves.join(' ')}` : base;
  }

  promote(type) {
    switch (type) {
      case PIECE_TYPES.FU: return PIECE_TYPES.TO;
      case PIECE_TYPES.KY: return PIECE_TYPES.NY;
      case PIECE_TYPES.KE: return PIECE_TYPES.NK;
      case PIECE_TYPES.GI: return PIECE_TYPES.NG;
      case PIECE_TYPES.KA: return PIECE_TYPES.UM;
      case PIECE_TYPES.HI: return PIECE_TYPES.RY;
      default: return type;
    }
  }

  unpromote(type) {
    switch (type) {
      case PIECE_TYPES.TO: return PIECE_TYPES.FU;
      case PIECE_TYPES.NY: return PIECE_TYPES.KY;
      case PIECE_TYPES.NK: return PIECE_TYPES.KE;
      case PIECE_TYPES.NG: return PIECE_TYPES.GI;
      case PIECE_TYPES.UM: return PIECE_TYPES.KA;
      case PIECE_TYPES.RY: return PIECE_TYPES.HI;
      default: return type;
    }
  }

  canPromote(fromY, toY, pieceType, owner) {
    const unpromoted = [PIECE_TYPES.FU, PIECE_TYPES.KY, PIECE_TYPES.KE, PIECE_TYPES.GI, PIECE_TYPES.KA, PIECE_TYPES.HI];
    if (!unpromoted.includes(pieceType)) return false;

    // 敵陣 (先手なら y=0,1,2, 後手なら y=6,7,8)
    if (owner === SENTE) {
      return fromY <= 2 || toY <= 2;
    } else {
      return fromY >= 6 || toY >= 6;
    }
  }

  mustPromote(toY, pieceType, owner) {
    if (owner === SENTE) {
      if ((pieceType === PIECE_TYPES.FU || pieceType === PIECE_TYPES.KY) && toY === 0) return true;
      if (pieceType === PIECE_TYPES.KE && toY <= 1) return true;
    } else {
      if ((pieceType === PIECE_TYPES.FU || pieceType === PIECE_TYPES.KY) && toY === 8) return true;
      if (pieceType === PIECE_TYPES.KE && toY >= 7) return true;
    }
    return false;
  }

  // 疑似移動範囲（利き）の生成
  getPseudoMoves(y, x, piece) {
    const moves = [];
    const dir = piece.owner === SENTE ? -1 : 1;
    const add = (ny, nx) => {
      if (ny < 0 || ny > 8 || nx < 0 || nx > 8) return false;
      const target = this.board[ny][nx];
      if (!target) {
        moves.push({ y: ny, x: nx });
        return true; // 空きマス
      }
      if (target.owner !== piece.owner) {
        moves.push({ y: ny, x: nx }); // 敵駒を取る
      }
      return false; // 障害物で停止
    };

    const addRay = (dy, dx) => {
      let ny = y + dy;
      let nx = x + dx;
      while (ny >= 0 && ny <= 8 && nx >= 0 && nx <= 8) {
        const target = this.board[ny][nx];
        if (!target) {
          moves.push({ y: ny, x: nx });
        } else {
          if (target.owner !== piece.owner) moves.push({ y: ny, x: nx });
          break;
        }
        ny += dy;
        nx += dx;
      }
    };

    switch (piece.type) {
      case PIECE_TYPES.FU:
        add(y + dir, x);
        break;
      case PIECE_TYPES.KY:
        addRay(dir, 0);
        break;
      case PIECE_TYPES.KE:
        add(y + dir * 2, x - 1);
        add(y + dir * 2, x + 1);
        break;
      case PIECE_TYPES.GI:
        add(y + dir, x);
        add(y + dir, x - 1);
        add(y + dir, x + 1);
        add(y - dir, x - 1);
        add(y - dir, x + 1);
        break;
      case PIECE_TYPES.KI:
      case PIECE_TYPES.TO:
      case PIECE_TYPES.NY:
      case PIECE_TYPES.NK:
      case PIECE_TYPES.NG:
        add(y + dir, x);
        add(y + dir, x - 1);
        add(y + dir, x + 1);
        add(y, x - 1);
        add(y, x + 1);
        add(y - dir, x);
        break;
      case PIECE_TYPES.OU:
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dy !== 0 || dx !== 0) add(y + dy, x + dx);
          }
        }
        break;
      case PIECE_TYPES.KA:
        addRay(-1, -1); addRay(-1, 1); addRay(1, -1); addRay(1, 1);
        break;
      case PIECE_TYPES.HI:
        addRay(-1, 0); addRay(1, 0); addRay(0, -1); addRay(0, 1);
        break;
      case PIECE_TYPES.UM: // 馬 (角 + 金の直進4方向)
        addRay(-1, -1); addRay(-1, 1); addRay(1, -1); addRay(1, 1);
        add(y - 1, x); add(y + 1, x); add(y, x - 1); add(y, x + 1);
        break;
      case PIECE_TYPES.RY: // 竜 (飛 + 斜め4方向1マス)
        addRay(-1, 0); addRay(1, 0); addRay(0, -1); addRay(0, 1);
        add(y - 1, x - 1); add(y - 1, x + 1); add(y + 1, x - 1); add(y + 1, x + 1);
        break;
    }

    return moves;
  }
}
