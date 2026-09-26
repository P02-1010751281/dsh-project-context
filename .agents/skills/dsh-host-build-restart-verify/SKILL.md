---
name: dsh-host-build-restart-verify
description: "Build, load, and verify a dsh-project-context plugin change against the dsh host process that is actually serving the session (desktop vs web), including the restart and tab-reload steps and how to tell which code is live."
---

Use this whenever a change touches plugin host code (`src/**`, or anything that ends up in `lib/*.js`) or the client bundle and you need to reason about, or actually make, that change effective in the running dsh host.

1. A commit is never enough. The host loads plugin code from the repo's built `lib/*.js` through the profile `link:` dependency (e.g. `~/.dsh/profiles/web/package.json`). `pnpm test` / `pnpm typecheck` prove correctness, not that the host runs the new code.

2. Build before anything else. Node lives in the Nix store, so prepend it to PATH first:
   `PATH=/nix/store/gf597zf0ysgbngwb92baxgxjd02px6jh-nodejs-22.23.2/bin:$PATH pnpm build`
   Client bundle changes also require `pnpm build` (`pnpm test` compiles the host only). Run `pnpm test` and `pnpm typecheck` in the same pass to keep the verified baseline (currently 145/145).

3. Identify which host is actually serving the session before proposing or checking a restart. `desktop` (electron, `127.0.0.1:19387`, profile `~/.dsh/profiles/desktop`), `web` (`127.0.0.1:3080`, profile `~/.dsh/profiles/web`) and `ctxdev` all mount these plugins. Check the listening socket and the serving process's PID and start time (`ps -o lstart= -p <pid>`); do not assume the newest commits are loaded and do not assume it is the 3080 server.

4. Compare host start time against the newest build: the host start must be later than the `lib/` build mtime for the change to be live. If it is not, the change is not loaded no matter how clean the worktree is.

5. Never restart the user's host unprompted. Propose the restart (naming the host, PID, start time, and the commits that would load) and wait — goal/session control belongs to the user's agent session.

6. After an authorized restart, hard-reload every open dsh tab (`Ctrl+Shift+R`, or open a fresh tab). The browser-session cookie in `~/.dsh/.credentials.yaml` (`client-connection/browser-session`) is created once and does not rotate on restart, so no re-auth is needed. Client-only bundle changes are live via HMR after `pnpm build`, but already-open tabs still need one hard reload.

7. If old tabs look normal after a restart but actions never reach the server (half-dead UI), close all old dsh tabs and open a fresh one — the reconnect backoff (0.5 s → 10 s cap) does not always recover. A new tab restores sending in the same process.

8. Report verification honestly: host PID and start time, build time, and the fact that start > build. If the restart has not happened, say the change is committed/built but not yet loaded. Remember that host-side behavior can only be checked through the running host (read-only RPC/`Cordis` probes or the user's browser); there is no Chromium/Playwright on this machine.
