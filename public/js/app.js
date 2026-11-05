import { Engine } from './engine.js';
import { parseGame, analyzeGame, CLASSES, CLASS_ORDER, formatEval, estimateRating } from './analysis.js';
import { Board } from './board.js';
import { buildInsights, describeMove } from './insights.js';

const $ = (id) => document.getElementById(id);
const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const TIME_CLASS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', daily: 'Diária' };
const PHASE_NAMES = { opening: 'Abertura', middlegame: 'Meio-jogo', endgame: 'Final' };
const MIN_GAMES = 30;

const state = (window.appState = {
  username: '',
  archives: [],
  nextArchive: -1,
  games: [],
  filter: 'all',
  game: null,
  ply: 0,
  flipped: false,
  engine: null,
  engineKind: null,
  runId: 0,
  analyzing: false,
  marks: {}, // setas/círculos do usuário por lance
});
const board = new Board($('board'));

// ---------------- navegação entre telas ----------------
function show(view) {
  for (const v of ['searchView', 'gamesView', 'analysisView']) $(v).hidden = v !== view;
  window.scrollTo(0, 0);
}

async function api(path) {
  const r = await fetch('/api/' + path);
  if (r.status === 404) throw new Error('Usuário não encontrado no chess.com.');
  if (!r.ok) throw new Error(`Erro ${r.status} ao consultar o chess.com.`);
  return r.json();
}

// ---------------- busca de partidas ----------------
$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('userInput').value.trim().toLowerCase();
  if (!username) return;
  const btn = e.submitter || $('searchForm').querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  $('searchError').hidden = true;
  try {
    await loadPlayer(username);
    try { localStorage.setItem('lastUser', username); } catch {}
    show('gamesView');
  } catch (err) {
    $('searchError').textContent = err.message;
    $('searchError').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar partidas';
  }
});

async function loadPlayer(username) {
  const { archives } = await api(`player/${encodeURIComponent(username)}/games/archives`);
  if (!archives.length) throw new Error('Esse usuário não tem partidas públicas.');
  state.username = username;
  state.archives = archives.map((u) => u.split('/pub/')[1]);
  state.nextArchive = state.archives.length - 1;
  state.games = [];
  renderProfile(username);
  await loadMoreGames();
}

async function loadMoreGames() {
  $('moreBtn').hidden = true;
  $('gamesStatus').textContent = 'Carregando partidas…';
  const target = state.games.length + MIN_GAMES;
  while (state.games.length < target && state.nextArchive >= 0) {
    const { games } = await api(state.archives[state.nextArchive--]);
    const std = games.filter((g) => g.rules === 'chess' && g.pgn).sort((a, b) => b.end_time - a.end_time);
    state.games.push(...std);
  }
  $('gamesStatus').textContent = state.games.length ? '' : 'Nenhuma partida encontrada.';
  $('moreBtn').hidden = state.nextArchive < 0;
  renderGameList();
}
$('moreBtn').addEventListener('click', loadMoreGames);

async function renderProfile(username) {
  $('profile').innerHTML = `<div><h2>${escapeHtml(username)}</h2></div>`;
  try {
    const [p, stats] = await Promise.all([api(`player/${username}`), api(`player/${username}/stats`).catch(() => ({}))]);
    const ratings = ['chess_bullet', 'chess_blitz', 'chess_rapid', 'chess_daily']
      .filter((k) => stats[k] && stats[k].last)
      .map((k) => `<span class="rating">${TIME_CLASS[k.slice(6)]} <b>${stats[k].last.rating}</b></span>`)
      .join('');
    $('profile').innerHTML = `
      ${p.avatar ? `<img src="${p.avatar}" alt="">` : ''}
      <div><h2>${escapeHtml(p.username || username)}</h2><div class="ratings">${ratings}</div></div>`;
  } catch {}
}

function outcomeFor(g, username) {
  const me = g.white.username.toLowerCase() === username ? g.white : g.black;
  if (me.result === 'win') return 'win';
  if (DRAW_RESULTS.has(me.result)) return 'draw';
  return 'loss';
}

function openingName(g) {
  const slug = ((g.eco || '').split('/openings/')[1] || '').split('...')[0];
  if (!slug) return '';
  const words = [];
  for (const w of slug.split('-')) {
    if (/^\.*\d/.test(w)) break;
    words.push(w);
  }
  return decodeURIComponent(words.join(' '));
}

