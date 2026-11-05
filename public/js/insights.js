// Gera o resumo em linguagem natural: pontos fortes, pontos fracos e onde melhorar
import { CLASSES, PIECE_NAMES } from './analysis.js';

// [nome, com artigo 'no/na', possessivo]
const PHASE = {
  opening: { em: 'na abertura', seu: 'Sua abertura' },
  middlegame: { em: 'no meio-jogo', seu: 'Seu meio-jogo' },
  endgame: { em: 'no final', seu: 'Seu final' },
};

const pieceWithArticle = (t) => `${['q', 'r'].includes(t) ? 'a' : 'o'} ${PIECE_NAMES[t].toLowerCase()}`;
const moveLabel = (p) => `${p.moveNumber}${p.color === 'w' ? '.' : '...'} ${p.san}`;
const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}min${String(Math.round(s % 60)).padStart(2, '0')}s` : `${s.toFixed(1)}s`);

export function buildInsights(game, color, outcome) {
  const s = game.summary[color];
  const moves = s.moves;
  const strengths = [];
  const weaknesses = [];
  const tips = [];
  const isDaily = game.timeClass === 'daily';

  // ----- visão geral -----
  const acc = s.accuracy ?? 0;
  let headline;
  if (acc >= 90 && outcome === 'loss') headline = 'Você jogou em alto nível, mas poucos detalhes decidiram a partida.';
  else if (acc >= 90) headline = 'Partida de altíssimo nível — você jogou muito próximo do motor.';
  else if (acc >= 80) headline = 'Partida sólida, com poucos deslizes relevantes.';
  else if (acc >= 70) headline = 'Partida razoável, mas alguns momentos-chave custaram caro.';
  else if (acc >= 55) headline = 'Partida irregular: os erros pesaram no resultado.';
  else headline = 'Partida difícil — há bastante espaço para evoluir aqui.';

  // ----- lances bons -----
  const brill = moves.filter((p) => p.cls === 'brilliant');
  const great = moves.filter((p) => p.cls === 'great');
  if (brill.length)
    strengths.push(`Encontrou ${brill.length > 1 ? `${brill.length} lances brilhantes` : 'um lance brilhante'} (${brill.map(moveLabel).join(', ')}) — sacrifício correto que o motor aprova.`);
  if (great.length)
    strengths.push(`Achou ${great.length > 1 ? `${great.length} lances únicos` : 'o único lance bom'} em posição crítica: ${great.map(moveLabel).join(', ')}.`);

  // ----- fases -----
  const phases = Object.entries(s.phases).filter(([, v]) => v.moves >= 4 && v.accuracy != null);
  if (phases.length >= 2) {
    const sorted = [...phases].sort((a, b) => b[1].accuracy - a[1].accuracy);
    const [bestName, bestPh] = sorted[0];
    const [worstName, worstPh] = sorted[sorted.length - 1];
    if (bestPh.accuracy >= 80) strengths.push(`${PHASE[bestName].seu} foi o ponto alto (${bestPh.accuracy.toFixed(0)}% de precisão).`);
    if (bestPh.accuracy - worstPh.accuracy >= 8) {
      weaknesses.push(`A precisão caiu ${PHASE[worstName].em}: ${worstPh.accuracy.toFixed(0)}% contra ${bestPh.accuracy.toFixed(0)}% ${PHASE[bestName].em}.`);
      if (worstName === 'opening')
        tips.push({ title: 'Abertura', text: `Revise a teoria de ${game.opening || 'sua abertura'}: compare seus primeiros lances com o melhor lance indicado e foque nos princípios (desenvolver peças, controlar o centro, rocar cedo).` });
      if (worstName === 'middlegame')
        tips.push({ title: 'Meio-jogo', text: 'No meio-jogo, antes de cada lance pergunte: qual é a ameaça do adversário? Qual é meu plano? Exercícios de tática diários ajudam a enxergar mais rápido essas oportunidades.' });
      if (worstName === 'endgame')
        tips.push({ title: 'Finais', text: 'Estude finais fundamentais (rei e peão, finais de torre, oposição). Nos finais, ative o rei e calcule com calma — cada tempo conta.' });
    }
  }

  // ----- erros graves -----
  const blunders = moves.filter((p) => p.cls === 'blunder');
  const mistakes = moves.filter((p) => p.cls === 'mistake');
  const misses = moves.filter((p) => p.cls === 'miss');
  const hung = [...blunders, ...mistakes].filter((p) => p.hungPiece);
  const allowedMate = [...blunders, ...mistakes].filter((p) => p.allowedMate);

  if (hung.length) {
    weaknesses.push(`Deixou material desprotegido: ${hung.map((p) => `${moveLabel(p)} (permitiu ${p.refutation}, perdendo ${pieceWithArticle(p.hungPiece)})`).join('; ')}.`);
    tips.push({ title: 'Checagem de segurança', text: 'Antes de soltar a peça, faça a checagem "xeques, capturas e ameaças" — do ponto de vista do adversário. A maioria das capivaradas some com esse hábito de 5 segundos.' });
  }
  if (allowedMate.length) {
    weaknesses.push(`Permitiu mate forçado em ${allowedMate.map(moveLabel).join(', ')}.`);
    tips.push({ title: 'Segurança do rei', text: 'Observe as casas ao redor do seu rei e as diagonais/colunas abertas apontando para ele. Lances de peão na frente do rei roque costumam criar fraquezas permanentes.' });
  }
  const otherBlunders = blunders.filter((p) => !p.hungPiece && !p.allowedMate);
  if (otherBlunders.length)
    weaknesses.push(`${otherBlunders.length > 1 ? 'Capivaradas' : 'Capivarada'} em ${otherBlunders.map((p) => `${moveLabel(p)} (melhor era ${p.bestSan})`).join(', ')}.`);
  if (!blunders.length && !mistakes.length && moves.length >= 10) strengths.push('Nenhum erro grave na partida — ótima consistência.');

  // ----- chances perdidas -----
  const missedMates = moves.filter((p) => p.missedMate && p.loss >= 5);
  if (misses.length) {
    weaknesses.push(`Não aproveitou ${misses.length > 1 ? `${misses.length} erros` : 'um erro'} do adversário: ${misses.map((p) => `${moveLabel(p)} (o certo era ${p.bestSan})`).join(', ')}.`);
    const forcing = misses.filter((p) => p.bestWasCapture || p.bestWasCheck).length;
    tips.push({
      title: 'Punir os erros do adversário',
      text: forcing
        ? 'Nas chances perdidas, o melhor lance era um lance forçado (xeque ou captura). Sempre que o adversário fizer um lance estranho, liste primeiro todos os xeques e capturas disponíveis.'
        : 'Quando o adversário errar, pare e procure o porquê do lance dele estar ruim — há quase sempre algo concreto a ganhar. Resolver problemas de tática treina esse reflexo.',
    });
  }
  if (missedMates.length)
    weaknesses.push(`Perdeu sequências de mate: ${missedMates.map((p) => `${moveLabel(p)} (mate em ${p.missedMate} com ${p.bestSan})`).join(', ')}.`);

  // ----- vantagem / resiliência -----
  const maxWin = Math.max(...moves.map((p) => p.wAfter));
  const minWin = Math.min(...moves.map((p) => p.wAfter));
  if (maxWin >= 85 && outcome !== 'win') {
    const peak = moves.find((p) => p.wAfter >= 85);
    weaknesses.push(`Você teve posição vencedora (após ${moveLabel(peak)}) mas não converteu.`);
    tips.push({ title: 'Converter vantagem', text: 'Com vantagem, simplifique: troque peças (não peões), elimine o contra-jogo do adversário e evite complicações desnecessárias.' });
  }
  if (minWin <= 15 && outcome !== 'loss') strengths.push('Ótima resiliência: virou ou salvou uma posição praticamente perdida.');

  // ----- tempo -----
  // ignora os 3 primeiros lances (pré-lances de abertura distorcem o tempo)
  const timed = moves.filter((p) => p.timeSpent != null && p.clock != null && p.moveNumber > 3);
  const isBullet = game.timeClass === 'bullet';
  if (!isDaily && timed.length >= 5 && game.baseTime) {
    const lowTime = isBullet ? 10 : Math.max(20, game.baseTime * 0.1);
    const errs = timed.filter((p) => ['mistake', 'blunder', 'miss'].includes(p.cls));
    const panic = errs.filter((p) => p.clock < lowTime);
    const goodTime = timed.filter((p) => !['inaccuracy', 'mistake', 'blunder', 'miss'].includes(p.cls));
    const avgGood = goodTime.length ? goodTime.reduce((a, p) => a + p.timeSpent, 0) / goodTime.length : 0;
    const rushed = isBullet ? [] : errs.filter((p) => p.clock >= lowTime && p.timeSpent < Math.max(2, avgGood * 0.5));
    if (panic.length) {
      weaknesses.push(`${panic.length} erro(s) grave(s) com o relógio baixo (${panic.map(moveLabel).join(', ')}).`);
      tips.push({ title: 'Gestão do tempo', text: 'Você entrou em apuros de tempo. Jogue mais rápido em posições simples e na abertura conhecida, guardando o tempo para os momentos críticos.' });
    }
    if (rushed.length) {
      weaknesses.push(`Lances impulsivos: ${rushed.map((p) => `${moveLabel(p)} em ${fmtTime(p.timeSpent)}`).join(', ')} — erros feitos rápido demais, com tempo sobrando.`);
      tips.push({ title: 'Momentos críticos', text: 'Quando a posição fica tensa (trocas, ataques, peças penduradas), pare alguns segundos a mais. Você tinha tempo no relógio nesses erros.' });
    }
    const lastClock = timed[timed.length - 1].clock;
    if (lastClock > game.baseTime * 0.5 && (blunders.length + mistakes.length) >= 2)
      tips.push({ title: 'Use seu tempo', text: `Você terminou com ${fmtTime(lastClock)} no relógio e cometeu erros evitáveis. Investir esse tempo em calcular teria mudado a partida.` });
    const errTime = errs.length ? errs.reduce((a, p) => a + p.timeSpent, 0) / errs.length : null;
    if (!isBullet && errs.length >= 2 && goodTime.length) {
      if (errTime < avgGood * 0.6) weaknesses.push(`Em média, você pensou ${fmtTime(errTime)} nos erros contra ${fmtTime(avgGood)} nos lances bons — os erros vieram da pressa.`);
    }
  }

  // ----- como a partida terminou -----
  const term = String(game.headers.Termination || '');
  const finalWin = game.evals.length ? (color === 'w' ? 1 : -1) * (game.evals[game.evals.length - 1].win - 50) + 50 : 50;
  if (outcome === 'loss' && /time/i.test(term)) {
    weaknesses.push(finalWin >= 50
      ? `Você perdeu por tempo estando melhor na posição (${finalWin.toFixed(0)}% de chance de vitória).`
      : 'Você perdeu por tempo.');
    if (!tips.some((t) => t.title === 'Gestão do tempo'))
      tips.push({ title: 'Gestão do tempo', text: 'Divida o tempo: abertura rápida, mais tempo no meio-jogo. Com pouco tempo, prefira lances simples e seguros a cálculos longos.' });
  } else if (outcome === 'loss' && /resignation/i.test(term) && finalWin >= 30) {
    weaknesses.push(`Você abandonou com a posição ainda jogável (${finalWin.toFixed(0)}% de chance de vitória segundo o motor).`);
    tips.push({ title: 'Não desista cedo', text: 'O motor ainda via chances. Em partidas online, adversários erram com frequência — continue jogando enquanto houver recursos.' });
  } else if (outcome === 'loss' && /abandon/i.test(term)) {
    weaknesses.push('A partida terminou por abandono (você saiu ou ficou sem jogar).');
  }

  // ----- peça mais problemática -----
  const errMoves = moves.filter((p) => ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(p.cls));
  const byPiece = {};
  errMoves.forEach((p) => (byPiece[p.piece] = (byPiece[p.piece] || 0) + 1));
  const [worstPiece, count] = Object.entries(byPiece).sort((a, b) => b[1] - a[1])[0] || [];
  if (count >= 3 && count / errMoves.length >= 0.5)
    weaknesses.push(`${count} dos seus ${errMoves.length} lances imprecisos foram com ${pieceWithArticle(worstPiece)}.`);

  // ----- momento decisivo -----
  const turning = [...moves].sort((a, b) => b.loss - a.loss)[0];
  const turningPoint = turning && turning.loss >= 10 ? turning : null;

  // ----- momentos-chave (clicáveis) -----
  const keyMoments = moves
    .filter((p) => ['brilliant', 'great', 'blunder', 'mistake', 'miss'].includes(p.cls))
    .map((p) => ({ ply: p, text: describeMove(p) }));

  if (!tips.length)
    tips.push({ title: 'Continue assim', text: 'Não houve um padrão claro de erro nesta partida. Revise as imprecisões e compare com o melhor lance para refinar ainda mais.' });

  return { headline, strengths, weaknesses, tips, keyMoments, turningPoint, termination: translateTermination(term) };
}

function translateTermination(t) {
  const map = [
    [/checkmate/i, 'por xeque-mate'], [/resignation/i, 'por abandono'], [/on time/i, 'por tempo'],
    [/abandoned/i, 'por abandono da partida'], [/repetition/i, 'empate por repetição'], [/agreement/i, 'empate por acordo'],
    [/stalemate/i, 'empate por afogamento'], [/insufficient/i, 'empate por material insuficiente'], [/50/, 'empate pela regra dos 50 lances'],
  ];
  const found = map.find(([re]) => re.test(t));
  if (!found) return t;
  const winner = (t.match(/^(\S+) won/) || [])[1];
  return winner ? `${winner} venceu ${found[1]}` : found[1].charAt(0).toUpperCase() + found[1].slice(1);
}

export function describeMove(p) {
  const c = CLASSES[p.cls];
  if (['best', 'brilliant', 'great', 'forced'].includes(p.cls)) {
    if (p.cls === 'brilliant') return `Brilhante! ${p.brilliantIdea || `${p.san} é um sacrifício que o motor confirma como o melhor.`}`;
    if (p.cls === 'great') return `${p.san} é o único lance que mantém a posição — ótimo achado.`;
    if (p.cls === 'forced') return `${p.san} era o único lance legal.`;
    return `${p.san} é o melhor lance.`;
  }
  let t = `${p.san} é ${c.label === 'Erro' ? 'um erro' : c.label === 'Capivarada' ? 'uma capivarada' : c.label === 'Imprecisão' ? 'uma imprecisão' : c.label === 'Chance perdida' ? 'uma chance perdida' : c.label.toLowerCase()}.`;
  if (p.bestSan) t += ` O melhor era ${p.bestSan}.`;
  if (p.allowedMate) t += ` Permite mate em ${p.allowedMate}.`;
  else if (p.hungPiece) t += ` Após ${p.refutation} você perde ${pieceWithArticle(p.hungPiece)}.`;
  if (p.missedMate) t += ` Havia mate em ${p.missedMate}.`;
  return t;
}
