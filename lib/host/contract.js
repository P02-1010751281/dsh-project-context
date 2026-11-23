/**
 * The host contract — the only vocabulary the cores may name.
 *
 * Everything under `src/` outside `src/host/` reads host objects through the shapes declared here, so a
 * second harness can satisfy them by mapping, without the cores branching on the host. The contract is
 * host-neutral: it names no harness package, and `scripts/check-boundary.mjs` fails the repository if
 * it does.
 *
 * Every interface below is the subset the cores **name** — a member earns its place by being read,
 * written or forwarded by a core or by the adapter on a core's behalf, attributed with the type
 * checker rather than copied from the host's declaration. A member nothing names is absent on
 * purpose: adding one "for completeness" would make a second harness provide something nothing
 * consumes. (An output shape qualifies: `GenerateOptions` is built by the adapter from these fields,
 * and a message's `id` is written by the core that constructs it.) The dsh adapter (`src/host/dsh/`)
 * owns the mapping; where a dsh object
 * already satisfies a shape structurally — the session, the agent, every message and event the host
 * hands a core — no runtime wrapper exists and the assignability is checked wherever the host passes
 * one in.
 *
 * Four shapes are open-ended on the host side: the event log, the content-block list, the stream
 * chunk union and the finish-reason kinds all grow when a host package adds an entry. They are
 * modeled as a closed union of the members the cores narrow on plus one *opaque* member whose
 * `type` names are declared by the adapter, through the {@link OpaqueEventTypes} /
 * {@link OpaqueBlockTypes} / {@link OpaqueChunkTypes} / {@link OtherFinishKinds} registries. That
 * keeps `event.type === "…"` a real discriminant for the cores while every host event, block,
 * chunk or finish kind stays assignable.
 *
 * Registration goes through {@link HostContext} at the bottom of this file (phase 2c of
 * `docs/core-host-boundary.md`): a plugin entry adapts its harness context once and hands the core a
 * `HostContext`, so a core subscribes, registers and logs without naming the framework. `Context` is
 * still re-exported for the cores not yet moved behind the façade; see
 * `docs/host-context-2c-design.md` for which ones.
 */
// Pure predicates over the event vocabulary: values, not host types, so the contract may re-export
// them without naming a harness package (the gate only forbids `@deepseek-ai/*` here).
export { isReplacementSurfaceEvent, isSurfaceEligibleType } from "./dsh/types.js";
