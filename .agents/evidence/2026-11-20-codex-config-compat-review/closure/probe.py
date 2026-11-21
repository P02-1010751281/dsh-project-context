import asyncio, json, os, shutil, signal, subprocess, tempfile, tomllib
from pathlib import Path
from hashlib import sha256

store=Path('/nix/store'); live=Path.home()/'.codex/config.toml'; backup=next(live.parent.glob('config.toml.bak-20261120-154416-*'))
js=next(store.glob('xbbn*-dsh-desktop-*/lib/dsh-desktop/repo/node_modules/.pnpm/@openai+codex@0.153.4/node_modules/@openai/codex/bin/codex.js'))
bins=[[shutil.which('node'),str(js)]]+[[str(next(store.glob('*-codex-'+v+'/bin/codex')))] for v in ['0.164.0','0.167.0','0.169.0']]; cwd='/etc/nixos'; key='async_compaction'
async def test(cmd,form,h):
    f=h/'config.toml'; src=backup if form!='bool' else live; shutil.copyfile(src,f); env=dict(os.environ,CODEX_HOME=str(h),HOME=str(h),XDG_CACHE_HOME=str(h/'cache'),XDG_STATE_HOME=str(h/'state'),XDG_DATA_HOME=str(h/'data'),TMPDIR=str(h)); start=f.read_bytes(); shape=tomllib.loads(start.decode())['features'][key]; assert shape==({'enabled':True} if form!='bool' else True)
    def cli(args): return subprocess.run(cmd+args,cwd=cwd,env=env,capture_output=True,text=True,timeout=15)
    version=cli(['--version']).stdout.strip(); print(version,form,end=' ')
    if form.startswith('writer'):
        if form=='writer-absent':
            block=b'[features.async_compaction]\nenabled = true\n'; assert start.count(block)==1; start=start.replace(block,b''); f.write_bytes(start)
        r=cli(['features','enable',key]); end=f.read_bytes(); print('rc',r.returncode,(r.stdout+r.stderr).strip(),'identical',start==end,'block',[x for x in end.decode().splitlines() if x.startswith(('[features',key,'enabled = true'))]); return
    p=await asyncio.create_subprocess_exec(*cmd,'app-server','--stdio',cwd=cwd,env=env,stdin=-1,stdout=-1,stderr=-3,start_new_session=True)
    async def rpc(method,params,i=None):
        req={'jsonrpc':'2.0','method':method,'params':params}; req.update({} if i is None else {'id':i}); p.stdin.write(json.dumps(req).encode()+b'\n'); await p.stdin.drain()
        if i is not None:
            while line:=await asyncio.wait_for(p.stdout.readline(),15):
                v=json.loads(line)
                if v.get('id')==i: return v
            raise RuntimeError('EOF '+method)
    try:
        init=await rpc('initialize',{'clientInfo':{'name':'deepseek-harness','version':'1'},'capabilities':{'experimentalApi':True}},1); assert 'result' in init,init; await rpc('initialized',{}); v=await rpc('thread/start',dict(cwd=cwd,ephemeral=True,model='opendesign/deepseek-v4.1-flash',approvalPolicy='on-request',approvalsReviewer='auto_review',sandbox='workspace-write'),2); print(v['error'] if 'error' in v else 'thread '+v['result']['thread']['id'])
    finally:
        if p.returncode is None: os.killpg(p.pid,signal.SIGTERM)
        await p.wait()
async def main():
    for cmd in bins:
        for form in ['writer-nested','writer-absent','nested','bool']:
            with tempfile.TemporaryDirectory(dir='/tmp',prefix='closure-codex-') as home: await test(cmd,form,Path(home))
if __name__=='__main__': asyncio.run(main())
