import { spawn } from 'node:child_process';
const [,, ...cmd] = process.argv; const model = process.env.M;
const ch = spawn(cmd[0], [...cmd.slice(1), 'app-server', '--stdio'], { env: process.env });
let out = '', err = ''; const send = o => ch.stdin.write(JSON.stringify(o) + '\n');
ch.stderr.on('data', d => err += d);
const params = { cwd: '/tmp', ephemeral: true, approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' };
if (model !== 'OMIT') params.model = model ?? 'opendesign/deepseek-v4.1-flash';
let sent = false;
ch.stdout.on('data', d => { out += d; for (const l of out.split('\n')) { let m; try { m = JSON.parse(l) } catch { continue }
  if (m.id === 1 && !sent) { sent = true; send({ jsonrpc: '2.0', method: 'initialized', params: {} }); send({ jsonrpc: '2.0', id: 2, method: 'thread/start', params }); }
  if (m.id === 2) { console.log(JSON.stringify(m.error ?? { ok: true, model: m.result?.model, thread: !!m.result?.thread }).slice(0, 300)); fin(); } } });
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'probe', title: 'probe', version: '0.0.1' }, capabilities: { experimentalApi: false, requestAttestation: false } } });
function fin() { const e = err.split('\n').filter(x => /invalid type|unrecognized|ignored|Under-development|error/i.test(x)).slice(0, 4).join(' | '); console.log('STDERR:', e.slice(0, 400) || '(none)'); ch.kill(); process.exit(0); }
setTimeout(() => { console.log('TIMEOUT'); fin(); }, 20000);
