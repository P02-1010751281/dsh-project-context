/**
 * The host contract — the only vocabulary the cores may name.
 *
 * Everything under `src/` outside `src/host/` reads host objects through the shapes declared here, so a
 * second harness can satisfy them by mapping, without the cores branching on the host. The contract is
 * host-neutral: it names no harness package, and `scripts/check-boundary.mjs` fails the repository if
 * it does.
 *
 * Every interface below is the **subset the cores read**, attributed member by member with the type
 * checker (the property's declaration site), not a mirror of the host's declaration. A member that no
 * core reads is absent on purpose: adding one "for completeness" would make a second harness provide
 * something nothing consumes. The dsh adapter (`src/host/dsh/`) owns the mapping; where a dsh object
 * already satisfies a shape structurally — the session, the agent, every message and event the host
 * hands a core — no runtime wrapper exists and the assignability is checked wherever the host passes
 * one in.
 *
 * Two shapes are open-ended on the host side (the event log and the content-block list both grow when
 * a host package adds an entry). They are modeled as a closed union of the members the cores narrow
 * on plus one *opaque* member whose `type` names are declared by the adapter, through the
 * {@link OpaqueEventTypes} / {@link OpaqueBlockTypes} registries. That keeps `event.type === "…"`
 * a real discriminant for the cores while every host event or block stays assignable.
 *
 * `Context` is still the harness's own plugin context, re-exported from the adapter: registration
 * (`ctx.on`, `ctx.commands`, `ctx.systemPrompt`) is phase 2c of `docs/core-host-boundary.md`.
 */
// Pure predicates over the event vocabulary: values, not host types, so the contract may re-export
// them without naming a harness package (the gate only forbids `@deepseek-ai/*` here).
export { isReplacementSurfaceEvent, isSurfaceEligibleType } from "./dsh/types.js";
