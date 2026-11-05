// Análise de partida: avaliação com Stockfish, classificação de lances e precisão
import { Chess } from '/vendor/chess.js';
import { detectBrilliant } from './brilliant.js';

export const CLASSES = {
  brilliant: { label: 'Brilhante', symbol: '!!', color: '#1baca6' },
  great: { label: 'Ótimo lance', symbol: '!', color: '#5c8bb0' },
  best: { label: 'Melhor', symbol: '★', color: '#81b64c' },
  excellent: { label: 'Excelente', symbol: '✦', color: '#96bc4b' },
  good: { label: 'Bom', symbol: '✓', color: '#95b776' },
  forced: { label: 'Forçado', symbol: '→', color: '#97a38f' },
  inaccuracy: { label: 'Imprecisão', symbol: '?!', color: '#f0c02e' },
  mistake: { label: 'Erro', symbol: '?', color: '#e58f2a' },
  miss: { label: 'Chance perdida', symbol: '✕', color: '#ee6b5d' },
  blunder: { label: 'Capivarada', symbol: '??', color: '#ca3431' },
};
export const CLASS_ORDER = Object.keys(CLASSES);
const ERROR_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAMES = { p: 'Peão', n: 'Cavalo', b: 'Bispo', r: 'Torre', q: 'Dama', k: 'Rei' };

// ---------- utilidades ----------
export function winPct(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function formatEval(ev) {
  if (!ev) return '';
  if (ev.terminal) return ev.win === 100 ? '1-0' : ev.win === 0 ? '0-1' : '½-½';
  if (ev.mate != null) return (ev.mate > 0 ? '+M' : '-M') + Math.abs(ev.mate);
  const v = ev.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

export function pvToSan(fen, pv, max = 8) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    try {
      out.push(c.move(uciToMove(u)).san);
    } catch {
      break;
    }
  }
  return out;
}

function balance(chess, color) {
  let s = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq) s += (sq.color === color ? 1 : -1) * VALUES[sq.type];
    }
  }
  return s;
}

function nonPawnMaterial(chess) {
  let s = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== 'p') s += VALUES[sq.type];
  return s;
}

// ---------- leitura do PGN ----------
export function parseGame(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders ? chess.getHeaders() : chess.header();
  const history = chess.history({ verbose: true });

  const clocks = [...pgn.matchAll(/%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)/g)].map(
    (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  );

  const plies = history.map((m, i) => {
    const before = new Chess(m.before);
    const moveNumber = Number(m.before.split(' ')[5]);
    const npm = nonPawnMaterial(before);
    const phase = npm <= 26 ? 'endgame' : moveNumber <= 12 ? 'opening' : 'middlegame';
    return {
      index: i,
      san: m.san,
      uci: m.from + m.to + (m.promotion || ''),
      from: m.from,
      to: m.to,
      piece: m.piece,
      color: m.color,
      captured: m.captured,
      promotion: m.promotion,
      fenBefore: m.before,
      fenAfter: m.after,
      moveNumber,
      phase,
      legalCount: before.moves().length,
      clock: clocks.length === history.length ? clocks[i] : null,
    };
  });

  // tempo gasto por lance (usa incremento do TimeControl, ex.: "600+5")
  const [base, inc] = String(headers.TimeControl || '').split('+').map(Number);
  plies.forEach((p, i) => {
    if (p.clock == null) return;
    const prevOwn = i >= 2 ? plies[i - 2].clock : base;
    if (prevOwn != null && !Number.isNaN(prevOwn)) p.timeSpent = Math.max(0, prevOwn - p.clock + (inc || 0));
  });

  const startFen = history.length ? history[0].before : chess.fen();
  return { headers, plies, startFen, baseTime: Number.isNaN(base) ? null : base, increment: inc || 0 };
}

