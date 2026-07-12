'use strict';

const { spawn } = require('child_process');

/**
 * Runs `claude -p <prompt>` with the given cwd, streaming stdout/stderr to the
 * response as Server-Sent Events. Uses spawn (not exec) so output streams live
 * rather than buffering until the process exits.
 */
function streamClaudeRun(res, { prompt, cwd }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const send = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const line of payload.split('\n')) {
      res.write(`data: ${line}\n`);
    }
    res.write('\n');
  };

  send('start', { prompt, cwd });

  let child;
  try {
    child = spawn('claude', ['-p', prompt], {
      cwd,
      shell: false,
      env: process.env,
      // Close stdin immediately: `claude -p` otherwise waits ~3s to see if input
      // is being piped in, which is pure dead time for a UI-triggered run.
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    send('error', { message: err.message });
    res.end();
    return;
  }

  child.stdout.on('data', (chunk) => {
    send('output', chunk.toString('utf8'));
  });

  child.stderr.on('data', (chunk) => {
    send('stderr', chunk.toString('utf8'));
  });

  child.on('error', (err) => {
    send('error', { message: err.message });
  });

  child.on('close', (code) => {
    send('done', { exitCode: code });
    res.end();
  });

  // If the client disconnects, stop the child rather than letting it run unattended.
  res.on('close', () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  });
}

module.exports = { streamClaudeRun };
