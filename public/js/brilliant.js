// Detecção de lances brilhantes: um sacrifício real, necessário e com uma ideia concreta por trás
import { Chess } from '/vendor/chess.js';
import { VALUES, PIECE_NAMES, uciToMove, pvToSan, winPct } from './analysis.js';

const PIECE_ART = (t) => `${['q', 'r'].includes(t) ? 'a' : 'o'} ${PIECE_NAMES[t].toLowerCase()}`;

function balance(chess, color) {
  let s = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) s += (sq.color === color ? 1 : -1) * VALUES[sq.type];
  return s;
}

// Segue uma linha (lista de lances UCI) e devolve o saldo de material a cada lance,
// além das peças (não peões) do jogador que foram capturadas no caminho.
function walk(fen, pv, color, plies) {
  const sim = new Chess(fen);
  const bal = [];
  const lostPieces = [];
  for (const u of pv.slice(0, plies)) {
    let m;
    try {
      m = sim.move(uciToMove(u));
    } catch {
      break;
    }
    if (m.captured && m.color !== color && m.captured !== 'p') lostPieces.push(m.captured);
    bal.push(balance(sim, color));
  }
  return { bal, lostPieces };
}

// Peça parada numa casa onde o adversário a captura com lucro (sem contar a recaptura de quem capturou)
function hangingOn(chess, square, color) {
  const piece = chess.get(square);
  if (!piece || piece.type === 'p' || piece.type === 'k') return false;
  const opp = color === 'w' ? 'b' : 'w';
  const attackers = chess.attackers(square, opp).map((sq) => chess.get(sq).type);
  if (!attackers.length) return false;
  const defended = chess.attackers(square, color).length > 0;
  if (!defended) return true;
  const cheapest = Math.min(...attackers.map((t) => (t === 'k' ? 99 : VALUES[t])));
  return VALUES[piece.type] - cheapest >= 2;
}

// Avalia uma posição com o motor e devolve a chance de vitória de `color` e a melhor linha
async function probe(engine, fen, depth, color) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { win: c.turn() === color ? 0 : 100, pv: [], mate: null };
  const r = await engine.analyse(fen, depth);
  const l = r.lines[0];
  if (!l) return null;
  const sign = c.turn() === color ? 1 : -1;
  const mate = l.mate != null ? sign * l.mate : null;
  return { win: mate != null ? (mate > 0 ? 100 : 0) : winPct(sign * l.cp), pv: l.pv, mate };
}

/**
 * Decide se o lance é brilhante. Retorna null ou { idea, line }.
 * Critérios (todos obrigatórios):
 *  1. É o melhor lance (ou empatado com ele) e não era forçado.
 *  2. A posição não estava já totalmente ganha e não fica perdida depois.
 *  3. Há um sacrifício real de peça (não de peões): ou o adversário captura e o material
 *     não volta no lance seguinte, ou a peça fica oferecida e capturá-la é um erro.
 *  4. Não é uma peça que já estava perdida (desperado): a alternativa também não perderia material.
 *  5. É necessário: as alternativas seguras são claramente piores, ou o sacrifício leva a mate.
 */