// ---------- avaliação ----------
async function evaluatePosition(engine, fen, depth) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { terminal: true, win: c.turn() === 'w' ? 0 : 100, cp: null, mate: null, lines: [] };
  if (c.isStalemate() || c.isInsufficientMaterial() || c.isDraw())
    return { terminal: true, win: 50, cp: 0, mate: null, lines: [] };

  const r = await engine.analyse(fen, depth);
  const sign = c.turn() === 'w' ? 1 : -1;
  const lines = r.lines.map((l) => {
    const cp = l.cp != null ? sign * l.cp : null;
    const mate = l.mate != null ? sign * l.mate : null;
    const win = mate != null ? (mate > 0 ? 100 : 0) : winPct(cp);
    return { cp, mate, win, pv: l.pv };
  });
  const top = lines[0] || { cp: 0, mate: null, win: 50, pv: [r.bestmove] };
  return { cp: top.cp, mate: top.mate, win: top.win, best: top.pv[0] || r.bestmove, lines };
}

export async function analyzeGame(game, engine, depth, onProgress, isCancelled) {
  const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled && isCancelled()) return null;
    evals.push(await evaluatePosition(engine, fens[i], depth));
    onProgress && onProgress(i + 1, fens.length);
  }
  classify(game, evals);
  await findBrilliants(game, evals, engine, depth);
  game.evals = evals;
  game.summary = { w: summarize(game, 'w'), b: summarize(game, 'b') };
  return game;
}

// ---------- classificação ----------
// Segunda passada: promove a "Brilhante" os lances bons que são sacrifícios com ideia (ver brilliant.js)
async function findBrilliants(game, evals, engine, depth) {
  for (const ply of game.plies) {
    if (!['best', 'great', 'excellent'].includes(ply.cls)) continue;
    const res = await detectBrilliant(ply, evals[ply.index], evals[ply.index + 1], engine, depth);
    if (res) {
      ply.cls = 'brilliant';
      ply.brilliantIdea = res.idea;
      ply.brilliantLine = res.line;
    }
  }
}

// Precisão de um lance a partir da chance de vitória antes/depois (fórmula pública do Lichess)
function moveAccuracy(before, after) {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1)); // +1: bônus de incerteza do motor
}

// Quanto material o jogador perde (em pontos) seguindo a melhor linha do motor após o lance
function materialLost(ply, afterEval) {
  const pv = (afterEval.lines[0] && afterEval.lines[0].pv) || [];
  const startBal = balance(new Chess(ply.fenBefore), ply.color);
  const sim = new Chess(ply.fenAfter);
  const checkpoints = [];
  for (let k = 0; k < Math.min(pv.length, 4); k++) {
    try {
      sim.move(uciToMove(pv[k]));
    } catch {
      break;
    }
    if (k === 1 || k === 3) checkpoints.push(balance(sim, ply.color));
  }
  if (!checkpoints.length) return 0;
  return startBal - Math.max(...checkpoints);
}

function classify(game, evals) {
  const { plies } = game;
  plies.forEach((ply, i) => {
    const before = evals[i];
    const after = evals[i + 1];
    const persp = (w) => (ply.color === 'w' ? w : 100 - w);
    const wBefore = persp(before.win);
    const wAfter = persp(after.win);
    const isBest = before.best === ply.uci;
    const loss = isBest ? 0 : Math.max(0, wBefore - wAfter);

    ply.wBefore = wBefore;
    ply.wAfter = wAfter;
    ply.loss = loss;
    ply.isBest = isBest;
    ply.accuracy = moveAccuracy(wBefore, wAfter);
    ply.bestUci = before.best;
    ply.bestSan = before.best ? pvToSan(ply.fenBefore, [before.best])[0] : null;
    ply.bestLine = before.lines[0] ? pvToSan(ply.fenBefore, before.lines[0].pv, 8) : [];
    ply.bestEval = before;
    ply.evalAfter = after;

    const prev = plies[i - 1];
    let cls;
    if (ply.legalCount === 1) cls = 'forced';
    else if (isBest && before.lines.length > 1) {
      const gap = wBefore - persp(before.lines[1].win);
      const obviousRecapture = prev && prev.captured && ply.captured && prev.to === ply.to;
      cls = gap >= 15 && !obviousRecapture ? 'great' : 'best';
    } else if (isBest) cls = 'best';
    else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss >= 10 && prev && prev.loss >= 10 && wBefore >= 55 && wAfter >= 30) cls = 'miss';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';
    ply.cls = cls;

    // contexto extra para os insights
    if (ERROR_CLASSES.has(cls)) {
      const c = new Chess(ply.fenAfter);
      if (after.best) {
        try {
          const reply = c.move(uciToMove(after.best));
          ply.refutation = reply.san;
          if (reply.captured && VALUES[reply.captured] >= 3 && materialLost(ply, after) >= 2) ply.hungPiece = reply.captured;
        } catch {}
      }
      if (after.mate != null && persp(after.mate > 0 ? 100 : 0) === 0) ply.allowedMate = Math.abs(after.mate);
      if (before.mate != null && persp(before.mate > 0 ? 100 : 0) === 100) ply.missedMate = Math.abs(before.mate);
      if (ply.bestSan) {
        ply.bestWasCapture = ply.bestSan.includes('x');
        ply.bestWasCheck = /[+#]/.test(ply.bestSan);
      }
    }
  });
}