function formatTc(tc) {
  if (tc.includes('/')) return `${Math.round(Number(tc.split('/')[1]) / 86400)}d`;
  const [base, inc] = tc.split('+').map(Number);
  return `${base >= 60 ? base / 60 : base + 's'}${inc ? '|' + inc : ''}`;
}

function renderGameList() {
  const u = state.username;
  const list = state.games.filter((g) => state.filter === 'all' || g.time_class === state.filter);
  $('gameList').innerHTML = list
    .map((g) => {
      const i = state.games.indexOf(g);
      const out = outcomeFor(g, u);
      const meWhite = g.white.username.toLowerCase() === u;
      const opp = meWhite ? g.black : g.white;
      const me = meWhite ? g.white : g.black;
      const date = new Date(g.end_time * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
      return `<li class="game ${out}" data-i="${i}">
        <span class="stripe"></span>
        <div class="tc"><b>${formatTc(g.time_control)}</b>${TIME_CLASS[g.time_class] || g.time_class}</div>
        <div class="who">
          <div><span class="dot ${meWhite ? 'b' : 'w'}"></span>vs <b>${escapeHtml(opp.username)}</b> <span class="muted">(${opp.rating})</span> <span class="muted small">· você ${me.rating}</span></div>
          <div class="opening">${escapeHtml(openingName(g))}</div>
        </div>
        <span class="result-pill">${out === 'win' ? 'Vitória' : out === 'loss' ? 'Derrota' : 'Empate'}</span>
        <span class="date">${date}</span>
      </li>`;
    })
    .join('');
  if (!list.length && state.games.length) $('gamesStatus').textContent = 'Nenhuma partida nesse ritmo — tente carregar partidas mais antigas.';
}

$('gameList').addEventListener('click', (e) => {
  const li = e.target.closest('.game');
  if (li) openGame(state.games[Number(li.dataset.i)]);
});

$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.filter = b.dataset.f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
  $('gamesStatus').textContent = '';
  renderGameList();
});

// ---------------- análise ----------------
function engineLabel(e) {
  const names = { sf19mt: 'Stockfish 19', sf19: 'Stockfish 19', sf19lite: 'Stockfish 19 Lite', full: 'Stockfish 17.1', lite: 'Stockfish 17.1 Lite' };
  return `${names[e.kind] || 'Stockfish'}, ${e.threads} thread${e.threads > 1 ? 's' : ''}`;
}

async function getEngine() {
  const kind = $('engineSel').value;
  if (state.engine && state.engineKind === kind) return state.engine;
  if (state.engine) state.engine.terminate();
  state.engine = null;
  state.engine = await Engine.start(kind, 2);
  state.engineKind = kind;
  return state.engine;
}

// keepView: mantém lance atual, orientação e setas (usado ao reanalisar)
async function openGame(raw, { keepView = false } = {}) {
  const game = parseGame(raw.pgn);
  game.raw = raw;
  game.timeClass = raw.time_class;
  game.opening = openingName(raw);
  game.myColor = raw.white.username.toLowerCase() === state.username ? 'w' : 'b';
  game.outcome = outcomeFor(raw, state.username);
  state.game = game;
  if (!keepView) {
    state.ply = 0;
    state.marks = {};
    state.flipped = game.myColor === 'b';
  }

  $('gameLink').href = raw.url;
  $('summaryTab').innerHTML = '';
  $('movesTab').innerHTML = '';
  $('moveInfo').hidden = true;
  $('progress').hidden = false;
  if (!keepView) show('analysisView');
  renderMoveList();
  update();

  const runId = ++state.runId;
  state.analyzing = true;
  const depth = Number($('depthSel').value);
  const started = performance.now();
  try {
    $('progressText').textContent = 'Carregando o Stockfish…';
    $('progressFill').style.width = '0%';
    const engine = await getEngine();
    const result = await analyzeGame(
      game,
      engine,
      depth,
      (done, total) => {
        if (runId !== state.runId) return;
        const pct = (done / total) * 100;
        const elapsed = (performance.now() - started) / 1000;
        const eta = done > 2 ? Math.round((elapsed / done) * (total - done)) : null;
        $('progressFill').style.width = pct + '%';
        $('progressText').textContent = `Analisando posição ${done} de ${total} (profundidade ${depth} · ${engineLabel(engine)})${eta != null ? ` · ~${eta}s restantes` : ''}`;
      },
      () => runId !== state.runId
    );
    if (!result || runId !== state.runId) return;
    game.analysisInfo = `${engineLabel(engine)} · profundidade ${depth} · ${Math.round((performance.now() - started) / 1000)}s`;
    state.analyzing = false;
    $('progress').hidden = true;
    renderSummary();
    renderMoveList();
    update();
  } catch (err) {
    console.error(err);
    if (runId === state.runId) $('progressText').textContent = 'Falha na análise: ' + err.message;
  }
}

