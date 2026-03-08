const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const DATA_DIR = path.join(os.homedir(), '.localhook');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const MAX_WEBHOOKS = 500;
const HEARTBEAT_INTERVAL_MS = 5000;

let webhooks = [];
let sseClients = new Set();
let saveTimeout = null;

let publicUrl = null;
let tunnelService = null;
let tunnelChild = null;

function findTailscaleBinary() {
  // macOS App Store install location
  const macosPath = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  if (process.platform === 'darwin' && fs.existsSync(macosPath)) {
    return macosPath;
  }
  return 'tailscale';
}

function startTailscaleFunnel(port) {
  return new Promise((resolve, reject) => {
    const bin = findTailscaleBinary();
    const child = spawn(bin, ['funnel', String(port)], {
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

    const onStdout = (data) => {
      stdout += data.toString();
      const match = stdout.match(/https:\/\/\S+\.ts\.net/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        child.stdout.removeListener('data', onStdout);
        child.stderr.removeListener('data', onStderr);
        resolve({ child, url: match[0] });
      }
    };

    const onStderr = (data) => {
      stderr += data.toString();
    };

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);

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
        const msg = stderr.trim() || stdout.trim() || `Process exited with code ${code}`;
        reject(new Error(`Tailscale Funnel failed: ${msg}`));
      }
    });
  });
}

function startCloudflaredTunnel(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--protocol', 'http2'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let tunnelUrl = null;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error('Timed out waiting for Cloudflare Quick Tunnel (60s). Is cloudflared installed?'));
      }
    }, 60000);

    const onStderr = (data) => {
      stderr += data.toString();

      if (!tunnelUrl) {
        const match = stderr.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) tunnelUrl = match[0];
      }

      if (tunnelUrl && !resolved && /Registered tunnel connection/.test(stderr)) {
        resolved = true;
        clearTimeout(timeout);
        child.stderr.removeListener('data', onStderr);
        resolve({ child, url: tunnelUrl });
      }
    };

    child.stderr.on('data', onStderr);

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (err.code === 'ENOENT') {
          reject(new Error('cloudflared is not installed or not in PATH. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
        } else {
          reject(new Error(`Failed to start Cloudflare Quick Tunnel: ${err.message}`));
        }
      }
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        const msg = stderr.trim() || `Process exited with code ${code}`;
        reject(new Error(`Cloudflare Quick Tunnel failed: ${msg}`));
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

  app.use('/_/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.get('/_/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('\n');
    sseClients.add(res);

    const heartbeatInterval = setInterval(() => {
      res.write('event: heartbeat\ndata: \n\n');
    }, options.heartbeatInterval || HEARTBEAT_INTERVAL_MS);

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      sseClients.delete(res);
    });
  });

  app.get('/_/api/public_url', (req, res) => {
    res.json({ url: publicUrl, service: tunnelService, poll: !!options.poll });
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

    if (options.tailscale || options.cloudflare) {
      const serviceName = options.tailscale ? 'Tailscale Funnel' : 'Cloudflare Quick Tunnel';
      try {
        const result = options.tailscale
          ? await startTailscaleFunnel(port)
          : await startCloudflaredTunnel(port);
        tunnelChild = result.child;
        publicUrl = result.url;
        tunnelService = options.tailscale ? 'tailscale' : 'cloudflare';

        console.log(`
  ${bold}LocalHook${reset} is running!

  ${green}Webhook URL${reset}   http://localhost:${port}${dim}/any-path${reset}
  ${yellow}Public URL${reset}    ${result.url}${dim}/any-path${reset}
  ${cyan}Dashboard${reset}     http://localhost:${port}/${options.allowRemoteAccess ? `${dim} or ${reset}${result.url}/` : ''}${passwordLine}

  ${dim}Send any HTTP request to capture it.${reset}
  ${dim}Press Ctrl+C to stop.${reset}
`);

        const cleanup = () => {
          if (tunnelChild) {
            tunnelChild.kill();
            tunnelChild = null;
          }
        };

        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });
        process.on('exit', cleanup);

        tunnelChild.on('close', (code) => {
          if (tunnelChild) {
            console.warn(`\n  ${yellow}Warning:${reset} ${serviceName} process exited unexpectedly (code ${code}). Public URL is no longer available.\n`);
            tunnelChild = null;
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
