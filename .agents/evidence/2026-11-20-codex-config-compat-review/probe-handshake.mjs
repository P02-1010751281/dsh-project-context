import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CODEX_JS = process.argv[2];
const CODEX_HOME = process.argv[3];
const LABEL = process.argv[4] || 'test';

function run() {
  return new Promise((resolve) => {
    const env = { ...process.env, CODEX_HOME, HOME: process.env.HOME };
    // Run as: node codex.js app-server --stdio
    const child = spawn(process.execPath, [CODEX_JS, 'app-server', '--stdio'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const received = [];
    let stderr_buf = '';
    let resolved = false;

    function done(result) {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        resolve(result);
      }
    }

    child.stderr.on('data', (d) => { stderr_buf += d.toString(); });

    let buf = '';
    child.stdout.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          received.push(msg);
        } catch {}
      }
    });

    function send(obj) {
      child.stdin.write(JSON.stringify(obj) + '\n');
    }

    // Step 1: initialize
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'probe', title: 'probe', version: '0.0.1' },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });

    let step = 'init';
    const timer = setInterval(() => {
      // Check if we got initialize response
      if (step === 'init') {
        const initResp = received.find(m => m.id === 1);
        if (initResp) {
          step = 'initialized';
          // Send initialized notification
          send({ jsonrpc: '2.0', method: 'initialized', params: {} });
          // Send thread/start
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'thread/start',
            params: {
              cwd: '/tmp',
              ephemeral: true,
              model: 'opendesign/deepseek-v4.1-flash',
              approvalPolicy: 'on-request',
              approvalsReviewer: 'auto_review',
              sandbox: 'workspace-write',
            },
          });
          step = 'thread';
        }
      } else if (step === 'thread') {
        const threadResp = received.find(m => m.id === 2);
        if (threadResp) {
          clearInterval(timer);
          done({ label: LABEL, success: !threadResp.error, response: threadResp, stderr: stderr_buf.slice(0, 500) });
        }
      }
    }, 100);

    setTimeout(() => {
      clearInterval(timer);
      done({ label: LABEL, success: false, timeout: true, received, stderr: stderr_buf.slice(0, 500) });
    }, 10000);

    child.on('close', (code) => {
      clearInterval(timer);
      done({ label: LABEL, success: false, exitCode: code, received, stderr: stderr_buf.slice(0, 500) });
    });
  });
}

const result = await run();
console.log(JSON.stringify(result, null, 2));