function stopAnalysis() {
  if (state.analyzing && state.engine) {
    // interrompe a análise em andamento recriando o motor
    state.engine.terminate();
    state.engine = null;
  }
  state.runId++;
  state.analyzing = false;
}

function leaveAnalysis() {
  stopAnalysis();
  show(state.games.length ? 'gamesView' : 'searchView');
}

// Refaz a análise da partida aberta com o motor/profundidade selecionados agora
$('reanalyzeBtn').addEventListener('click', () => {
  if (!state.game) return;
  stopAnalysis();
  openGame(state.game.raw, { keepView: true });
});
$('backBtn').addEventListener('click', leaveAnalysis);
$('homeBtn').addEventListener('click', () => {
  if (!$('analysisView').hidden) leaveAnalysis();
  show('searchView');
});

// ---------------- tabuleiro e navegação ----------------
function playerBar(color) {
  const g = state.game;
  const name = color === 'w' ? g.headers.White : g.headers.Black;
  const elo = color === 'w' ? g.headers.WhiteElo : g.headers.BlackElo;
  // relógio após o último lance desta cor até o ply atual
  let clock = null;
  for (let i = state.ply - 1; i >= 0; i--) {
    if (g.plies[i].color === color) {
      clock = g.plies[i].clock;
      break;
    }
  }
  if (clock == null && g.baseTime) clock = g.baseTime;
  const clockTxt = clock != null && g.timeClass !== 'daily' ? `<span class="clock">${fmtClock(clock)}</span>` : '';
  return `<span><span class="dot ${color}"></span>${escapeHtml(name || '?')}<span class="rt">(${elo || '?'})</span></span>${clockTxt}`;
}

function fmtClock(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = s < 20 ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function update() {
  const g = state.game;
  if (!g) return;
  const ply = state.ply ? g.plies[state.ply - 1] : null;
  const fen = ply ? ply.fenAfter : g.startFen;
  const analysed = !!g.evals;

  const arrows = [];
  let badge = null;
  if (ply && analysed) {
    badge = { square: ply.to, cls: ply.cls };
    if (!ply.isBest && ply.bestUci && !['brilliant', 'forced'].includes(ply.cls))
      arrows.push({ from: ply.bestUci.slice(0, 2), to: ply.bestUci.slice(2, 4), color: '#4f9a2f' });
  }
  const marks = (state.marks[state.ply] ||= { arrows: [], circles: [] });
  board.render(fen, { flipped: state.flipped, lastMove: ply, arrows, badge, marks, animMs: Number($('animSel').value) });

  $('topPlayer').innerHTML = playerBar(state.flipped ? 'w' : 'b');
  $('bottomPlayer').innerHTML = playerBar(state.flipped ? 'b' : 'w');

  // barra de avaliação
  const ev = analysed ? g.evals[state.ply] : null;
  const white = ev ? ev.win : 50;
  $('evalFill').style.height = white + '%';
  $('evalBar').classList.toggle('flipped', state.flipped);
  // texto fica do lado de quem está melhor, sobre a cor dele
  const whiteAhead = white >= 50;
  $('evalText').textContent = ev ? formatEval(ev).replace(/^[+-]/, '').replace('M', 'M') : '';
  $('evalText').className = whiteAhead !== state.flipped ? 'bottom' : 'top';
  $('evalText').style.color = whiteAhead ? '#333' : '#f2f2f2';

  // card do lance atual
  if (ply && analysed) {
    const c = CLASSES[ply.cls];
    let line = !ply.isBest && ply.bestLine.length && !['brilliant', 'forced'].includes(ply.cls)
      ? `<div class="line">Melhor linha: ${ply.bestLine.join(' ')} (${formatEval(ply.bestEval)})</div>` : '';
    if (ply.cls === 'brilliant' && ply.brilliantLine?.length)
      line = `<div class="line">Ideia: ${ply.san} ${ply.brilliantLine.join(' ')}</div>`;
    $('moveInfo').innerHTML = `
      <div class="title">${icon(ply.cls)} <span style="color:${c.color}">${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} ${ply.san} — ${c.label}</span>
      <span class="eval">${formatEval(ply.evalAfter)}</span></div>
      <p>${describeMove(ply)}</p>${line}`;
    $('moveInfo').style.borderLeftColor = c.color;
    $('moveInfo').hidden = false;
  } else {
    $('moveInfo').hidden = true;
  }

  document.querySelectorAll('.tl-mv').forEach((el) => el.classList.toggle('active', Number(el.dataset.ply) === state.ply));
  document.querySelectorAll('.tl-body').forEach((body) => {
    // rola só a lista (scrollIntoView rolaria a página inteira)
    const act = body.querySelector('.tl-mv.active');
    if (!act || !body.clientHeight) return;
    const top = act.offsetTop - body.offsetTop;
    if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - act.offsetHeight)
      body.scrollTop = top - body.clientHeight / 2;
  });
  const cursor = document.querySelector('.graph .cursor');
  if (cursor) cursor.style.left = (state.ply / g.plies.length) * 100 + '%';
}

