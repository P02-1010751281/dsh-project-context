import { spawn } from 'node:child_process';
const BIN = process.argv[2], HOME_DIR = process.argv[3], CWD = '/etc/nixos';
const child = spawn(process.execPath, [BIN, 'app-server', '--stdio'], { env: { ...process.env, CODEX_HOME: HOME_DIR }, stdio: ['pipe','pipe','pipe'], cwd: CWD });
let buf='', err='', done=false; const out=[];
child.stderr.on('data', d => err += d.toString());
child.stdout.on('data', d => {
  buf += d.toString(); let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0,i); buf = buf.slice(i+1);
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  if (out.find(m => m.id === 1) && !child.__sent) {
    child.__sent = true;
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'initialized',params:{}})+'\n');
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'thread/start',params:{cwd:CWD,ephemeral:true,model:'opendesign/deepseek-v4.1-flash',approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:'workspace-write'}})+'\n');
  }
  const t = out.find(m => m.id === 2);
  if (t && !done) { done = true;
    const bad = err.split('\n').filter(l => /invalid|unrecognized/i.test(l));
    console.log(JSON.stringify({ threadOk: !t.error, error: t.error?.message ?? null, bad_stderr: bad.slice(0,3) }, null, 1));
    child.kill('SIGTERM'); setTimeout(()=>process.exit(0), 200);
  }
});
child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{clientInfo:{name:'p',title:'p',version:'0'},capabilities:{experimentalApi:false,requestAttestation:false}}})+'\n');
setTimeout(()=>{ if(!done){ console.log(JSON.stringify({timeout:true, stderr:err.slice(0,300)})); child.kill('SIGTERM'); process.exit(0);} }, 25000);
