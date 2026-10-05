// kifu.js - 棋譜 (KIF / SFEN / USI) の出力・読み込み

import { ShogiEngine, SENTE, GOTE, STARTPOS_SFEN } from './shogi-engine.js';

const ZEN_DIGITS = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
const KAN_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

// KIF 表記の駒名（移動前の駒）
const KIF_PIECE_NAMES = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉',
  TO: 'と', NY: '成香', NK: '成桂', NG: '成銀', UM: '馬', RY: '龍'
};
// 読み込み時に受け付ける別表記
const KIF_PIECE_ALIASES = {
  '歩': 'FU', '香': 'KY', '桂': 'KE', '銀': 'GI', '金': 'KI', '角': 'KA', '飛': 'HI', '玉': 'OU', '王': 'OU',
  'と': 'TO', '成香': 'NY', '杏': 'NY', '成桂': 'NK', '圭': 'NK', '成銀': 'NG', '全': 'NG', '馬': 'UM', '龍': 'RY', '竜': 'RY'
};
// 局面図 (BOD) の駒表記
const BOD_PIECES = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉',
  TO: 'と', NY: '杏', NK: '圭', NG: '全', UM: '馬', RY: '龍'
};

export const HANDICAP_KIF_NAMES = {
  hirate: '平手', kyo: '香落ち', kaku: '角落ち', hisha: '飛車落ち', hishakyo: '飛香落ち',
  nimai: '二枚落ち', yonmai: '四枚落ち', rokumai: '六枚落ち', hachimai: '八枚落ち', jumai: '十枚落ち'
};

// 終局理由 → KIF の終局語
const END_WORDS = {
  '詰み': '詰み', '手詰まり': '詰み', '投了': '投了', '時間切れ': '切れ負け',
  '千日手': '千日手', '連続王手の千日手': '反則負け', '入玉宣言勝ち': '入玉勝ち', '持将棋': '持将棋'
};

const toZenkaku = (n) => String(n).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xFEE0));

// 1手分の KIF 表記（例: "７六歩(77)", "同　角成(88)", "５五角打"）。
// record は ShogiEngine.history の要素、prev は直前の要素（同○判定用）。
export function moveToKif(record, prev) {
  const { to, from, isDrop, promote } = record;
  const same = prev && prev.to.y === to.y && prev.to.x === to.x;
  const dest = same ? '同　' : `${ZEN_DIGITS[9 - to.x]}${KAN_DIGITS[to.y + 1]}`;
  const name = KIF_PIECE_NAMES[record.pieceType];
  if (isDrop) return `${dest}${name}打`;

  let suffix = '';
  if (promote) {
    suffix = '成';
  } else if (canPromoteRecord(record)) {
    suffix = '不成';
  }
  return `${dest}${name}${suffix}(${9 - from.x}${from.y + 1})`;
}

function canPromoteRecord(record) {
  const unpromoted = ['FU', 'KY', 'KE', 'GI', 'KA', 'HI'];
  if (!unpromoted.includes(record.pieceType)) return false;
  const inZone = (y) => (record.turn === SENTE ? y <= 2 : y >= 6);
  return inZone(record.from.y) || inZone(record.to.y);
}

// サイドバー等の表示用（"▲７六歩(77)" 形式）
export function moveToDisplay(record, prev) {
  return `${record.turn === SENTE ? '▲' : '△'}${moveToKif(record, prev)}`;
}

function pad(n, w) {
  return String(n).padStart(w, ' ');
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 局面図 (BOD) を出力する。初期局面が平手・駒落ちの定型でない場合に使う。
function engineToBod(engine) {
  const lines = [];
  const handText = (owner) => {
    const order = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];
    const parts = [];
    for (const t of order) {
      const c = engine.hands[owner][t];
      if (!c) continue;
      parts.push(`${BOD_PIECES[t]}${c > 1 ? KAN_NUMBER(c) : ''}`);
    }
    return parts.length ? parts.join('　') + '　' : 'なし';
  };
  lines.push(`後手の持駒：${handText(GOTE)}`);
  lines.push('  ９ ８ ７ ６ ５ ４ ３ ２ １');
  lines.push('+---------------------------+');
  for (let y = 0; y < 9; y++) {
    let row = '|';
    for (let x = 0; x < 9; x++) {
      const p = engine.board[y][x];
      row += p ? `${p.owner === GOTE ? 'v' : ' '}${BOD_PIECES[p.type]}` : ' ・';
    }
    row += `|${KAN_DIGITS[y + 1]}`;
    lines.push(row);
  }
  lines.push('+---------------------------+');
  lines.push(`先手の持駒：${handText(SENTE)}`);
  if (engine.turn === GOTE) lines.push('後手番');
  return lines;
}

