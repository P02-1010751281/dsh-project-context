/**
 * The host contract — the only vocabulary the cores may name.
 *
 * Everything under `src/` outside `src/host/` imports the host-facing types from here, so a second
 * harness can satisfy the same names without the cores branching on the host. The contract itself is
 * host-neutral: it may not import a harness package, and `scripts/check-boundary.mjs` fails the
 * repository if it does.
 *
 * Where the names come from is the adapter's business: `src/host/dsh/types.ts` holds the dsh aliases
 * today, and a second adapter would add `src/host/<harness>/types.ts` beside it. The re-export below
 * is deliberately the whole file — the point of this module is the surface, not the mapping.
 *
 * Phase 2 of `docs/core-host-boundary.md` replaces these aliases with structural interfaces declared
 * here (a session view, an agent view, an event envelope) so that a harness adapter maps rather than
 * aliases. Until that lands, a type change in dsh still reaches the cores through this file; what the
 * split guarantees today is that the *import* is in the adapter, so the change lands in one directory.
 */
export * from "./dsh/types.js";
