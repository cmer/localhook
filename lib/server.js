const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.localhook');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const MAX_WEBHOOKS = 500;

let webhooks = [];
let sseClients = new Set();
let saveTimeout = null;

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

function createServer(port) {
  loadData();

  const app = express();

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

  app.get('/_/api/webhooks', (req, res) => {
    res.json(webhooks);
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

  const server = app.listen(port, () => {
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const dim = '\x1b[2m';
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';

    console.log(`
  ${bold}LocalHook${reset} is running!

  ${green}Webhook URL${reset}   http://localhost:${port}${dim}/any-path${reset}
  ${cyan}Dashboard${reset}     http://localhost:${port}/

  ${dim}Send any HTTP request to capture it.${reset}
  ${dim}Press Ctrl+C to stop.${reset}
`);
  });

  return server;
}

module.exports = { createServer };
