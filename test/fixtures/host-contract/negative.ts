/**
 * Negative control for `test/host-contract.test.mjs`: exactly the two planted mistakes must be
 * rejected, and nothing else may be.
 *
 * Each mistake stands for a failure the old casts allowed: a request built without its routing
 * session, and a projection key one character away from the real one. The test asserts the property
 * name and the key name, not the TypeScript error codes, so a compiler upgrade cannot quietly make
 * the fixture pass by rewording an error.
 */
import type { GenerateOptions as ContractGenerateOptions, Session as ContractSession } from "../../../src/host/contract.js";
import { toHostRequest } from "../../../src/host/dsh/llm.js";
import { projectionsOf } from "../../../src/host/dsh/services.js";

declare const services: { get(name: string): unknown };
declare const session: ContractSession;
declare const options: ContractGenerateOptions;

/** One field dropped: every auxiliary request names the session it routes on. */
export const droppedField = toHostRequest({
	provider: options.provider,
	model: options.model,
	messages: options.messages,
});

/** One key misspelled: the projection key union is closed, so a near-miss is not a key. */
export const misspelledKey = projectionsOf(services)?.snapshot(session, ["contextBreakdwon"]);
