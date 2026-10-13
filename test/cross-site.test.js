'use strict';

// SEC-02: binding to 127.0.0.1 keeps the LAN out, but every web page open in a
// browser on this machine can still reach 127.0.0.1. The run routes are GETs, so
// an <img> or EventSource on any site could start a `claude -p` run. These checks
// pin that only the dashboard's own page may call the API.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/config', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the API answers its own page and refuses other sites', async (t) => {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  t.after(() => server.kill());
  await new Promise((resolve) => server.stdout.once('data', resolve));

  const self = `localhost:${port}`;
  assert.strictEqual(await get(port, { Host: self, 'Sec-Fetch-Site': 'same-origin' }), 200);
  assert.strictEqual(await get(port, { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` }), 200);
  assert.strictEqual(await get(port, { Host: self }), 200, 'curl from a terminal still works');

  assert.strictEqual(await get(port, { Host: self, 'Sec-Fetch-Site': 'cross-site' }), 403, 'cross-site request');
  assert.strictEqual(await get(port, { Host: self, Origin: 'https://evil.test' }), 403, 'foreign Origin');
  assert.strictEqual(await get(port, { Host: `evil.test:${port}` }), 403, 'DNS rebinding Host');
});
