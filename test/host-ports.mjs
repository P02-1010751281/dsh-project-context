/**
 * The facility ports a direct core-helper call takes, built from a fake context.
 *
 * A case that drives `apply()` keeps passing its fake context unchanged: the dsh adapter
 * (`src/host/dsh/host-context.ts`) reads `logger` / `llm` off that object lazily and uses the object
 * itself as the service registry. A case that calls a core helper directly (`consolidateProject`,
 * `writeTodoSnapshot`, `consolidateProjectState`) hands it the port shape instead — this builds the
 * same three members, with the adapter's own laziness, so a case that swaps `logger` or `llm` on the
 * fixture after building it still sees the swap.
 *
 * Not a `*.test.mjs` file, so the package's test glob does not pick it up — the same trick
 * `session-views.mjs` and `context-fixtures.mjs` use.
 */

/** @param ctx - a fake context carrying `logger` (the log), `get` (services) and `llm`. */
export function portsOf(ctx) {
	return {
		get log() {
			return ctx.logger;
		},
		get llm() {
			return ctx.llm;
		},
		services: ctx,
	};
}
