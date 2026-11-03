/**
 * One fake session, both views of it.
 *
 * A live `Session` exposes `deriveMessages()` (the model-visible surface, replacement copies standing
 * in for what they shadowed) and the append-only `snapshotEvents()` + `deriveEventMessage()` pair.
 * The handoff reads the second one, because a compaction's checkpoint is a surface *replacement* and
 * reading the surface would hand a successor a compressed branch as if it were the conversation.
 *
 * A fixture that models only `deriveMessages()` therefore models a session this plugin cannot read,
 * and the failure it produces is a `TypeError`, not a wrong assertion — so every handoff fixture now
 * builds both views from the same message list. The event payload is opaque on purpose: the fake's
 * own `deriveEventMessage` returns the message it was built from, which is exactly the contract the
 * reader relies on (the projection itself is upstream's and is not re-tested here).
 *
 * `surfaceOp: "append"` matters: the reader drops replacement copies, so a fixture without the marker
 * would be read as append-origin by accident and would not prove the skip.
 */

/** The event type a derived message would have carried in the log. */
function eventTypeOf(message) {
	if (message.role === "tool") return "tool/result";
	if (message.role === "assistant") return "assistant/message";
	if (message.role === "system") return "system/message";
	return "user/message";
}

/**
 * Build the two session views over one message list.
 * @param messages - the messages, in order, as `deriveMessages()` would return them.
 * @returns the `deriveMessages` / `snapshotEvents` / `deriveEventMessage` triple.
 */
export function sessionViews(messages) {
	return {
		deriveMessages: () => messages,
		snapshotEvents: () =>
			messages.map((message, index) => ({
				type: eventTypeOf(message),
				seq: index + 1,
				time: 0,
				data: {},
				surfaceOp: "append",
				message,
			})),
		deriveEventMessage: (event) => event.message ?? null,
	};
}

/**
 * Build the two views where a later event replaces an earlier span, the way a compaction does.
 *
 * The replaced events stay in the log (it is append-only) and leave the surface, which is the exact
 * shape the handoff reader exists to handle: an append-origin read renders the shadowed span and
 * drops the replacement, a surface read does the opposite.
 * @param messages - the messages the log carries, in order.
 * @param replacement - which message indices the replacement shadows, and the replacement's own text.
 * @returns the same triple as {@link sessionViews}, with the replacement applied to the surface.
 */
export function compensatingSessionViews(messages, replacement) {
	const events = messages.map((message, index) => ({
		type: eventTypeOf(message),
		seq: index + 1,
		time: 0,
		data: {},
		surfaceOp: "append",
		message,
	}));
	const start = Math.min(...replacement.shadows) + 1;
	const end = Math.max(...replacement.shadows) + 1;
	const replacementMessage = {
		role: "user",
		source: { kind: "compaction" },
		content: [{ type: "text", text: replacement.text }],
	};
	events.push({
		type: "user/message",
		seq: events.length + 1,
		time: 0,
		data: {},
		surfaceOp: { op: "replace", startSeq: start, endSeq: end },
		message: replacementMessage,
	});
	const shadowed = new Set(replacement.shadows);
	const surface = messages.filter((_, index) => !shadowed.has(index)).concat([replacementMessage]);
	return {
		deriveMessages: () => surface,
		snapshotEvents: () => events,
		deriveEventMessage: (event) => event.message ?? null,
	};
}
