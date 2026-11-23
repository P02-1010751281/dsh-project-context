/**
 * Positive control for `test/host-contract.test.mjs`: both direction conversions must compile clean.
 *
 * These are the two shapes phase 2d closed. The outbound half used to be a wholesale service cast
 * (`ctx.llm as unknown as LlmPort`): a contract request that the host cannot accept would have been
 * passed through silently. The inbound half used to be a key cast (`["todos"] as unknown as
 * SnapshotKeys`): a misspelled or upstream-renamed projection key would have typechecked and then read
 * as an empty value. Both imports are the shipped adapter, so this file compiling clean is the
 * criterion — no fixture-only wrapper stands between the conversion and its real call site.
 */
import type { GenerateOptions as ContractGenerateOptions, ProjectionKey, Session as ContractSession } from "../../../src/host/contract.js";
import type { GenerateOptions as HostGenerateOptions } from "@deepseek-ai/dsh-llm";
import { toHostRequest } from "../../../src/host/dsh/llm.js";
import { projectionsOf } from "../../../src/host/dsh/services.js";

declare const services: { get(name: string): unknown };
declare const session: ContractSession;

/** Outbound: a contract request is accepted as the host's own request type, branded ids included. */
export const convert: (options: ContractGenerateOptions) => HostGenerateOptions = toHostRequest;

/** The contract's projection keys are closed and both are named; a third name would not compile. */
export const keys: readonly ProjectionKey[] = ["contextBreakdown", "todos"];

/** Inbound: the contract's key union and typed value table reach the core unchanged. */
export function projectionRead(): { readonly systemTokens?: number; readonly todos: unknown } {
	const snapshot = projectionsOf(services)?.snapshot(session, keys);
	return {
		...(snapshot?.values.contextBreakdown?.systemTokens === undefined ? {} : { systemTokens: snapshot.values.contextBreakdown.systemTokens }),
		todos: snapshot?.values.todos,
	};
}
