#!/usr/bin/env node

const { createServer } = require('../lib/server');

const args = process.argv.slice(2);
let port = 3000;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
  localhook - Local webhook testing tool

  Usage:
    localhook [options]

  Options:
    -p, --port <port>  Port to listen on (default: 3000)
    -h, --help         Show this help message
`);
    process.exit(0);
  }
}

createServer(port);
