#!/usr/bin/env node

const { createServer } = require('./lib/server');

const args = process.argv.slice(2);
let port = 3000;
let tailscale = false;
let cloudflare = false;
let allowRemoteAccess = false;
let password = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--tailscale') {
    tailscale = true;
  } else if (args[i] === '--cloudflare') {
    cloudflare = true;
  } else if (args[i] === '--allow-remote-access') {
    allowRemoteAccess = true;
  } else if (args[i] === '--password' && args[i + 1]) {
    password = args[i + 1];
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
  localhook - Local webhook testing tool

  Usage:
    localhook [options]

  Options:
    -p, --port <port>             Port to listen on (default: 3000)
    --tailscale                   Start Tailscale Funnel for a public HTTPS URL
    --cloudflare                  Start Cloudflare Quick Tunnel for a public HTTPS URL
    --allow-remote-access         Allow dashboard/API access from non-localhost (e.g. via tunnel)
    --password <value>            Require HTTP Basic Auth for remote dashboard/API access
    -h, --help                    Show this help message
`);
    process.exit(0);
  }
}

if (tailscale && cloudflare) {
  console.error('\n  Error: --tailscale and --cloudflare are mutually exclusive. Use one or the other.\n');
  process.exit(1);
}

createServer(port, { tailscale, cloudflare, allowRemoteAccess, password });
