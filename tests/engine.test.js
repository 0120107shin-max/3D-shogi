import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShogiEngine, SENTE, GOTE, STARTPOS_SFEN } from '../js/shogi-engine.js';
import { play, fromSfen, legalUsi } from './helpers.js';

function perft(e, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of e.generateAllLegalMoves()) {
    e.makeMove(m.from, m.to, m.promote, m.isDrop, m.dropPieceType);
    n += perft(e, depth - 1);
    e.undoMove();
  }
  return n;
}

test('初期局面の合法手数 (perft) が既知の値と一致する', () => {
  const e = new ShogiEngine();
  e.reset();
  assert.equal(perft(e, 1), 30);
  assert.equal(perft(e, 2), 900);
  assert.equal(perft(e, 3), 25470);
  assert.equal(e.toSfen(), STARTPOS_SFEN, 'perft 後に局面が元に戻っている');
});

test('SFEN の出力と読み込みが往復で一致する', () => {
  const sfens = [
    STARTPOS_SFEN,
    'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
    '8l/1l+R2P3/p2pBG1pp/kps1p4/Nn1P2G2/P1P1P2PP/1PS6/1KSG3+r1/LN2+p3L w Sbgn3p 124',
    '4k4/9/9/9/9/9/9/9/4K4 b 2R2B4G4S4N4L18P 1'
  ];
  for (const s of sfens) {
    assert.equal(fromSfen(s).toSfen(), s);
  }
  assert.throws(() => fromSfen('9/9/9 b - 1'));
});

test('USI 指し手の変換', () => {
  assert.deepEqual(ShogiEngine.usiToMove('7g7f'), { from: { x: 2, y: 6 }, to: { x: 2, y: 5 }, promote: false, isDrop: false, dropPieceType: null });
  assert.equal(ShogiEngine.usiToMove('8h2b+').promote, true);
  assert.equal(ShogiEngine.usiToMove('P*5e').dropPieceType, 'FU');
  assert.equal(ShogiEngine.usiToMove('resign'), null);
  for (const u of ['7g7f', '8h2b+', 'P*5e', 'R*1a', '1i1h']) {
    assert.equal(ShogiEngine.moveToUsi(ShogiEngine.usiToMove(u)), u);
  }
});

test('駒落ちの初期局面と手番', () => {
  const e = new ShogiEngine();
  e.reset('nimai');
  assert.equal(e.turn, GOTE);
  assert.equal(e.toSfen(), 'lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1');
  e.reset('kyo');
  assert.equal(e.toSfen(), '1nsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1');
});

