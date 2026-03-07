const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const DATA_DIR = path.join(os.homedir(), '.localhook');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const MAX_WEBHOOKS = 500;

let webhooks = [];
let sseClients = new Set();
let saveTimeout = null;

let publicUrl = null;
let tailscaleChild = null;

function startTailscaleFunnel(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('tailscale', ['funnel', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error('Timed out waiting for Tailscale Funnel URL (15s). Is Funnel enabled?'));
      }
    }, 15000);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      const match = stdout.match(/https:\/\/\S+\.ts\.net/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ child, url: match[0] });
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (err.code === 'ENOENT') {
          reject(new Error('Tailscale is not installed or not in PATH'));
        } else {
          reject(new Error(`Failed to start Tailscale Funnel: ${err.message}`));
        }
      }
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        const msg = stderr.trim() || `Process exited with code ${code}`;
        reject(new Error(`Tailscale Funnel failed: ${msg}`));
      }
    });
  });
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      webhooks = JSON.parse(raw);
      if (!Array.isArray(webhooks)) webhooks = [];
    }
  } catch {
    webhooks = [];
  }
}

function saveData() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(webhooks, null, 2));
    } catch (err) {
      console.error('Failed to save data:', err.message);
    }
  }, 300);
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function createServer(port, options = {}) {
  loadData();

  const app = express();

  // --- Basic Auth middleware ---
  // When --password is set, require HTTP Basic Auth for remote dashboard/API access.
  // Localhost requests are never challenged. Webhook capture routes are never protected.
  if (options.password) {
    const expectedPassword = Buffer.from(options.password);
    app.use((req, res, next) => {
      const isDashboardRoute = req.path === '/' || req.path.startsWith('/_/');
      if (!isDashboardRoute) return next();

      const isLocalhostHost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
      const isProxied = !!(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'] || req.headers['x-real-ip']);
      if (isLocalhostHost && !isProxied) return next();

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
        const password = Buffer.from(decoded.split(':').slice(1).join(':'));
        if (password.length === expectedPassword.length && crypto.timingSafeEqual(password, expectedPassword)) {
          return next();
        }
      }

      res.set('WWW-Authenticate', 'Basic realm="LocalHook"');
      return res.status(401).send('Authentication required');
    });
  }

  // --- Dashboard security guard ---
  // Block dashboard/API access from reverse proxies (ngrok, Cloudflare Tunnel,
  // Tailscale Funnel, etc.) unless --allow-dashboard-from-remote is set.
  // Detection: proxy headers indicate the request was forwarded, and a non-local
  // Host header indicates the client used a public URL.

  if (!options.allowRemoteAccess) {
    app.use((req, res, next) => {
      const isDashboardRoute = req.path === '/' || req.path.startsWith('/_/');
      if (!isDashboardRoute) return next();

      const isProxied = !!(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'] || req.headers['x-real-ip']);
      const isLocalhostHost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';

      if (isProxied || !isLocalhostHost) {
        return res.status(403).send('Dashboard and API access is restricted to localhost. Use --allow-remote-access to override.');
      }
      next();
    });
  }

  // --- UI & API routes (reserved under /_/) ---

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.get('/_/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  app.get('/_/api/public_url', (req, res) => {
    res.json({ url: publicUrl });
  });

  app.get('/_/api/webhooks', (req, res) => {
    res.json(webhooks);
  });

  app.get('/_/api/webhooks/:id', (req, res) => {
    const webhook = webhooks.find(w => w.id === req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Not found' });
    res.json(webhook);
  });

  app.delete('/_/api/webhooks/:id', (req, res) => {
    const idx = webhooks.findIndex(w => w.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    webhooks.splice(idx, 1);
    saveData();
    broadcast({ type: 'delete', id: req.params.id });
    res.json({ ok: true });
  });

  app.delete('/_/api/webhooks', (req, res) => {
    webhooks = [];
    saveData();
    broadcast({ type: 'clear' });
    res.json({ ok: true });
  });

  // --- Webhook capture (everything else) ---

  app.get('/favicon.ico', (req, res) => res.status(204).end());

  app.use((req, res, next) => {
    if (req.path.startsWith('/_/')) return next();

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');

      const webhook = {
        id: generateId(),
        method: req.method,
        path: req.originalUrl,
        headers: req.headers,
        query: req.query,
        body: body,
        size: Buffer.byteLength(body),
        ip: req.ip === '::1' ? '127.0.0.1' : (req.ip || '127.0.0.1'),
        timestamp: new Date().toISOString(),
      };

      // Log to terminal
      const d = new Date(webhook.timestamp);
      const time = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      const ct = webhook.headers['content-type'] || '';
      const sizeStr = webhook.size > 0 ? ` ${webhook.size}b` : '';
      console.log(`  \x1b[2m${time}\x1b[0m  \x1b[1m${webhook.method.padEnd(7)}\x1b[0m ${webhook.path}\x1b[2m${sizeStr}${ct ? '  ' + ct : ''}\x1b[0m`);

      webhooks.unshift(webhook);
      if (webhooks.length > MAX_WEBHOOKS) {
        webhooks = webhooks.slice(0, MAX_WEBHOOKS);
      }
      saveData();
      broadcast({ type: 'webhook', webhook });

      res.status(200).json({ ok: true, id: webhook.id });
    });
  });

  const server = app.listen(port, async () => {
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const dim = '\x1b[2m';
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';
    const yellow = '\x1b[33m';
    const magenta = '\x1b[35m';

    const passwordLine = options.password ? `\n  ${magenta}Password${reset}      enabled (remote only)` : '';

    if (options.tailscale) {
      try {
        const result = await startTailscaleFunnel(port);
        tailscaleChild = result.child;
        const tsUrl = result.url;
        publicUrl = tsUrl;

        console.log(`
  ${bold}LocalHook${reset} is running!

  ${green}Webhook URL${reset}   http://localhost:${port}${dim}/any-path${reset}
  ${yellow}Public URL${reset}    ${tsUrl}${dim}/any-path${reset}
  ${cyan}Dashboard${reset}     http://localhost:${port}/${passwordLine}

  ${dim}Send any HTTP request to capture it.${reset}
  ${dim}Press Ctrl+C to stop.${reset}
`);

        // Clean up tailscale child on exit
        const cleanup = () => {
          if (tailscaleChild) {
            tailscaleChild.kill();
            tailscaleChild = null;
          }
        };

        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });
        process.on('exit', cleanup);

        tailscaleChild.on('close', (code) => {
          if (tailscaleChild) {
            console.warn(`\n  ${yellow}Warning:${reset} Tailscale Funnel process exited unexpectedly (code ${code}). Public URL is no longer available.\n`);
            tailscaleChild = null;
          }
        });
      } catch (err) {
        console.error(`\n  Error: ${err.message}\n`);
        process.exit(1);
      }
    } else {
      console.log(`
  ${bold}LocalHook${reset} is running!

  ${green}Webhook URL${reset}   http://localhost:${port}${dim}/any-path${reset}
  ${cyan}Dashboard${reset}     http://localhost:${port}/${passwordLine}

  ${dim}Send any HTTP request to capture it.${reset}
  ${dim}Press Ctrl+C to stop.${reset}
`);
    }
  });

  return server;
}

module.exports = { createServer };
