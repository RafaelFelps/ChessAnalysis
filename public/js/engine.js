// Wrapper UCI para o Stockfish rodando em Web Worker
export const ENGINES = {
  sf19mt: { url: '/vendor/stockfish19/stockfish-19.js', threads: true },
  sf19: { url: '/vendor/stockfish19/stockfish-19-single.js' },
  sf19lite: { url: '/vendor/stockfish19/stockfish-19-lite-single.js' },
  full: { url: '/vendor/stockfish/stockfish-17.1-single-a496a04.js' },
  lite: { url: '/vendor/stockfish/stockfish-17.1-lite-single-03e3232.js' },
};

export class Engine {
  constructor(kind = 'sf19mt') {
    let def = ENGINES[kind] || ENGINES.sf19;
    // a versão multi-thread precisa de SharedArrayBuffer (página isolada); senão usa 1 thread
    if (def.threads && !self.crossOriginIsolated) def = ENGINES.sf19;
    this.kind = def === ENGINES[kind] ? kind : 'sf19';
    this.threads = def.threads ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    this.worker = new Worker(def.url);
    this.listeners = new Set();
    this.failed = null;
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      if (line.startsWith('worker sent an error')) this.fail(line);
      for (const fn of [...this.listeners]) fn(line);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.fail(e.message || 'erro no worker');
    };
  }

  fail(msg) {
    if (!this.failed) this.failed = new Error(msg);
    if (this.onFail) this.onFail(this.failed);
  }

  // Cria e inicializa o motor; se a versão multi-thread falhar (ex.: navegador sem
  // suporte a workers aninhados), volta automaticamente para a de 1 thread.
  static async start(kind, multiPv = 2) {
    const engine = new Engine(kind);
    try {
      await engine.init(multiPv);
      return engine;
    } catch (err) {
      engine.terminate();
      if (engine.kind !== 'sf19mt') throw err;
      console.warn('Stockfish multi-thread indisponível, usando 1 thread:', err.message);
      const fallback = new Engine('sf19');
      await fallback.init(multiPv);
      return fallback;
    }
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(predicate) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async init(multiPv = 2) {
    // rejeita se o worker falhar ou não responder a tempo
    let timer;
    const guard = new Promise((_, reject) => {
      if (this.failed) reject(this.failed);
      this.onFail = reject;
      timer = setTimeout(() => reject(new Error('o motor não respondeu')), 30000);
    });
    guard.catch(() => {});
    const ok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await Promise.race([ok, guard]);
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send('setoption name Hash value 64');
    if (this.threads > 1) this.send(`setoption name Threads value ${this.threads}`);
    const ready = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await Promise.race([ready, guard]);
    clearTimeout(timer);
    this.onFail = null;
  }

  // Analisa uma posição. Retorna linhas com score do ponto de vista de quem joga.
  analyse(fen, depth) {
    return new Promise((resolve) => {
      const lines = [];
      const fn = (line) => {
        if (line.startsWith('info') && line.includes(' pv ') && line.includes(' score ')) {
          const mpv = Number((line.match(/ multipv (\d+)/) || [0, 1])[1]);
          const cp = line.match(/ score cp (-?\d+)/);
          const mate = line.match(/ score mate (-?\d+)/);
          if (line.includes(' lowerbound') || line.includes(' upperbound')) return;
          lines[mpv - 1] = {
            depth: Number(line.match(/ depth (\d+)/)[1]),
            cp: cp ? Number(cp[1]) : null,
            mate: mate ? Number(mate[1]) : null,
            pv: line.split(' pv ')[1].trim().split(/\s+/),
          };
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(fn);
          resolve({ lines: lines.filter(Boolean), bestmove: line.split(/\s+/)[1] });
        }
      };
      this.listeners.add(fn);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.worker.terminate();
  }
}
