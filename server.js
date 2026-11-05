// Servidor local: arquivos estáticos + Stockfish/chess.js do node_modules + proxy das APIs públicas do chess.com e do Lichess
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
};

// Rotas virtuais -> arquivos reais
const ROUTES = [
  ['/vendor/chess.js', path.join(ROOT, 'node_modules/chess.js/dist/esm/chess.js')],
  ['/vendor/stockfish/', path.join(ROOT, 'node_modules/stockfish/src/')],
  ['/vendor/stockfish19/', path.join(ROOT, 'node_modules/stockfish19/bin/')],
];

function resolveFile(urlPath) {
  for (const [prefix, target] of ROUTES) {
    if (urlPath === prefix) return target;
    if (prefix.endsWith('/') && urlPath.startsWith(prefix)) {
      return path.join(target, urlPath.slice(prefix.length));
    }
  }
  return path.join(ROOT, 'public', urlPath === '/' ? 'index.html' : urlPath);
}

async function proxy(res, url, site, accept = 'application/json') {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ChessAnalysis-local/1.0', Accept: accept } });
    const body = await r.text();
    res.writeHead(r.status, { 'Content-Type': (r.headers.get('content-type') || 'application/json') });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `Falha ao contatar ${site}: ` + e.message }));
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const urlPath = decodeURIComponent(url.pathname);

  if (urlPath.startsWith('/api/')) return proxy(res, 'https://api.chess.com/pub/' + urlPath.slice(5), 'chess.com');
  // Lichess: /lichess/<rota da API>?<query>; a exportação de partidas vem em NDJSON (uma partida por linha)
  if (urlPath.startsWith('/lichess/')) {
    const apiPath = urlPath.slice(9);
    const accept = apiPath.startsWith('games/') ? 'application/x-ndjson' : 'application/json';
    return proxy(res, 'https://lichess.org/api/' + encodeURI(apiPath) + url.search, 'Lichess', accept);
  }

  const file = resolveFile(urlPath);
  // Impede sair das pastas permitidas
  const allowed = [path.join(ROOT, 'public'), path.join(ROOT, 'node_modules')];
  if (!allowed.some((dir) => path.resolve(file).startsWith(dir))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': file.includes('node_modules') ? 'max-age=86400' : 'no-cache',
      // isolamento de origem: libera SharedArrayBuffer para o Stockfish multi-thread
      // ("credentialless" mantém as fotos de perfil do chess.com carregando)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Chess Analysis rodando em http://localhost:${PORT}`);
});