function harmonicMean(arr) {
  return arr.length / arr.reduce((s, x) => s + 1 / Math.max(x, 1), 0);
}

function stdDev(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / arr.length);
}

// Precisão da partida pelo método do Lichess: média ponderada pela volatilidade da
// avaliação (momentos críticos pesam mais que lances em posição já decidida),
// combinada com a média harmônica (que pune erros graves).
function gameAccuracy(game, color) {
  const wins = game.evals.map((e) => e.win);
  const n = game.plies.length;
  if (!n) return null;
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows = [];
  for (let k = 0; k < size - 2; k++) windows.push(wins.slice(0, size));
  for (let k = 0; k + size <= wins.length; k++) windows.push(wins.slice(k, k + size));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));

  const accs = [];
  let sum = 0;
  let wsum = 0;
  game.plies.forEach((p, i) => {
    if (p.color !== color) return;
    const weight = weights[i] ?? weights[weights.length - 1] ?? 1;
    accs.push(p.accuracy);
    sum += p.accuracy * weight;
    wsum += weight;
  });
  if (!accs.length) return null;
  return (sum / wsum + harmonicMean(accs)) / 2;
}

function accuracyOf(moves) {
  const accs = moves.filter((p) => p.cls !== 'forced').map((p) => p.accuracy);
  if (!accs.length) return null;
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  return (mean + harmonicMean(accs)) / 2;
}

function summarize(game, color) {
  const moves = game.plies.filter((p) => p.color === color);
  const counts = Object.fromEntries(CLASS_ORDER.map((k) => [k, 0]));
  moves.forEach((p) => counts[p.cls]++);
  const phases = {};
  for (const ph of ['opening', 'middlegame', 'endgame']) {
    const m = moves.filter((p) => p.phase === ph);
    phases[ph] = { moves: m.length, accuracy: accuracyOf(m) };
  }
  return { accuracy: gameAccuracy(game, color), counts, phases, moves };
}

// ---------- rating estimado ----------
// Desempenho "puro" da precisão (método Lichess) em rating. A relação real é muito ruidosa:
// numa única partida a precisão varia bastante para o mesmo jogador.
const ACC_TO_PERF = [
  [50, 200], [60, 400], [70, 700], [80, 1100], [85, 1400], [90, 1800],
  [93, 2200], [95, 2500], [97, 2800], [99, 3200], [100, 3400],
];
const SHRINK = 0.35; // quanto uma partida completa move a estimativa a partir do rating real

function perfFromAccuracy(acc) {
  const a = Math.max(50, Math.min(100, acc));
  for (let i = 1; i < ACC_TO_PERF.length; i++) {
    const [a1, r1] = ACC_TO_PERF[i - 1];
    const [a2, r2] = ACC_TO_PERF[i];
    if (a <= a2) return r1 + ((a - a1) / (a2 - a1)) * (r2 - r1);
  }
  return 3400;
}

// Parte do rating real do jogador (quando conhecido) e se desloca em direção ao desempenho
// da partida, com peso proporcional à quantidade de lances analisados (encolhimento bayesiano).
export function estimateRating(summary, realElo) {
  const counted = summary.moves.filter((p) => p.cls !== 'forced').length;
  if (summary.accuracy == null || counted < 8) return null; // partida curta demais
  const perf = perfFromAccuracy(summary.accuracy);
  const prior = Number(realElo);
  const est = prior > 0 ? prior + SHRINK * Math.min(1, counted / 30) * (perf - prior) : perf;
  return Math.round(est / 25) * 25;
}
