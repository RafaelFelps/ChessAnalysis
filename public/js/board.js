// Tabuleiro: grade 8x8, animação das peças e setas/marcações do usuário
import { CLASSES } from './analysis.js';

const FILES = 'abcdefgh';

// Cores das setas desenhadas pelo usuário (botão direito + modificador)
export const MARK_COLORS = { default: '#f0a030', shift: '#e04848', ctrl: '#3b8fd9', alt: '#4fae3c' };

function squareXY(sq, flipped) {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return flipped ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
}

function piecesFromFen(fen) {
  const map = {};
  fen.split(' ')[0].split('/').forEach((row, ri) => {
    let fi = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) fi += Number(ch);
      else {
        map[FILES[fi] + (8 - ri)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
        fi++;
      }
    }
  });
  return map;
}

function arrowSvg(from, to, color, flipped) {
  const a = squareXY(from, flipped);
  const b = squareXY(to, flipped);
  const x1 = a.x + 0.5, y1 = a.y + 0.5, x2 = b.x + 0.5, y2 = b.y + 0.5;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const head = 0.42, w = 0.16;
  const ex = x2 - ux * head, ey = y2 - uy * head;
  const px = -uy, py = ux;
  return `<g opacity="0.82">
    <line x1="${x1 + ux * 0.2}" y1="${y1 + uy * 0.2}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>
    <polygon points="${x2},${y2} ${ex + px * 0.24},${ey + py * 0.24} ${ex - px * 0.24},${ey - py * 0.24}" fill="${color}"/>
  </g>`;
}

// Liga peças que sumiram a peças iguais que apareceram (cobre lance normal, roque, en passant e voltar lance)
function diffMoves(prev, next) {
  const gone = Object.keys(prev).filter((sq) => prev[sq] !== next[sq]);
  const came = Object.keys(next).filter((sq) => prev[sq] !== next[sq]);
  const moves = [];
  for (const to of came) {
    let best = null;
    let bestDist = Infinity;
    for (const from of gone) {
      if (prev[from] !== next[to] || moves.some((m) => m.from === from)) continue;
      const d = Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) + Math.abs(from[1] - to[1]);
      if (d < bestDist) {
        best = from;
        bestDist = d;
      }
    }
    if (best) moves.push({ from: best, to });
  }
  return moves;
}

export class Board {
  constructor(el) {
    this.el = el;
    this.fen = null;
    this.pieces = {};
    this.flipped = false;
    this.opts = {};
    this.marks = { arrows: [], circles: [] };
    this.drag = null;
    this.bindEvents();
  }

  squareAt(clientX, clientY) {
    const r = this.el.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * 8);
    const y = Math.floor(((clientY - r.top) / r.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.flipped ? FILES[7 - x] + (y + 1) : FILES[x] + (8 - y);
  }

  bindEvents() {
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.el.addEventListener('mousedown', (e) => {
      const sq = this.squareAt(e.clientX, e.clientY);
      if (!sq) return;
      if (e.button === 2) {
        const color = e.shiftKey ? MARK_COLORS.shift : e.ctrlKey ? MARK_COLORS.ctrl : e.altKey ? MARK_COLORS.alt : MARK_COLORS.default;
        this.drag = { from: sq, to: sq, color };
        return;
      }
      if (e.button === 0) {
        // clique esquerdo: limpa as marcações
        this.marks.arrows.length = 0;
        this.marks.circles.length = 0;
        this.drawOverlay();
      }
    });

    this.el.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const sq = this.squareAt(e.clientX, e.clientY);
      if (sq && sq !== this.drag.to) {
        this.drag.to = sq;
        this.drawOverlay();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !this.drag) return;
      const { from, to, color } = this.drag;
      this.drag = null;
      if (from === to) {
        const i = this.marks.circles.findIndex((c) => c.sq === from);
        if (i >= 0) this.marks.circles.splice(i, 1);
        else this.marks.circles.push({ sq: from, color });
      } else {
        const i = this.marks.arrows.findIndex((a) => a.from === from && a.to === to);
        if (i >= 0) this.marks.arrows.splice(i, 1);
        else this.marks.arrows.push({ from, to, color });
      }
      this.drawOverlay();
    });
  }

  // fen: posição; opts: { flipped, lastMove, arrows, badge, animMs, marks }
  render(fen, opts = {}) {
    const prevPieces = this.pieces;
    const prevFlipped = this.flipped;
    const posChanged = fen !== this.fen;
    this.fen = fen;
    this.pieces = piecesFromFen(fen);
    this.flipped = !!opts.flipped;
    this.opts = opts;
    if (opts.marks) this.marks = opts.marks;

    let html = '<div class="squares">';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const f = this.flipped ? 7 - x : x;
        const r = this.flipped ? y : 7 - y;
        const sq = FILES[f] + (r + 1);
        const light = (f + r) % 2 === 1;
        const lm = opts.lastMove;
        const hl = lm && (sq === lm.from || sq === lm.to) ? ' hl' : '';
        const p = this.pieces[sq];
        const piece = p ? `<img class="piece" data-sq="${sq}" src="/pieces/${p}.svg" alt="" draggable="false">` : '';
        const coordFile = y === 7 ? `<span class="coord file">${FILES[f]}</span>` : '';
        const coordRank = x === 0 ? `<span class="coord rank">${r + 1}</span>` : '';
        html += `<div class="sq ${light ? 'light' : 'dark'}${hl}">${coordRank}${coordFile}${piece}</div>`;
      }
    }
    html += '</div><svg class="overlay" viewBox="0 0 8 8"></svg>';

    if (opts.badge) {
      const c = CLASSES[opts.badge.cls];
      const { x, y } = squareXY(opts.badge.square, this.flipped);
      html += `<div class="badge" style="left:calc(${(x + 1) * 12.5}% - 14px);top:calc(${y * 12.5}% - 10px);background:${c.color}" title="${c.label}">${c.symbol}</div>`;
    }
    this.el.innerHTML = html;
    this.drawOverlay();

    if (posChanged && prevFlipped === this.flipped && opts.animMs > 0) this.animate(prevPieces, opts.animMs);
  }

  animate(prevPieces, ms) {
    const moves = diffMoves(prevPieces, this.pieces);
    if (!moves.length || moves.length > 3) return; // saltos grandes de posição não animam
    for (const { from, to } of moves) {
      const img = this.el.querySelector(`.piece[data-sq="${to}"]`);
      if (!img) continue;
      const a = squareXY(from, this.flipped);
      const b = squareXY(to, this.flipped);
      img.style.zIndex = 5;
      img.animate(
        [{ transform: `translate(${(a.x - b.x) * 100}%, ${(a.y - b.y) * 100}%)` }, { transform: 'translate(0, 0)' }],
        { duration: ms, easing: 'cubic-bezier(.25,.8,.35,1)' }
      ).onfinish = () => (img.style.zIndex = '');
    }
  }

  drawOverlay() {
    const svg = this.el.querySelector('.overlay');
    if (!svg) return;
    let html = '';
    for (const a of this.opts.arrows || []) html += arrowSvg(a.from, a.to, a.color, this.flipped);
    for (const c of this.marks.circles) {
      const { x, y } = squareXY(c.sq, this.flipped);
      html += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.44" fill="none" stroke="${c.color}" stroke-width="0.08" opacity="0.85"/>`;
    }
    for (const a of this.marks.arrows) html += arrowSvg(a.from, a.to, a.color, this.flipped);
    if (this.drag && this.drag.from !== this.drag.to) html += arrowSvg(this.drag.from, this.drag.to, this.drag.color, this.flipped);
    svg.innerHTML = html;
  }
}