test('二歩は打てない', () => {
  const e = fromSfen('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
  const drops = legalUsi(e).filter(u => u.startsWith('P*'));
  assert.ok(!drops.some(u => u.startsWith('P*5')), '5筋には打てない');
  assert.ok(drops.includes('P*4e'));
});

test('行き所のない駒は打てない・成らずに進めない', () => {
  const e = fromSfen('4k4/9/9/9/9/9/9/9/4K4 b PLN 1');
  const moves = legalUsi(e);
  assert.ok(!moves.some(u => /^[PL]\*\da$/.test(u)), '歩・香は1段目に打てない');
  assert.ok(!moves.some(u => /^N\*\d[ab]$/.test(u)), '桂は1・2段目に打てない');
  const e2 = fromSfen('4k4/9/P8/9/9/9/9/9/4K4 b - 1');
  assert.ok(e2.isLegalMove(ShogiEngine.usiToMove('9c9b+')));
  assert.ok(e2.isLegalMove(ShogiEngine.usiToMove('9c9b')), '2段目への不成は可');
  const e3 = fromSfen('4k4/P8/9/9/9/9/9/9/4K4 b - 1');
  assert.ok(!e3.isLegalMove(ShogiEngine.usiToMove('9b9a')), '1段目への歩の不成は不可');
  assert.ok(e3.isLegalMove(ShogiEngine.usiToMove('9b9a+')));
});

test('打ち歩詰めは禁止、突き歩詰めは可', () => {
  // 後手玉1一。1二に歩を打つと詰む（2二は金、1二は金と香が守る）
  const e = fromSfen('7nk/9/7G1/9/9/9/9/9/K7L b P 1');
  assert.ok(!e.isLegalMove(ShogiEngine.usiToMove('P*1b')), '打ち歩詰め');
  assert.ok(e.isLegalMove(ShogiEngine.usiToMove('P*1c')), '詰まない場所には打てる');
  // 同じ形で盤上の歩を突いて詰ますのは合法
  const e2 = fromSfen('7nk/9/7GP/9/9/9/9/9/K7L b - 1');
  assert.ok(e2.isLegalMove(ShogiEngine.usiToMove('1c1b')));
  play(e2, '1c1b');
  assert.equal(e2.isGameOver, true);
  assert.equal(e2.gameOverReason, '詰み');
});

test('王手放置・自殺手は指せない', () => {
  // 先手玉5九、後手飛5一で王手。玉以外の手で王手を外さない手は不可
  const e = fromSfen('4r4/9/9/9/9/9/9/9/P3K4 b - 1');
  const moves = legalUsi(e);
  assert.ok(!moves.includes('9i9h'));
  assert.ok(moves.every(u => u.startsWith('5i')));
  assert.ok(!moves.includes('5i5h'), '飛の利きに入る手は不可');
});

test('詰みで終局し勝者が決まる', () => {
  const e = new ShogiEngine();
  e.reset();
  play(e, '7g7f 3c3d 8h2b+'); // まだ詰みではない
  assert.equal(e.isGameOver, false);
  // 頭金
  const m = fromSfen('4k4/9/4P4/9/9/9/9/9/4K4 b G 1');
  play(m, 'G*5b');
  assert.equal(m.isGameOver, true);
  assert.equal(m.winner, SENTE);
  assert.equal(m.gameOverReason, '詰み');
});

test('待った（一手戻し）で局面・持ち駒・手番・終局状態が元に戻る', () => {
  const e = new ShogiEngine();
  e.reset();
  play(e, '7g7f 3c3d 8h2b+');
  const before = e.toSfen();
  play(e, '3a2b');
  assert.equal(e.hands[GOTE].KA, 1);
  e.undoMove();
  assert.equal(e.toSfen(), before);
  assert.equal(e.hands[GOTE].KA, 0);
  assert.equal(e.history.length, 3);

  const m = fromSfen('4k4/9/4P4/9/9/9/9/9/4K4 b G 1');
  play(m, 'G*5b');
  assert.equal(m.isGameOver, true);
  m.undoMove();
  assert.equal(m.isGameOver, false);
  assert.equal(m.winner, null);
  assert.equal(m.hands[SENTE].KI, 1);
});

test('千日手（同一局面4回）で引き分け', () => {
  const e = new ShogiEngine();
  e.reset();
  const cycle = '2h3h 8b7b 3h2h 7b8b ';
  play(e, cycle.repeat(2) + '2h3h 8b7b 3h2h');
  assert.equal(e.isGameOver, false);
  play(e, '7b8b');
  assert.equal(e.isGameOver, true);
  assert.equal(e.winner, null);
  assert.equal(e.isDraw, true);
  assert.equal(e.gameOverReason, '千日手');
  e.undoMove();
  assert.equal(e.isGameOver, false, '待ったで千日手も取り消せる');
});

test('連続王手の千日手は王手をかけた側の負け', () => {
  // 先手飛車で後手玉に王手をかけ続ける
  const e = fromSfen('k8/9/9/9/9/9/9/9/1R6K b - 1');
  const cycle = '8i9i 9a8a 9i8i 8a9a ';
  play(e, cycle.repeat(3).trim());
  assert.equal(e.isGameOver, true);
  assert.equal(e.gameOverReason, '連続王手の千日手');
  assert.equal(e.winner, GOTE);
});

test('入玉宣言（24点法）', () => {
  // 先手玉が敵陣。敵陣に飛角(10点)+小駒11枚(11点)、持駒 金2・銀2・歩6 (10点) → 31点で勝ち
  const win = fromSfen('KRBGGSSNN/LLPPP4/9/9/9/9/9/9/8k b 2G2S6P 1');
  const ev = win.evaluateDeclaration();
  assert.equal(ev.piecesInCamp, 13);
  assert.equal(ev.result, 'win');
  win.declare();
  assert.equal(win.isGameOver, true);
  assert.equal(win.winner, SENTE);
  assert.equal(win.gameOverReason, '入玉宣言勝ち');

  assert.equal(ev.points, 31);

  // 24〜30点は持将棋（引き分け）: 敵陣 飛角+小駒8枚=18点、持駒 金2・歩4=6点 → 24点
  const draw = fromSfen('KRBGGSSNN/LL7/9/9/9/9/9/9/8k b 2G4P 1');
  const ev2 = draw.evaluateDeclaration();
  assert.equal(ev2.points, 24);
  assert.equal(ev2.result, 'draw');
  draw.declare();
  assert.equal(draw.isDraw, true);
  assert.equal(draw.gameOverReason, '持将棋');

  // 条件不足（敵陣の駒が10枚未満・玉が敵陣にいない・王手中）
  assert.equal(fromSfen('KRB6/9/9/9/9/9/9/9/8k b 2G4P 1').evaluateDeclaration().result, 'invalid');
  assert.equal(fromSfen('RBGGSSNNL/L8/9/9/9/9/9/9/K7k b 2G4P 1').evaluateDeclaration().result, 'invalid');
  assert.equal(fromSfen('KRBGGSSNN/L1L6/9/3b5/9/9/9/9/8k b 2G4P 1').evaluateDeclaration().reason, '王手がかかっています');
  // 手番でない側は宣言できない
  assert.equal(fromSfen('KRBGGSSNN/LLPPP4/9/9/9/9/9/9/8k w 2G2S6P 1').evaluateDeclaration(SENTE).result, 'invalid');
});

test('駒落ちの入玉宣言では上手に落とした駒の点数を加える', () => {
  const e = new ShogiEngine();
  e.reset('nimai'); // 飛角落ち: 上手に10点加算
  assert.equal(e.missingPointsForHandicap(), 10);
});