function KAN_NUMBER(n) {
  if (n <= 9) return KAN_DIGITS[n];
  if (n < 20) return '十' + (n % 10 ? KAN_DIGITS[n % 10] : '');
  return KAN_DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? KAN_DIGITS[n % 10] : '');
}

function parseKanNumber(s) {
  if (!s) return 1;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let n = 0;
  const idx = s.indexOf('十');
  if (idx >= 0) {
    const tens = idx === 0 ? 1 : KAN_DIGITS.indexOf(s[idx - 1]);
    n = tens * 10;
    const rest = s.slice(idx + 1);
    if (rest) n += KAN_DIGITS.indexOf(rest);
    return n;
  }
  return KAN_DIGITS.indexOf(s);
}

// 初期局面が手合割の定型と一致するか
function handicapStartSfen(handicap) {
  const e = new ShogiEngine();
  e.reset(handicap);
  return e.initialSfen;
}

// ShogiEngine の対局を KIF 文字列に変換する
// meta: { senteName, goteName, startDate, endReason, winner }
export function exportKif(engine, meta = {}) {
  const lines = ['# KIF形式棋譜ファイル (漆黒の3D将棋)'];
  lines.push(`開始日時：${formatDate(meta.startDate ? new Date(meta.startDate) : new Date())}`);

  const handicap = engine.handicap || 'hirate';
  const isHandicap = handicap !== 'hirate';
  const standardStart = engine.initialSfen === handicapStartSfen(handicap);
  if (standardStart) {
    lines.push(`手合割：${HANDICAP_KIF_NAMES[handicap] || '平手'}`);
  } else {
    const start = new ShogiEngine();
    start.loadSfen(engine.initialSfen, handicap);
    lines.push(...engineToBod(start));
  }
  lines.push(`${isHandicap ? '下手' : '先手'}：${meta.senteName || ''}`);
  lines.push(`${isHandicap ? '上手' : '後手'}：${meta.goteName || ''}`);
  lines.push('手数----指手---------消費時間--');

  engine.history.forEach((rec, i) => {
    lines.push(`${pad(i + 1, 4)} ${moveToKif(rec, engine.history[i - 1])}`);
  });

  const n = engine.history.length;
  if (engine.isGameOver && engine.gameOverReason) {
    const word = END_WORDS[engine.gameOverReason] || '中断';
    // 詰み・手詰まりは最終手で終局しているので終局語の手数は次の手
    lines.push(`${pad(n + 1, 4)} ${word}`);
    if (engine.winner === null || engine.isDraw) {
      lines.push(`まで${n}手で${engine.gameOverReason}`);
    } else {
      const winnerName = engine.winner === SENTE ? (isHandicap ? '下手' : '先手') : (isHandicap ? '上手' : '後手');
      lines.push(`まで${n}手で${winnerName}の勝ち`);
    }
  } else if (meta.endReason) {
    lines.push(`${pad(n + 1, 4)} 中断`);
    lines.push(`まで${n}手で中断`);
  }
  return lines.join('\n') + '\n';
}

// ===== 読み込み =====

