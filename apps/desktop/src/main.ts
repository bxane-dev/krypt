import { app, BrowserWindow, Menu, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type Server as HttpServer } from 'node:http';
import net from 'node:net';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcess | null = null;
let staticServer: HttpServer | null = null;
let quitting = false;

function ensureJwtSecret() {
  const secretPath = path.join(app.getPath('userData'), 'jwt-secret');
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  }
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function contentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

async function startStaticServer(webRoot: string) {
  const root = path.resolve(webRoot);
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(root, relative);

    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.stat(target, (statError, stat) => {
      if (statError || !stat.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType(target),
        'Cache-Control': target.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable'
      });
      fs.createReadStream(target).pipe(res);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to bind desktop web server');
  return { server, port: address.port };
}

function startApiProcess(port: number, webOrigin: string) {
  const serverEntry = path.join(app.getAppPath(), 'apps', 'server', 'dist', 'index.js');
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      WEB_ORIGIN: webOrigin,
      DATABASE_PATH: path.join(app.getPath('userData'), 'krypt.db'),
      JWT_SECRET: process.env.JWT_SECRET || ensureJwtSecret()
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  child.stdout?.on('data', data => console.log(`[krypt-api] ${String(data).trimEnd()}`));
  child.stderr?.on('data', data => console.error(`[krypt-api] ${String(data).trimEnd()}`));
  return child;
}

function waitForApi(port: number, child: ChildProcess) {
  const deadline = Date.now() + 20_000;
  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error(`KRYPT API exited with code ${child.exitCode}`));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/api/health`, response => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() >= deadline) reject(new Error('Timed out waiting for KRYPT API'));
      else setTimeout(attempt, 150);
    };
    attempt();
  });
}

function createWindow(webPort: number, apiPort: number) {
  const localOrigin = `http://127.0.0.1:${webPort}`;
  mainWindow = new BrowserWindow({
    title: 'KRYPT',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#08090b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(localOrigin)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(localOrigin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  const url = `${localOrigin}/?desktopApi=${encodeURIComponent(`http://127.0.0.1:${apiPort}`)}`;
  void mainWindow.loadURL(url);
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function boot() {
  Menu.setApplicationMenu(null);
  const webRoot = path.join(app.getAppPath(), 'apps', 'web', 'dist');
  const staticResult = await startStaticServer(webRoot);
  staticServer = staticResult.server;

  const apiPort = await getFreePort();
  const webOrigin = `http://127.0.0.1:${staticResult.port}`;
  apiProcess = startApiProcess(apiPort, webOrigin);
  await waitForApi(apiPort, apiProcess);
  createWindow(staticResult.port, apiPort);
}

async function shutdown() {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill();
  apiProcess = null;
  if (staticServer) {
    await new Promise<void>(resolve => staticServer!.close(() => resolve()));
    staticServer = null;
  }
}

app.whenReady().then(boot).catch(error => {
  console.error('KRYPT desktop failed to start', error);
  app.exit(1);
});

app.on('activate', () => {
  if (!mainWindow && staticServer) {
    // A closed window will be recreated on the next full app launch.
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void shutdown().finally(() => app.quit());
});
