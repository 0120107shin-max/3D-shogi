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
    this.handicap = 'hirate';
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

    let moveRecord = {
      turn: this.turn,
      from,
      to,
      promote,
      isDrop,
      dropPieceType,
      captured: null
    };

    if (isDrop) {
      if (this.hands[this.turn][dropPieceType] <= 0) return false;
      this.hands[this.turn][dropPieceType]--;
      this.board[to.y][to.x] = { type: dropPieceType, owner: this.turn };
    } else {
      const piece = this.board[from.y][from.x];
      if (!piece) return false;

      const target = this.board[to.y][to.x];
      if (target) {
        // 王（玉）を直接取った場合はその瞬間に即時勝利！
        if (target.type === PIECE_TYPES.OU) {
          this.isGameOver = true;
          this.winner = this.turn;
        }

        // 駒を取得して持ち駒に加える（成駒は元の駒に戻す）
        const unpromotedType = this.unpromote(target.type);
        this.hands[this.turn][unpromotedType]++;
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
      // 相手に合法手が1つも無ければ終局（王手中なら詰み、そうでなければ手詰まり）。いずれも着手側の勝ち。
      if (!this.hasAnyLegalMove(nextTurn)) {
        this.isGameOver = true;
        this.winner = this.turn;
        this.gameOverReason = this.isInCheck(nextTurn) ? '詰み' : '手詰まり';
      } else {
        this.turn = nextTurn;
      }
    }

    return true;
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
