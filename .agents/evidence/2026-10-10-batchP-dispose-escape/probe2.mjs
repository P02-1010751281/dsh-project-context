// Read-only probe of the LOADED plugin built lib: a rejecting work promise handed to
// SessionWorkTracker.track must not become an unhandled rejection (the host's installFailLoud
// turns one into process.exit(1)).
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled++; console.log('UNHANDLED ESCAPED:', e && e.message); });

const mod = await import('/mnt/Data/Projects/dsh-project-context/lib/shared/lifecycle.js');
const { SessionWorkTracker, waitBounded } = mod;
const tracker = new SessionWorkTracker();
const fakeSession = { id: 'probe-session' };
tracker.track(fakeSession, Promise.reject(new Error('CONSOLIDATE_BOOM')));
const flushResult = tracker.flush(fakeSession);
await new Promise(r => setTimeout(r, 50));
const flushed = await flushResult;
console.log('flush resolved (never rejected):', flushed === undefined);
console.log('unhandledRejection count:', unhandled);
console.log('RESULT:', unhandled === 0 && flushed === undefined ? 'CONTAINED' : 'ESCAPED');
process.exit(0);
