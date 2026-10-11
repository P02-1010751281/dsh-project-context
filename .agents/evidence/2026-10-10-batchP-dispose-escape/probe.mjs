// Read-only probe: does a throwing/rejecting agent/disposed listener escape the LOADED core?
const P = '/home/user/.dsh/desktop/nix-project/cl7chjvxjw81aizwlxar1k8n9z02yd3b-dsh-desktop-0.2.0-rc.2';
const { createRequire } = await import('node:module');
const req = createRequire(P + '/package.json');
const { Context } = req('@deepseek-ai/cordis');
const { Session, SessionId } = req('@deepseek-ai/dsh-session');
const AgentRegistry = req('@deepseek-ai/dsh-agent').default;

// Fail loud if an unhandled rejection is produced (the host's installFailLoud does exit(1) here).
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled++; console.log('UNHANDLED REJECTION ESCAPED:', e && e.message); });

function stubAgent(rawId) {
  const id = SessionId(rawId);
  return { id, options: {}, session: Session.create(id), inbox: {}, status: 'idle', ctx: new Context(),
    send(){}, followup(){}, steer:()=>({outcome:Promise.resolve({status:'rejected'})}), inject(){}, cancel(){},
    runMaintenance: t => t(new AbortController().signal), whenIdle: () => Promise.resolve() };
}

const ctx = new Context();
await ctx.plugin(AgentRegistry);
const warnings = [];
ctx.logger.warn = (m) => warnings.push(String(m));
const heard = [];
ctx.on('agent/disposed', () => { throw new Error('SYNC_BOOM'); });
ctx.on('agent/disposed', () => Promise.reject(new Error('ASYNC_BOOM')));
ctx.on('agent/disposed', ({ agent }) => void heard.push(agent.id));

const agent = stubAgent('probe');
const detach = await ctx.agents.register(agent);
detach();                      // emits agent/disposed
await new Promise(r => setTimeout(r, 50));   // let rejections settle

console.log('heard:', JSON.stringify(heard));
console.log('warnings:', JSON.stringify(warnings));
console.log('unhandledRejection count:', unhandled);
console.log('RESULT:', heard.length === 1 && warnings.length === 2 && unhandled === 0 ? 'CONTAINED' : 'ESCAPED');
process.exit(0);
