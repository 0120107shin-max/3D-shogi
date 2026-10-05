import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShogiEngine } from '../js/shogi-engine.js';
import { exportKif, parseKifuText, buildEngineFromRecord, decodeKifuBuffer, moveToKif } from '../js/kifu.js';
import { play, fromSfen } from './helpers.js';

function newGame(handicap = 'hirate') {
  const e = new ShogiEngine();
  e.reset(handicap);
  return e;
}

test('KIF の指し手表記（同・成・不成・打）', () => {
  const e = play(newGame(), '7g7f 3c3d 8h2b+ 3a2b B*4e');
  const k = e.history.map((h, i) => moveToKif(h, e.history[i - 1]));
  assert.deepEqual(k, ['７六歩(77)', '３四歩(33)', '２二角成(88)', '同　銀(31)', '４五角打']);
  const f = play(fromSfen('4k4/9/9/9/9/9/9/S8/4K4 b - 1'), '9h8g');
  assert.equal(moveToKif(f.history[0]), '８七銀(98)');
  const g = play(fromSfen('4k4/9/9/S8/9/9/9/9/4K4 b - 1'), '9d9c');
  assert.equal(moveToKif(g.history[0]), '９三銀不成(94)');
});

test('KIF 出力 → 読み込みで同じ局面になる（平手・投了）', () => {
  const e = play(newGame(), '7g7f 3c3d 8h2b+ 3a2b B*4e');
  e.setGameOver(e.turn === 1 ? -1 : 1, '投了');
  const kif = exportKif(e, { senteName: '先手さん', goteName: '後手さん' });
  assert.match(kif, /手合割：平手/);
  assert.match(kif, /先手：先手さん/);
  assert.match(kif, /   6 投了/);
  assert.match(kif, /まで5手で先手の勝ち/);
  const r = parseKifuText(kif);
  assert.equal(r.moves.length, 5);
  assert.equal(r.senteName, '先手さん');
  assert.equal(buildEngineFromRecord(r).toSfen(), e.toSfen());
});

test('駒落ちの KIF は手合割と下手・上手で出力され、読み戻せる', () => {
  const e = play(newGame('nimai'), '5a4b 7g7f');
  const kif = exportKif(e);
  assert.match(kif, /手合割：二枚落ち/);
  assert.match(kif, /下手：/);
  const r = parseKifuText(kif);
  assert.equal(r.handicap, 'nimai');
  assert.equal(buildEngineFromRecord(r).toSfen(), e.toSfen());
});

test('任意局面は局面図 (BOD) で出力され、読み戻せる', () => {
  const e = fromSfen('4k4/9/4G4/9/9/9/9/9/4K4 b G2Pp 1');
  play(e, 'G*5b');
  const kif = exportKif(e);
  assert.match(kif, /後手の持駒：歩/);
  assert.match(kif, /先手の持駒：金　歩二/);
  assert.match(kif, /詰み/);
  const r = parseKifuText(kif);
  assert.equal(r.initialSfen, '4k4/9/4G4/9/9/9/9/9/4K4 b G2Pp 1');
  assert.equal(buildEngineFromRecord(r).toSfen(), e.toSfen());
});

test('一般的な KIF（消費時間・コメント・変化）を読める', () => {
  const kif = [
    '# ---- 将棋ソフトで作成 ----',
    '開始日時：2026/01/01 10:00',
    '手合割：平手　　',
    '先手：A',
    '後手：B',
    '手数----指手---------消費時間--',
    '*対局開始のコメント',
    '   1 ２六歩(27)   ( 0:03/00:00:03)',
    '   2 ８四歩(83)   ( 0:01/00:00:01)',
    '*次は２五歩',
    '   3 ２五歩(26)   ( 0:02/00:00:05)',
    '   4 中断         ( 0:00/00:00:01)',
    'まで3手で中断',
    '',
    '変化：3手',
    '   3 ７六歩(77)   ( 0:01/00:00:04)'
  ].join('\r\n');
  const r = parseKifuText(kif);
  assert.equal(r.moves.length, 3);
  assert.equal(buildEngineFromRecord(r).toUsiPosition(), 'position startpos moves 2g2f 8c8d 2f2e');
});

test('移動元の無い KIF 表記（簡易表記）も盤面から特定できる', () => {
  const r = parseKifuText('1 ７六歩\n2 ３四歩\n3 ２二角成\n4 同銀\n5 ４五角');
  assert.equal(buildEngineFromRecord(r).toUsiPosition(), 'position startpos moves 7g7f 3c3d 8h2b+ 3a2b B*4e');
});

test('Shift_JIS の KIF ファイルを読める', () => {
  // 「手合割：平手」「１ ７六歩(77)」を Shift_JIS で表したバイト列
  const sjis = Uint8Array.from([
    0x8e, 0xe8, 0x8d, 0x87, 0x8a, 0x84, 0x81, 0x46, 0x95, 0xbd, 0x8e, 0xe8, 0x0d, 0x0a,
    0x20, 0x20, 0x20, 0x31, 0x20, 0x82, 0x56, 0x98, 0x5a, 0x95, 0xe0, 0x28, 0x37, 0x37, 0x29, 0x0d, 0x0a
  ]);
  const text = decodeKifuBuffer(sjis.buffer);
  assert.match(text, /手合割：平手/);
  const r = parseKifuText(text);
  assert.equal(r.moves.length, 1);
});

test('SFEN / USI position 文字列を読める', () => {
  assert.equal(parseKifuText('position startpos moves 7g7f 3c3d').moves.length, 2);
  assert.equal(parseKifuText('startpos').moves.length, 0);
  const r = parseKifuText('sfen lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1 moves 5a4b');
  assert.equal(r.handicap, 'nimai', '定型の駒落ち局面は手合割を推定する');
  assert.equal(r.moves.length, 1);
  const bare = parseKifuText('4k4/9/4G4/9/9/9/9/9/4K4 b G2Pp 1');
  assert.equal(bare.initialSfen, '4k4/9/4G4/9/9/9/9/9/4K4 b G2Pp 1');
});

test('不正な棋譜はエラーになる', () => {
  assert.throws(() => parseKifuText(''), /空/);
  assert.throws(() => parseKifuText('position startpos moves 7g7f 7g7f'), /2手目/);
  assert.throws(() => parseKifuText('1 ７五歩(77)'), /不正/);
  assert.throws(() => parseKifuText('1 ほげ'), /読み取れません/);
});