function goTo(ply) {
  if (!state.game) return;
  state.ply = Math.max(0, Math.min(state.game.plies.length, ply));
  update();
}

$('firstBtn').onclick = () => goTo(0);
$('prevBtn').onclick = () => goTo(state.ply - 1);
$('nextBtn').onclick = () => goTo(state.ply + 1);
$('lastBtn').onclick = () => goTo(Infinity);
$('flipBtn').onclick = () => {
  state.flipped = !state.flipped;
  update();
};
document.addEventListener('keydown', (e) => {
  if ($('analysisView').hidden || e.target.matches('input, select')) return;
  if (e.key === 'ArrowLeft') goTo(state.ply - 1);
  else if (e.key === 'ArrowRight') goTo(state.ply + 1);
  else if (e.key === 'Home') goTo(0);
  else if (e.key === 'End') goTo(Infinity);
  else if (e.key === 'f' || e.key === 'F') $('flipBtn').click();
  else return;
  e.preventDefault();
});

// ---------------- abas ----------------
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('summaryTab').hidden = b.dataset.tab !== 'summary';
  $('movesTab').hidden = b.dataset.tab !== 'moves';
  update();
});

function icon(cls) {
  const c = CLASSES[cls];
  return `<span class="icon" style="background:${c.color}" title="${c.label}">${c.symbol}</span>`;
}

// Aba "Lances": todos os lances com o tempo gasto em cada um
function renderMoveList() {
  renderTimeline($('movesTab'));
}

