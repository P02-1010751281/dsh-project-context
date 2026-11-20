import { spawn } from 'node:child_process';

const BIN = process.argv[2];
const CODEX_HOME = process.argv[3];
const LABEL = process.argv[4] || 'test';

function run() {
  return new Promise((resolve) => {
    const env = { ...process.env, CODEX_HOME };
    const child = spawn(BIN, ['app-server', '--stdio'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const received = [];
    let stderr_buf = '';
    let resolved = false;
    function done(r) { if (!resolved) { resolved = true; child.kill('SIGTERM'); resolve(r); } }
    child.stderr.on('data', (d) => { stderr_buf += d.toString(); });
    let buf = '';
    child.stdout.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        try { const m = JSON.parse(line.trim()); received.push(m); } catch {}
      }
    });
    function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'p', title: 'p', version: '0' }, capabilities: { experimentalApi: false, requestAttestation: false } } });
    let step = 'init';
    const timer = setInterval(() => {
      if (step === 'init') {
        const initResp = received.find(m => m.id === 1);
        if (initResp) {
          step = 'thread';
          send({ jsonrpc: '2.0', method: 'initialized', params: {} });
          send({ jsonrpc: '2.0', id: 2, method: 'thread/start', params: { cwd: '/tmp', ephemeral: true, model: 'opendesign/deepseek-v4.1-flash', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' } });
        }
      } else if (step === 'thread') {
        const t = received.find(m => m.id === 2);
        if (t) { clearInterval(timer); done({ label: LABEL, success: !t.error, response: t, stderr: stderr_buf.slice(0,400) }); }
      }
    }, 100);
    setTimeout(() => { clearInterval(timer); done({ label: LABEL, timeout: true, received, stderr: stderr_buf.slice(0,400) }); }, 10000);
    child.on('close', (c) => { clearInterval(timer); done({ label: LABEL, exitCode: c, received, stderr: stderr_buf.slice(0,400) }); });
  });
}
const r = await run(); console.log(JSON.stringify(r, null, 2));
