// ai-worker.js - Web Worker Shogi AI (ルール厳密・合法手のみを指す negamax + alpha-beta)
// 本エンジン (ShogiEngine) を import して合法手生成・王手判定を共有することで、
// CPU が飛角香桂馬龍を含む全ての駒を正しく動かし、かつ自玉を王手に晒す反則手を一切指さないようにする。

import { ShogiEngine, SENTE, GOTE, PIECE_TYPES } from './shogi-engine.js';

const PIECE_VALUES = {
  FU: 100, KY: 300, KE: 400, GI: 600, KI: 700, KA: 950, HI: 1050, OU: 20000,
  TO: 600, NY: 550, NK: 550, NG: 550, UM: 1250, RY: 1350
};

let nodeBudget = 0;

self.onmessage = function (e) {
  const { board, hands, turn, level } = e.data;
  const engine = restoreEngine(board, hands, turn);
  const depth = level >= 3 ? 3 : level === 2 ? 2 : 1;
  nodeBudget = 120000; // 探索ノード上限（応答性確保）
  const best = pickBestMove(engine, depth);
  self.postMessage(best);
};

// postMessage で渡ってきた素の board/hands から ShogiEngine を復元
function restoreEngine(board, hands, turn) {
  const engine = new ShogiEngine();
  engine.board = board.map(row => row.map(cell => (cell ? { ...cell } : null)));
  engine.hands = {
    [SENTE]: { ...hands[SENTE] },
    [GOTE]: { ...hands[GOTE] }
  };
  engine.turn = turn;
  engine.isGameOver = false;
  return engine;
}

function cloneEngine(engine) {
  return restoreEngine(engine.board, engine.hands, engine.turn);
}

// 合法手を全て列挙（成/不成の両方、合法な打ち駒を含む）
function generateLegalMoves(engine) {
  const owner = engine.turn;
  const moves = [];

  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const p = engine.board[y][x];
      if (!p || p.owner !== owner) continue;
      const legal = engine.getLegalMoves(y, x); // 自玉王手放置は既に除外済み
      for (const m of legal) {
        const mustProm = engine.mustPromote(m.y, p.type, owner);
        const canProm = engine.canPromote(y, m.y, p.type, owner);
        if (mustProm) {
          moves.push({ from: { y, x }, to: { y: m.y, x: m.x }, isDrop: false, promote: true });
        } else {
          moves.push({ from: { y, x }, to: { y: m.y, x: m.x }, isDrop: false, promote: false });
          if (canProm) {
            moves.push({ from: { y, x }, to: { y: m.y, x: m.x }, isDrop: false, promote: true });
          }
        }
      }
    }
  }

  for (const [type, count] of Object.entries(engine.hands[owner])) {
    if (count <= 0) continue;
    const drops = engine.getLegalDrops(type); // 二歩・行き所なし・打ち歩詰めを除外済み
    for (const d of drops) {
      moves.push({ from: null, to: { y: d.y, x: d.x }, isDrop: true, dropPieceType: type, owner });
    }
  }

  return moves;
}

// 手番側視点の静的評価（駒得＋持ち駒）
function evaluate(engine, perspective) {
  let score = 0;
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const p = engine.board[y][x];
      if (!p) continue;
      const v = PIECE_VALUES[p.type] || 100;
      score += (p.owner === perspective) ? v : -v;
    }
  }
  for (const side of [SENTE, GOTE]) {
    for (const [type, count] of Object.entries(engine.hands[side])) {
      const v = (PIECE_VALUES[type] || 100) * 0.85 * count;
      score += (side === perspective) ? v : -v;
    }
  }
  return score;
}

function applyMove(engine, move) {
  if (move.isDrop) {
    engine.makeMove(null, move.to, false, true, move.dropPieceType);
  } else {
    engine.makeMove(move.from, move.to, move.promote, false, null);
  }
}

// negamax + alpha-beta
function negamax(engine, depth, alpha, beta, perspective) {
  if (nodeBudget-- <= 0) return evaluate(engine, perspective);
  if (engine.isGameOver) {
    // 直前に着手した側が勝ち。engine.turn は勝者のまま残っている。
    const winnerIsPerspective = engine.winner === perspective;
    return winnerIsPerspective ? 900000 - (10 - depth) : -900000 + (10 - depth);
  }
  if (depth === 0) return evaluate(engine, perspective);

  const moves = generateLegalMoves(engine);
  if (moves.length === 0) {
    // 合法手なし＝手番側の負け
    return (engine.turn === perspective) ? -900000 : 900000;
  }

  // 手ならべ替え（駒を取る手を優先）で枝刈り効率を上げる
  moves.sort((a, b) => captureValue(engine, b) - captureValue(engine, a));

  let best = -Infinity;
  for (const move of moves) {
    const next = cloneEngine(engine);
    applyMove(next, move);
    const score = -negamax(next, depth - 1, -beta, -alpha, perspective);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (nodeBudget <= 0) break;
  }
  return best;
}

function captureValue(engine, move) {
  if (move.isDrop) return 0;
  const target = engine.board[move.to.y][move.to.x];
  return target ? (PIECE_VALUES[target.type] || 0) : 0;
}

function pickBestMove(engine, depth) {
  const perspective = engine.turn;
  const moves = generateLegalMoves(engine);
  if (moves.length === 0) return null;

  moves.sort((a, b) => captureValue(engine, b) - captureValue(engine, a));

  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of moves) {
    const next = cloneEngine(engine);
    applyMove(next, move);
    const score = -negamax(next, depth - 1, -beta, -alpha, perspective);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
    if (nodeBudget <= 0) break;
  }

  return bestMove;
}