function fmtSpent(s) {
  if (s == null || Number.isNaN(s)) return '—';
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d ${Math.round((s % 86400) / 3600)}h`;
}

// Todos os lances com o tempo gasto em cada um
function renderTimeline(container) {
  const g = state.game;
  const maxSpent = Math.max(1, ...g.plies.map((p) => p.timeSpent || 0));
  const cell = (p) => {
    if (!p) return '<div></div>';
    const pct = p.timeSpent != null ? Math.max(2, (p.timeSpent / maxSpent) * 100) : 0;
    // notação com figura: ícone da peça no lugar da letra (Nf3 -> ♘f3)
    const san = p.piece !== 'p' && !p.san.startsWith('O-O') ? p.san.slice(1) : p.san;
    const cls = g.evals ? CLASSES[p.cls] : null;
    return `<div class="tl-mv ${p.color}" data-ply="${p.index + 1}" title="${p.moveNumber}${p.color === 'w' ? '.' : '...'} ${p.san}${cls ? ' · ' + cls.label : ''} — ${fmtSpent(p.timeSpent)}">
      <span class="tl-san">
        <img class="tl-piece" src="/pieces/${p.color}${p.piece.toUpperCase()}.svg" alt="">
        <span${cls && ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder'].includes(p.cls) ? ` style="color:${cls.color}"` : ''}>${san}</span>
        ${cls ? `<span class="tl-dot" style="background:${cls.color}" title="${cls.label}">${cls.symbol}</span>` : ''}
      </span>
      <span class="tl-meta"><span class="tl-track"><span class="tl-bar" style="width:${pct}%"></span></span><span class="tl-time">${fmtSpent(p.timeSpent)}</span></span>
    </div>`;
  };

  let rows = '';
  for (let i = 0; i < g.plies.length; i++) {
    const p = g.plies[i];
    if (p.color === 'w') {
      rows += `<div class="tl-num">${p.moveNumber}.</div>${cell(p)}${cell(g.plies[i + 1])}`;
      i++;
    } else {
      rows += `<div class="tl-num">${p.moveNumber}.</div><div></div>${cell(p)}`;
    }
  }

  const total = (color) => g.plies.filter((p) => p.color === color && p.timeSpent != null).reduce((a, p) => a + p.timeSpent, 0);
  const count = (color) => g.plies.filter((p) => p.color === color && p.timeSpent != null).length;
  const hasClock = g.plies.some((p) => p.timeSpent != null);
  const foot = hasClock
    ? `<div class="tl-foot">
        <div></div><div><b>${fmtSpent(total('w'))}</b><span>média ${fmtSpent(total('w') / Math.max(1, count('w')))}</span></div>
        <div><b>${fmtSpent(total('b'))}</b><span>média ${fmtSpent(total('b') / Math.max(1, count('b')))}</span></div>
      </div>`
    : '<p class="muted small">Esta partida não tem registro de relógio.</p>';

  container.innerHTML = `
    <div class="tl-grid tl-labels"><div></div><div><span class="dot w"></span>Brancas</div><div><span class="dot b"></span>Pretas</div></div>
    <div class="tl-grid tl-body">${rows}</div>${foot}`;
  container.querySelectorAll('.tl-mv').forEach((el) => (el.onclick = () => goTo(Number(el.dataset.ply))));
}

// ---------------- resumo ----------------
// Precisão oficial do chess.com, quando a partida já foi revisada lá (vem na API)
function officialAcc(side) {
  const a = state.game.raw.accuracies && state.game.raw.accuracies[side];
  return a != null ? ` · chess.com ${a.toFixed(1)}` : '';
}

function ratingBlock(summary, realElo) {
  const est = estimateRating(summary, realElo);
  if (est == null) return '<div class="est"><span class="lbl">rating estimado</span><b>—</b><span class="lbl">partida curta</span></div>';
  const real = Number(realElo);
  let diff = '';
  if (real) {
    const d = est - real;
    const cls = d >= 50 ? 'up' : d <= -50 ? 'down' : '';
    diff = `<span class="diff ${cls}">${d > 0 ? '+' : ''}${d} vs. ${real}</span>`;
  }
  return `<div class="est" title="Parte do rating atual do jogador e se ajusta conforme a precisão nesta partida."><span class="lbl">rating estimado</span><b>${est}</b>${diff}</div>`;
}

function renderSummary() {
  const g = state.game;
  const me = g.myColor;
  const ins = buildInsights(g, me, g.outcome);
  const sw = g.summary.w;
  const sb = g.summary.b;
  const accTxt = (a) => (a == null ? '—' : a.toFixed(1));

  const accCards = `
    <div class="acc-row">
      <div class="acc-card ${me === 'w' ? 'me' : ''}"><div class="name"><span class="dot w"></span>${escapeHtml(g.headers.White)}</div><div class="val">${accTxt(sw.accuracy)}</div><div class="lbl">precisão${officialAcc('white')}</div>${ratingBlock(sw, g.headers.WhiteElo)}</div>
      <div class="acc-card ${me === 'b' ? 'me' : ''}"><div class="name"><span class="dot b"></span>${escapeHtml(g.headers.Black)}</div><div class="val">${accTxt(sb.accuracy)}</div><div class="lbl">precisão${officialAcc('black')}</div>${ratingBlock(sb, g.headers.BlackElo)}</div>
    </div>`;

  const counts = `
    <table class="counts">
      <tr><th></th><th>Brancas</th><th>Pretas</th></tr>
      ${CLASS_ORDER.map((k) => `<tr><td><span class="lbl">${icon(k)}<span style="color:${CLASSES[k].color}">${CLASSES[k].label}</span></span></td><td class="n">${sw.counts[k]}</td><td class="n">${sb.counts[k]}</td></tr>`).join('')}
    </table>`;

  const mine = g.summary[me];
  const phases = Object.entries(mine.phases)
    .filter(([, v]) => v.moves > 0 && v.accuracy != null)
    .map(([k, v]) => {
      const col = v.accuracy >= 85 ? '#81b64c' : v.accuracy >= 70 ? '#f0c02e' : '#ee6b5d';
      return `<div class="phase"><span>${PHASE_NAMES[k]}</span><div class="bar"><div style="width:${v.accuracy}%;background:${col}"></div></div><span class="v">${v.accuracy.toFixed(0)}%</span></div>`;
    })
    .join('');

  const li = (arr) => arr.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  const turning = ins.turningPoint
    ? `<div class="tip" style="border-color:#ca3431"><b>Lance ${ins.turningPoint.moveNumber}${ins.turningPoint.color === 'w' ? '.' : '...'} ${ins.turningPoint.san}</b>${escapeHtml(describeMove(ins.turningPoint))} Sua chance de vitória caiu de ${ins.turningPoint.wBefore.toFixed(0)}% para ${ins.turningPoint.wAfter.toFixed(0)}%.
        <div><button class="ghost small" data-goto="${ins.turningPoint.index + 1}" style="margin-top:6px">Ver posição</button></div></div>`
    : '';

  $('summaryTab').innerHTML = `
    ${accCards}
    ${evalGraph(g)}
    <div class="headline">${escapeHtml(ins.headline)}</div>
    <p class="muted small" style="margin:8px 0 0">${escapeHtml(ins.termination)}${g.opening ? ` · Abertura: ${escapeHtml(g.opening)}` : ''}</p>
    ${g.analysisInfo ? `<p class="muted small" style="margin:2px 0 0">Analisado com ${escapeHtml(g.analysisInfo)}</p>` : ''}
    ${turning ? `<h3>O ponto de virada</h3>${turning}` : ''}
    ${ins.weaknesses.length ? `<h3>Onde você errou</h3><ul class="list bad">${li(ins.weaknesses)}</ul>` : ''}
    ${ins.strengths.length ? `<h3>O que você fez bem</h3><ul class="list good">${li(ins.strengths)}</ul>` : ''}
    <h3>Onde melhorar</h3>
    <div class="tips">${ins.tips.map((t) => `<div class="tip"><b>${escapeHtml(t.title)}</b>${escapeHtml(t.text)}</div>`).join('')}</div>
    ${phases ? `<h3>Sua precisão por fase</h3><div class="phase-bars">${phases}</div>` : ''}
    ${ins.keyMoments.length ? `<h3>Seus momentos-chave</h3><div class="moments">${ins.keyMoments
      .map((m) => `<button class="moment" data-goto="${m.ply.index + 1}">${icon(m.ply.cls)}<span><b>${m.ply.moveNumber}${m.ply.color === 'w' ? '.' : '...'} ${m.ply.san}</b> — ${escapeHtml(m.text)}</span></button>`)
      .join('')}</div>` : ''}
    <h3>Classificação dos lances</h3>
    ${counts}`;

  $('summaryTab').querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => goTo(Number(b.dataset.goto))));
  const graph = $('summaryTab').querySelector('.graph');
  graph.onclick = (e) => {
    const r = graph.getBoundingClientRect();
    goTo(Math.round(((e.clientX - r.left) / r.width) * g.plies.length));
  };
}

function evalGraph(g) {
  const n = g.plies.length;
  const W = Math.max(n, 1);
  const pts = g.evals.map((e, i) => `${i},${100 - e.win}`).join(' ');
  const markers = g.plies
    .map((p, i) => {
      if (!['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(p.cls)) return '';
      return `<span class="mk" style="left:${((i + 1) / W) * 100}%;top:${100 - g.evals[i + 1].win}%;background:${CLASSES[p.cls].color}"></span>`;
    })
    .join('');
  return `<div class="graph" title="Clique para ir ao lance">
    <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none">
      <polygon points="0,100 ${pts} ${n},100" fill="#f2f2f2"/>
      <line x1="0" y1="50" x2="${W}" y2="50" stroke="#888" stroke-width="0.6" vector-effect="non-scaling-stroke" stroke-dasharray="3 3"/>
    </svg>${markers}<span class="cursor" style="left:${(state.ply / W) * 100}%"></span></div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// lembra as preferências (motor, profundidade, animação)
for (const id of ['depthSel', 'engineSel', 'animSel']) {
  try {
    const v = localStorage.getItem(id);
    if (v && [...$(id).options].some((o) => o.value === v)) $(id).value = v;
  } catch {}
  $(id).addEventListener('change', () => {
    try { localStorage.setItem(id, $(id).value); } catch {}
  });
}

// pré-preenche o último usuário
try {
  const last = localStorage.getItem('lastUser');
  if (last) $('userInput').value = last;
} catch {}
