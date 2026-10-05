import { ShogiEngine } from '../js/shogi-engine.js';

// USI の指し手列を順に指す（不正な手ならエラー）
export function play(engine, usiMoves) {
  for (const usi of usiMoves.trim().split(/\s+/).filter(Boolean)) {
    const mv = ShogiEngine.usiToMove(usi);
    if (!engine.isLegalMove(mv)) throw new Error(`illegal move ${usi} at ${engine.toSfen()}`);
    engine.makeMove(mv.from, mv.to, mv.promote, mv.isDrop, mv.dropPieceType);
  }
  return engine;
}

export function fromSfen(sfen, handicap = 'hirate') {
  const e = new ShogiEngine();
  e.loadSfen(sfen, handicap);
  return e;
}

export function legalUsi(engine) {
  return engine.generateAllLegalMoves().map(m => ShogiEngine.moveToUsi(m)).sort();
}
