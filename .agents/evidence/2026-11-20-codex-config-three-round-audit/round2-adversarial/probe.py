from pathlib import Path
import subprocess as s, os, sys, tempfile, signal, json, re, hashlib, tomllib
root=Path(__file__).resolve().parent
cfg=Path.home()/'.codex/config.toml'; live=cfg.read_bytes(); block=b'[features]\nasync_compaction = true\n'; assert live.endswith(block)
base=live[:-len(block)]; js=sys.argv[1]; cmd=['node',js]; os.umask(0o077)
with tempfile.TemporaryDirectory(dir=root) as d:
    p=Path(d).resolve(); assert p.parent==root; h=p/'codex'; h.mkdir(); c=h/'config.toml'; env=dict(PATH=os.environ['PATH'],HOME=d,CODEX_HOME=str(h),TMPDIR=d,XDG_CACHE_HOME=d,XDG_CONFIG_HOME=d,XDG_DATA_HOME=d,XDG_STATE_HOME=d,NO_PROXY='*',RUST_LOG='error'); print(s.check_output(cmd+['--version'],env=env,text=True).strip())
    def handshake(tag,data,model,cwd):
        c.write_bytes(data); q=s.Popen(cmd+['app-server','--stdio'],stdin=s.PIPE,stdout=s.PIPE,stderr=s.DEVNULL,env=env,cwd=d,text=True,start_new_session=True)
        def send(**v): q.stdin.write(json.dumps(dict(jsonrpc='2.0',**v))+'\n');q.stdin.flush()
        def receive(i):
            for _ in range(4):
                m=json.loads(q.stdout.readline());
                if m.get('id')==i:return m
            raise ValueError('unexpected events')
        try:
            signal.alarm(12);send(id=1,method='initialize',params={'clientInfo':{'name':'probe','version':'1'}});assert 'result' in receive(1);send(method='initialized',params={});send(id=2,method='thread/start',params=dict(cwd=cwd,ephemeral=True,model=model,approvalPolicy='on-request',approvalsReviewer='auto_review',sandbox='workspace-write'));r=receive(2); print(tag,r.get('error',{'thread_id_returned':bool(r.get('result',{}).get('thread',{}).get('id')),'model':r.get('result',{}).get('model')}))
        finally: signal.alarm(0);os.killpg(q.pid,signal.SIGTERM);q.wait()
    pin='auto/claude-opus-5-5';signal.signal(signal.SIGALRM,lambda *_: (_ for _ in ()).throw(TimeoutError()))
    handshake('table',base+b'[features.async_compaction]\nenabled = true\n',pin,'/tmp');handshake('deleted',base,pin,'/tmp');handshake('boolean',live,pin,'/tmp');handshake('different cwd + unknown model',live,'invalid/no-such-model',d)
    for name,b in [('ON',block),('OFF',block.replace(b'true',b'false'))]:
        c.write_bytes(base+b); f=s.run(cmd+['features','list'],env=env,cwd=d,capture_output=True); rows=re.findall(rb'^async_compaction\b.*$',f.stdout,re.M); print(name,'features list',f.returncode,rows,'positive control (multi_agent listed)',bool(re.search(rb'^multi_agent\b',f.stdout,re.M)))
        result=s.run(cmd+['--enable','async_compaction','features','list'],env=env,cwd=d,capture_output=True); print(name,'explicit enable',result.returncode,result.stderr.decode().strip().splitlines()[-1]);
        args=['-c','model_providers.magpie.base_url="http://127.0.0.1:1/v1"','-c','model_providers.magpie.request_max_retries=0','-c','model_providers.magpie.stream_max_retries=0','-c','mcp_servers.magpie.enabled=false','exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','-C',d,'-m','invalid/no-such-model','x']; z=s.run(['timeout','-k','1','8']+cmd+args,env=env,cwd=d,capture_output=True); raw=z.stderr; norm=re.sub(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z',b'<TIME>',raw); (root/(name+'.stderr')).write_bytes(norm); print(name,'exec rc',z.returncode,'warning',b'Under-development features enabled' in raw,'normalized sha256',hashlib.sha256(norm).hexdigest());
print('normalized byte equality:',(root/'ON.stderr').read_bytes()==(root/'OFF.stderr').read_bytes())