// ArrayBuffer をテキストへ。UTF-8 で読めなければ Shift_JIS とみなす（.kif は Shift_JIS が多い）。
export function decodeKifuBuffer(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch (e) {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

// 棋譜テキストを自動判別して読み込む。
// 戻り値: { initialSfen, handicap, moves: [内部指し手...], senteName, goteName, format }
export function parseKifuText(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('棋譜が空です');
  if (/^(position\s+)?(startpos|sfen\s)/.test(trimmed) || /^[1-9lnsgkrbpLNSGKRBP+/]+\s+[bw]\s+\S+/.test(trimmed)) {
    return parseUsiPosition(trimmed);
  }
  return parseKif(trimmed);
}

// "position startpos moves 7g7f ..." / "sfen <...> moves ..." / 素の SFEN
export function parseUsiPosition(text) {
  let s = text.trim().replace(/^position\s+/, '');
  let movesPart = '';
  const mi = s.indexOf(' moves ');
  if (mi >= 0) {
    movesPart = s.slice(mi + 7).trim();
    s = s.slice(0, mi).trim();
  } else if (s.endsWith(' moves')) {
    s = s.slice(0, -6).trim();
  }
  const sfen = s === 'startpos' ? STARTPOS_SFEN : s.replace(/^sfen\s+/, '');

  const engine = new ShogiEngine();
  engine.loadSfen(sfen, guessHandicap(sfen));
  const moves = [];
  if (movesPart) {
    for (const token of movesPart.split(/\s+/)) {
      const mv = ShogiEngine.usiToMove(token);
      if (!mv || !engine.isLegalMove(mv)) throw new Error(`${moves.length + 1}手目 (${token}) が不正な指し手です`);
      engine.makeMove(mv.from, mv.to, mv.promote, mv.isDrop, mv.dropPieceType);
      moves.push(mv);
    }
  }
  return { initialSfen: engine.initialSfen, handicap: engine.handicap, moves, senteName: '', goteName: '', format: 'SFEN/USI' };
}

// 定型の駒落ち初期局面ならその手合割名を返す（入玉宣言の駒落ち規定に使う）
function guessHandicap(sfen) {
  const key = sfen.split(/\s+/).slice(0, 3).join(' ');
  for (const h of Object.keys(HANDICAP_KIF_NAMES)) {
    if (handicapStartSfen(h).split(' ').slice(0, 3).join(' ') === key) return h;
  }
  return 'hirate';
}

export function parseKif(text) {
  const lines = text.split(/\r?\n/);
  let handicap = 'hirate';
  let senteName = '';
  let goteName = '';
  const bodRows = [];
  const bodHands = { [SENTE]: null, [GOTE]: null };
  let bodTurn = null;
  const moveTokens = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#') || line.startsWith('*') || line.startsWith('&')) continue;
    if (/^変化：/.test(line)) break; // 分岐以降は読まない（本譜のみ）

    let m;
    if ((m = /^手合割：\s*(\S+)/.exec(line))) {
      const name = m[1];
      const found = Object.entries(HANDICAP_KIF_NAMES).find(([, v]) => v === name || name.startsWith(v));
      if (name === '平手') handicap = 'hirate';
      else if (found) handicap = found[0];
      else if (name !== 'その他') throw new Error(`未対応の手合割です: ${name}`);
      continue;
    }
    if ((m = /^(先手|下手)：(.*)$/.exec(line))) { senteName = m[2].trim(); continue; }
    if ((m = /^(後手|上手)：(.*)$/.exec(line))) { goteName = m[2].trim(); continue; }
    if ((m = /^(先手|下手)の持駒：(.*)$/.exec(line))) { bodHands[SENTE] = m[2]; continue; }
    if ((m = /^(後手|上手)の持駒：(.*)$/.exec(line))) { bodHands[GOTE] = m[2]; continue; }
    if (/^(後手|上手)番/.test(line)) { bodTurn = GOTE; continue; }
    if (/^(先手|下手)番/.test(line)) { bodTurn = SENTE; continue; }
    if (/^\|.*\|/.test(line)) { bodRows.push(line); continue; }
    if ((m = /^\s*(\d+)\s+(同[\s　]*\S+|\S+)/.exec(line))) { moveTokens.push(m[2]); continue; }
  }

  const engine = new ShogiEngine();
  if (bodRows.length === 9) {
    engine.reset('hirate');
    engine.board = parseBodRows(bodRows);
    engine.hands = {
      [SENTE]: parseBodHand(bodHands[SENTE]),
      [GOTE]: parseBodHand(bodHands[GOTE])
    };
    engine.turn = bodTurn ?? (handicap === 'hirate' ? SENTE : GOTE);
    engine.loadSfen(engine.toSfen(), handicap);
  } else {
    engine.reset(handicap);
  }

  const moves = [];
  for (const token of moveTokens) {
    if (/^(投了|中断|千日手|詰み|持将棋|切れ負け|反則勝ち|反則負け|入玉勝ち|不戦勝|不戦敗|宣言勝ち)/.test(token)) break;
    const mv = parseKifMove(token, engine);
    if (!mv) throw new Error(`${moves.length + 1}手目「${token}」を読み取れません`);
    if (!engine.isLegalMove(mv)) throw new Error(`${moves.length + 1}手目「${token}」は不正な指し手です`);
    engine.makeMove(mv.from, mv.to, mv.promote, mv.isDrop, mv.dropPieceType);
    moves.push(mv);
    if (engine.isGameOver) break;
  }

  return { initialSfen: engine.initialSfen, handicap, moves, senteName, goteName, format: 'KIF' };
}

function parseBodRows(rows) {
  const board = Array(9).fill(null).map(() => Array(9).fill(null));
  rows.forEach((row, y) => {
    const inner = row.slice(1, row.lastIndexOf('|'));
    // 1マス = 2文字（' 歩' / 'v歩' / ' ・'）。成香等の1文字表記のみ対応。
    for (let x = 0; x < 9; x++) {
      const cell = inner.slice(x * 2, x * 2 + 2);
      const ch = cell[1];
      if (!ch || ch === '・') continue;
      const type = KIF_PIECE_ALIASES[ch];
      if (!type) throw new Error(`局面図の駒「${ch}」を読み取れません`);
      board[y][x] = { type, owner: cell[0] === 'v' ? GOTE : SENTE };
    }
  });
  return board;
}

function parseBodHand(text) {
  const hand = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
  if (!text || text.trim() === 'なし') return hand;
  for (const part of text.trim().split(/[\s　]+/)) {
    if (!part) continue;
    const type = KIF_PIECE_ALIASES[part[0]];
    if (!type || !(type in hand)) continue;
    hand[type] += parseKanNumber(part.slice(1));
  }
  return hand;
}

// 1手の KIF 表記を解析する。移動元 "(77)" があればそれを使い、無ければ盤面から一意に特定する。
function parseKifMove(token, engine) {
  const m = /^(?:([１-９1-9])([一二三四五六七八九1-9])|同[\s　]*)(成香|成桂|成銀|[歩香桂銀金角飛玉王と杏圭全馬龍竜])(.*?)(?:\((\d)(\d)\))?$/.exec(token);
  if (!m) return null;

  let to;
  if (m[1]) {
    const file = parseInt(m[1].replace(/[１-９]/, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)), 10);
    const rankChar = m[2];
    const rank = /[1-9]/.test(rankChar) ? parseInt(rankChar, 10) : KAN_DIGITS.indexOf(rankChar);
    to = { x: 9 - file, y: rank - 1 };
  } else {
    const prev = engine.history[engine.history.length - 1];
    if (!prev) return null;
    to = { ...prev.to };
  }

  const pieceType = KIF_PIECE_ALIASES[m[3]];
  const modifier = m[4] || '';
  const isDrop = modifier.includes('打');
  const promote = /(^|[^不])成/.test(modifier) && !modifier.includes('不成');

  if (m[5]) {
    const from = { x: 9 - parseInt(m[5], 10), y: parseInt(m[6], 10) - 1 };
    return { from, to, promote, isDrop: false, dropPieceType: null };
  }

  const legal = engine.generateAllLegalMoves().filter(mv =>
    mv.to.y === to.y && mv.to.x === to.x && mv.promote === promote
  );
  if (isDrop) {
    return legal.find(mv => mv.isDrop && mv.dropPieceType === pieceType) || null;
  }
  const candidates = legal.filter(mv => !mv.isDrop && engine.board[mv.from.y][mv.from.x].type === pieceType);
  if (candidates.length === 1) return candidates[0];
  // 盤上に該当駒が無く持ち駒にある場合は「打」省略とみなす
  if (candidates.length === 0) return legal.find(mv => mv.isDrop && mv.dropPieceType === pieceType) || null;
  return null; // 移動元が曖昧（相対表記には未対応）
}

// 解析結果から、指定手数まで進めた ShogiEngine を作る
export function buildEngineFromRecord(record, ply = record.moves.length) {
  const engine = new ShogiEngine();
  engine.loadSfen(record.initialSfen, record.handicap || 'hirate');
  for (let i = 0; i < ply && i < record.moves.length; i++) {
    const mv = record.moves[i];
    if (!engine.makeMove(mv.from, mv.to, mv.promote, mv.isDrop, mv.dropPieceType)) break;
  }
  return engine;
}
