// App de desktop: sobe o servidor local dentro do próprio app e abre a interface numa janela
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const { start } = require('../server.js');

// Porta fixa: as preferências (motor, profundidade, último nick) ficam salvas por endereço,
// então mudar de porta a cada abertura as perderia. Se estiver ocupada, usa uma livre.
const APP_PORT = 51730;
const HOST = '127.0.0.1';

// Uma única instância: abrir de novo só traz a janela existente para frente
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

async function startServer() {
  try {
    return await start(APP_PORT, HOST);
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    return start(0, HOST);
  }
}

async function createWindow() {
  const port = await startServer();
  const origin = `http://${HOST}:${port}`;

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 420,
    minHeight: 500,
    backgroundColor: '#1f1e1c',
    title: 'Análise de Partidas',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);

  // links externos (ver a partida no chess.com/Lichess) abrem no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  // F12 abre as ferramentas de desenvolvedor; F5/Ctrl+R recarrega
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win.webContents.toggleDevTools();
    else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) win.webContents.reload();
  });

  win.once('ready-to-show', () => win.show());
  await win.loadURL(origin);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() =>
  createWindow().catch((e) => {
    dialog.showErrorBox('Não foi possível iniciar', String(e && e.message ? e.message : e));
    app.quit();
  })
);

app.on('window-all-closed', () => app.quit());
