#!/usr/bin/env node

const { createServer } = require('./lib/server');

const args = process.argv.slice(2);
let port = 3000;
let tailscale = false;
let allowDashboardFromRemote = false;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--tailscale' || args[i] === '-t') {
    tailscale = true;
  } else if (args[i] === '--allow-dashboard-from-remote') {
    allowDashboardFromRemote = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
  localhook - Local webhook testing tool

  Usage:
    localhook [options]

  Options:
    -p, --port <port>                Port to listen on (default: 3000)
    -t, --tailscale                  Start Tailscale Funnel for a public HTTPS URL
    --allow-dashboard-from-remote    Allow dashboard access from non-localhost (e.g. via Tailscale Funnel)
    -h, --help                       Show this help message
`);
    process.exit(0);
  }
}

createServer(port, { tailscale, allowDashboardFromRemote });