export async function detectBrilliant(ply, before, after, engine, depth) {
  const color = ply.color;
  const persp = (w) => (color === 'w' ? w : 100 - w);
  if (ply.legalCount === 1 || ply.loss > 1 || ply.wAfter < 50) return null;

  const startBal = balance(new Chess(ply.fenBefore), color);
  const mateFor = after.mate != null && persp(after.mate > 0 ? 100 : 0) === 100 ? Math.abs(after.mate) : null;
  // posição já ganha: só conta se o sacrifício força um mate que a alternativa não tinha (ou mais rápido)
  if (ply.wBefore > 90) {
    if (!mateFor) return null;
    const alt = before.lines[1];
    const altMate = alt && alt.mate != null && persp(alt.mate > 0 ? 100 : 0) === 100 ? Math.abs(alt.mate) : null;
    if (altMate != null && altMate <= mateFor) return null;
  }

  // 3a. sacrifício aceito na linha principal: material fica 2+ pontos abaixo depois da
  //     resposta do adversário E depois do nosso lance seguinte (não é só uma troca)
  const mainPv = (after.lines[0] && after.lines[0].pv) || [];
  const main = walk(ply.fenAfter, mainPv, color, 10);
  const accepted =
    main.bal.length >= 2 &&
    main.bal[0] <= startBal - 2 &&
    main.bal[1] <= startBal - 2 &&
    (main.bal.length < 4 || main.bal[3] <= startBal - 2 || mateFor) &&
    main.lostPieces.length > 0;

  // 3b. sacrifício oferecido: a peça fica pendurada mas o motor não a captura;
  //     confirmamos que capturar é ruim para o adversário
  let offered = null;
  const after0 = new Chess(ply.fenAfter);
  const firstReply = mainPv[0] ? uciToMove(mainPv[0]) : null;
  // o que fica oferecido precisa valer 2+ pontos a mais do que o lance já capturou (senão é só troca)
  const atStake = VALUES[ply.promotion || ply.piece] - (ply.captured ? VALUES[ply.captured] : 0);
  if (!accepted && atStake >= 2 && hangingOn(after0, ply.to, color) && !(firstReply && firstReply.to === ply.to)) {
    const captures = after0.moves({ verbose: true }).filter((m) => m.to === ply.to);
    if (captures.length) {
      const cap = captures.sort((a, b) => VALUES[a.piece] - VALUES[b.piece])[0];
      const sim = new Chess(ply.fenAfter);
      sim.move(cap);
      const res = await probe(engine, sim.fen(), depth, color);
      if (res && res.win >= 50 && res.win >= ply.wAfter - 10) offered = { capture: cap, res, fen: sim.fen() };
    }
  }
  if (!accepted && !offered) return null;

  // 4. desperado: a peça já estava pendurada antes ou a melhor alternativa também perde material
  const beforeChess = new Chess(ply.fenBefore);
  if (hangingOn(beforeChess, ply.from, color) && ply.captured) return null; // peça condenada levando algo junto
  const alt = before.lines[1];
  if (alt) {
    const altFirst = new Chess(ply.fenBefore);
    try {
      altFirst.move(uciToMove(alt.pv[0]));
      const altWalk = walk(altFirst.fen(), alt.pv.slice(1), color, 4);
      const altBal = [balance(altFirst, color), ...altWalk.bal];
      // [após o lance alternativo, após a resposta, após o nosso lance seguinte]
      if (altBal.length >= 3 && Math.max(altBal[1], altBal[2]) <= startBal - 2) return null;
    } catch {}
  }

  // 5. necessidade: a alternativa é claramente pior (ou o sacrifício força mate)
  const gap = alt ? ply.wBefore - persp(alt.win) : 100;
  if (!mateFor && gap < 5) return null;

  // ---- a ideia por trás ----
  const sacPiece = accepted ? main.lostPieces[0] : after0.get(ply.to).type;
  const sanMove = `${ply.san}`;
  let idea;
  let line;
  if (offered) {
    const cont = pvToSan(offered.fen, offered.res.pv, 6);
    line = [offered.capture.san, ...cont];
    const capMate = offered.res.mate != null && offered.res.mate > 0 ? offered.res.mate : null;
    idea = `${sanMove} deixa ${PIECE_ART(sacPiece)} oferecid${PIECE_ART(sacPiece)[0]}, mas capturar é um erro: após ${offered.capture.san}, ${
      capMate ? `segue mate em ${capMate}` : `${cont.slice(0, 3).join(' ')} e a posição fica ainda melhor para você`
    }.`;
  } else {
    line = pvToSan(ply.fenAfter, mainPv, 8);
    const end = main.bal[main.bal.length - 1];
    if (mateFor)
      idea = `${sanMove} sacrifica ${PIECE_ART(sacPiece)} para forçar mate ${mateFor === 1 ? 'no lance seguinte' : `em ${mateFor} lances`}.`;
    else if (end >= startBal + 1) idea = `${sanMove} sacrifica ${PIECE_ART(sacPiece)} e recupera ainda mais material na sequência.`;
    else if (end >= startBal - 1) idea = `${sanMove} sacrifica ${PIECE_ART(sacPiece)} temporariamente: o material volta e a posição melhora.`;
    else
      idea = `${sanMove} sacrifica ${PIECE_ART(sacPiece)} em troca de iniciativa: mesmo com material a menos, sua chance de vitória fica em ${Math.round(
        ply.wAfter
      )}% (a melhor alternativa dava ${Math.round(persp(alt ? alt.win : 50))}%).`;
  }
  return { idea, line };
}
