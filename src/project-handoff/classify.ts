/**
 * Failure classification: a deferral (the session moved on — not a failure), a transient
 * failure (safe to retry), or a terminal one. The wording heuristic is deliberately
 * conservative; its accepted residual misclassifications are listed next to the patterns.
 */

/**
 * Raised by the automatic path when the session started a new turn while the handoff was being
 * prepared. Not a failure: `turn/end` is the trigger, but the harness pumps a queued user message
 * into the very next turn as soon as the current one closes, so the parent can be back at work
 * seconds later — before the summary call returns. Creating the child then would leave the parent
 * and the continuation editing the same project (the 2026-09-17 incident: the auto handoff fired at
 * `turn/end` of turn 9, the queued message opened turn 10 in the same second, and the child was
 * created 8 seconds later while the parent went on to do the same fix). The next `turn/end`
 * re-evaluates, so the handoff only waits for the session to actually settle.
 */
export class HandoffDeferred extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HandoffDeferred";
	}
}

/**
 * Raised when a handoff failed for a reason that a plain retry can clear — the session controller
 * refused the seed because a turn was already open, the summary route dropped the connection, the
 * provider rate-limited the call. Distinct from an ordinary `Error`, which is terminal: a handoff
 * document that cannot be built, a model that does not exist, a project root that cannot be read.
 *
 * The manual path needs the distinction because `/handoff now` renders its `catch` verbatim: a
 * retryable cause reported as "Handoff failed" tells the user the operation is over when the fix
 * is to run the same command again. The automatic path does not need it (it retries on its own
 * schedule), so this class exists for the receipt.
 */
export class HandoffTransient extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "HandoffTransient";
	}
}

/**
 * Error codes and message shapes that mean "try again", not "this will never work". Heuristic and
 * deliberately small: a cause that is not recognized stays terminal, because telling a user to
 * retry a genuinely broken handoff is the worse misattribution of the two.
 */
const TRANSIENT_ERROR_CODES = new Set([
	"ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND",
	"ENETUNREACH", "EHOSTUNREACH", "ENETDOWN", "ECONNABORTED",
	"ERR_STREAM_PREMATURE_CLOSE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "ABORT_ERR", "ERR_CANCELED",
]);

/**
 * HTTP statuses that mean "the server is busy or briefly down", never a client-side mistake.
 */
const TRANSIENT_STATUS = String.raw`429|502|503|504`;

/**
 * A unit a status code is *not*: `503 tokens` is a count, not an HTTP 503. Needed wherever the code
 * is followed by more text (the HTTP-context branch), because the end-of-message rule cannot apply
 * there. The list is a best effort and cannot be complete, so an unlisted unit reads as a status —
 * an over-promise, i.e. the direction the bias does **not** protect.
 */
const NOT_A_COUNT = String.raw`(?!\s*(?:tokens?|chars?|bytes?|ms\b|sec(?:onds?)?|minutes?|hours?|users?|records?|errors?|calls?|attempts?|retries|files?|points?|items?|lines?|rows?|entries?|turns?|requests?|quota))`;

/**
 * A noun that introduces a *configured value* rather than a status: `the limit is 429` ends in the
 * same shape as `server returned 503`, so a code at the end of a message is only treated as a status
 * when no such noun stands shortly before it.
 *
 * Only a **leading** boundary is required. The forms that actually appear are the project's own config
 * keys — `max_tokens`, `maxTokens`, `token_limit`, `window_size`, `handoffTargetTokens` — and a
 * trailing boundary would reject every one of them, because the noun continues as `_x` or camelCase.
 * A leading boundary still keeps a word that merely *contains* the noun (`unlimited`) out.
 */
const VALUE_NOUN = String.raw`limit|offset|max|min|size|count|total|budget|threshold|capacity|length|index|value|number|quota|ratio|window|tokens?|target`;

/**
 * What `overload` must **not** be followed by: a config noun or an identifier suffix. Without this the
 * actor branch reads `service overload protection enabled` as a transient, which is the over-promise
 * direction — a setting was reported as a retryable overload.
 *
 * Like {@link NOT_A_COUNT} this is a **best-effort** list, not an enumeration: an unlisted config noun
 * (`service overload mode enabled`) still reads as a transient. A false "safe to retry" is the
 * direction the general bias does not protect, so the list is worth extending when a real spelling
 * shows up — but its completeness cannot be a precondition for shipping.
 */
const OVERLOAD_NOT_A_STATEMENT = String.raw`(?![\p{L}\p{N}_]|\s+(?:protection|control|factor|threshold|limit|ratio|handler|detection|guard|setting|handling|level|policy))`;

/**
 * The actors and words that turn a nearby status code into an HTTP status, for a code the end rule
 * cannot see because more text follows it.
 */
const HTTP_CONTEXT = String.raw`https?|status(?:_?code)?|response|request|error|err|code|reason|server|provider|backend|upstream|gateway|api|endpoint|service`;

/**
 * Message shapes that mean "try again".
 *
 * Two failure modes have to be avoided at once, and the obvious regex for each one causes the other:
 * wrapping the whole alternation in `\b…\b` demotes the *stems* upstream actually uses
 * (`overloaded_error`, `rate_limit_exceeded`), while dropping the boundaries lets a stem match inside
 * an unrelated identifier (`requestTimeout` is a config key, `temporary directory` is a path).
 *
 * Boundaries are therefore placed **per alternative**, and every alternative that is also ordinary
 * vocabulary carries a **leading** boundary as well as a trailing one:
 *
 * - `overloaded` / `rate.?limit` need `(?<![\p{L}\p{N}_])`, because `invalid max_rate_limit: must be
 *   positive` and `invalid overload_factor: must be > 0` are config identifiers, and `separate
 *   limits apply` contains `rate` only as the tail of "separate". The `_` is excluded from the
 *   boundary so `rate_limit_exceeded` and `overloaded_error` still match, and the inflections
 *   (`rate limited`, `rate-limited`, `rate limiting`) are part of the alternative — a trailing
 *   boundary placed after the stem alone would drop them.
 * - `timeout` allows the plural/gerund (`timeouts`, `timing out`) but not an identifier
 *   (`requestTimeout`), so a letter on either side disqualifies it while `_` does not.
 * - `temporar` is only transient in its collocations ("temporarily unavailable"), never as the bare
 *   adjective ("temporary directory is read-only").
 * - the retry advice carries a leading boundary (so `unsafe to retry` does not match on its
 *   `safe to retry` tail) and is dropped when a nearby prohibition negates it — "do not try again" is
 *   the opposite instruction, while a neutral "the failure is not permanent, please retry" is not.
 *
 * A bare status code is the hardest case, because a count and a status can have the **same shape**:
 * `429 requests` and `429 Too Many Requests` differ only in which words follow. Three rules separate
 * them, and they are checked in this order by {@link transientByWording}:
 *
 * 1. a code the message **ends** on counts (optionally followed by punctuation) — a count always
 *    carries its unit after the number, so `429 tokens` cannot be final. This is what makes
 *    `server returned 503` and `[503]` transient;
 * 2. rule 1 alone would also accept a configured value (`the limit is 429`), so the code is ignored
 *    when a value noun ({@link VALUE_NOUN}) stands shortly before it — including the project's own
 *    camel/snake-case config keys; and
 * 3. a code **followed by more text** cannot use rule 1, so it counts only with an HTTP context word
 *    before it ({@link HTTP_CONTEXT}) and no unit after it ({@link NOT_A_COUNT}) — such as
 *    `HTTP/1.1 503` or `status 503 backend unhealthy`, but not `response is 503 tokens`.
 *
 * This is a heuristic over wording the runtime controls, and it is deliberately biased toward
 * "terminal": a shape that is not recognized is reported as an ordinary failure rather than promised
 * a retry. It cannot be exact, and the residuals run in **both** directions: a doubly-negated
 * prohibition ("it is not unsafe to retry") falls on the terminal side, while a value noun in a form
 * none of these patterns anticipates — an unlisted unit, or a compound such as `subtotal` — reads as
 * a status, i.e. over-promises.
 *
 * Standard reason phrases need no listing of their own: each is already an alternative above.
 */
const TRANSIENT_ERROR_PATTERN = new RegExp([
	// Unambiguous multi-word phrases: no plausible non-transient reading.
	String.raw`too many requests`,
	String.raw`service unavailable`,
	String.raw`bad gateway`,
	String.raw`internal server error`,
	String.raw`gateway time-?out`,
	String.raw`socket hang ?up`,
	String.raw`premature close`,
	String.raw`connection (?:was |is |got )?(?:reset|refused|closed|aborted|lost|dropped)`,
	String.raw`network (?:is )?(?:unreachable|down|error|fail\w*|unavailable)`,
	String.raw`already (?:running|in flight)`,
	// Also config nouns, so both boundaries are required. `_` is not a boundary, so the upstream
	// identifier spellings (`rate_limit_exceeded`, `overloaded_error`) still match. The inflections
	// must stay inside the alternative: `(?![\p{L}\p{N}])` after the stem alone would reject them.
	String.raw`(?<![\p{L}\p{N}_])rate.?limit(?:s|ed|ing)?(?![\p{L}\p{N}])`,
	String.raw`(?<![\p{L}\p{N}_])overloaded(?![\p{L}\p{N}])`,
	// `overload` is also a config noun, so it counts only in a transient *phrase*: next to a status
	// code or an actor (`429 overload`, `service overload, try later`), and not when it heads a config
	// statement (`service overload protection enabled`, `server overload threshold 0.8`,
	// `overload_factor`). `OVERLOAD_STATEMENT` is that negative case.
	String.raw`(?:${TRANSIENT_STATUS})[^\p{L}\p{N}]{0,4}overload${OVERLOAD_NOT_A_STATEMENT}`,
	String.raw`(?:${HTTP_CONTEXT})[^\p{L}\p{N}]{1,4}overload${OVERLOAD_NOT_A_STATEMENT}`,
	// Plural and gerund included; an identifier is excluded by requiring a non-letter on both sides.
	String.raw`(?<![\p{L}\p{N}])tim(?:e|ed|ing)[- ]?outs?(?![\p{L}\p{N}_])`,
	String.raw`temporar(?:ily|y) (?:unavailable|failure|error|outage|issue|problem)`,
	// The `ERR_HTTP_503` identifier family (undici/Node), which has no printable reason phrase.
	String.raw`(?<![\p{L}\p{N}])err_http_(?:${TRANSIENT_STATUS})(?![\p{L}\p{N}])`,
	// (1) The message *is* the code, give or take punctuation.
	String.raw`^\s*(?:${TRANSIENT_STATUS})[^\p{L}\p{N}]*$`,
	// (2) A code that ends the message is handled by {@link transientByWording}, which can rule out a
	// configured value with a bounded prefix window — a variable-length lookbehind cannot do that.
	// (3) Anywhere, with an HTTP context word before the code and no unit after it.
	String.raw`(?<![\p{L}\p{N}_])(?:${HTTP_CONTEXT})(?![\p{L}\p{N}_])[^\p{L}]{0,24}(?:${TRANSIENT_STATUS})(?![\p{L}\p{N}_-])${NOT_A_COUNT}`,
].join("|"), "iu");

/** A status code the message ends on, give or take trailing punctuation. */
const TRAILING_STATUS = new RegExp(String.raw`(?<![\p{L}\p{N}_-])(?:${TRANSIENT_STATUS})(?![\p{L}\p{N}_-])[^\p{L}\p{N}]*$`, "iu");

/** A configured-value noun, used to tell `the limit is 429` from `server returned 503`. */
const VALUE_NOUN_PATTERN = new RegExp([
	// A value noun at the start of a word (`the limit is 429`, `limits: 503`).
	String.raw`(?<![\p{L}\p{N}])(?:${VALUE_NOUN})`,
	// A value noun *inside* an identifier assigned to (`handoffTargetTokens=429`,
	// `maxTokens: 429`). Camel-case and snake-case config keys are the forms this exists for, and the
	// assignment operator is what keeps an ordinary word containing the noun (`unlimited`) out.
	String.raw`[\p{L}][\p{L}\p{N}_]*(?:${VALUE_NOUN})[\p{L}\p{N}_]*\s*[=:]`,
].join("|"), "iu");

/** How far before a trailing code a value noun still explains it. */
const VALUE_NOUN_LOOKBEHIND = 24;

/**
 * Retry advice, and the *prohibition* that cancels it. Both are matched in prose rather than inside
 * {@link TRANSIENT_ERROR_PATTERN} because the distinguishing feature is grammatical, not lexical:
 * `do not retry` forbids the retry, while `don't worry, please retry` and `this is not fatal, please
 * retry` merely contain a negation. A prohibition is a negation word **in the same clause** as a
 * retry verb, so a comma or a sentence end between them breaks the match.
 */
const RETRY_ADVICE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:try again|please retry|safe to retry)`, "iu");

const RETRY_PROHIBITION = new RegExp(
	String.raw`(?:never|not|no need to|unsafe|avoid|don'?t|cannot|can'?t|won'?t)\b[^.;!?,]{0,12}(?:retry|retrying|try again)`,
	"iu",
);

/**
 * Whether a message is transient by wording alone. Split out of {@link handoffFailureIsTransient} so
 * the trailing-code rule can consult a bounded prefix window, which a lookbehind cannot express.
 */
function transientByWording(message: string): boolean {
	const trailing = TRAILING_STATUS.exec(message);
	if (trailing) {
		// `server returned 503` and `the limit is 429` end in the same shape, so the code only counts
		// as a status when no configured-value noun stands just before it.
		const prefix = message.slice(Math.max(0, trailing.index - VALUE_NOUN_LOOKBEHIND), trailing.index);
		if (!VALUE_NOUN_PATTERN.test(prefix)) return true;
	}
	if (RETRY_ADVICE.test(message) && !RETRY_PROHIBITION.test(message)) return true;
	return TRANSIENT_ERROR_PATTERN.test(message);
}

/** The first five `.code`s at and below the top level — a `fetch` failure hides its real reason there. */
function errorCodesDeep(error: unknown): string[] {
	const codes: string[] = [];
	for (let node: unknown = error, depth = 0; depth <= 4 && node !== null && typeof node === "object"; depth += 1) {
		const code = (node as { code?: unknown }).code;
		if (typeof code === "string") codes.push(code);
		node = (node as { cause?: unknown }).cause;
	}
	return codes;
}

/**
 * The messages from one level below the top down five links. The caller adds the top-level
 * message separately, so six messages are considered in total while {@link errorCodesDeep}
 * reads five codes (the top level included) — the asymmetry is deliberate, not an oversight.
 */
function errorMessagesDeep(error: unknown): string[] {
	const messages: string[] = [];
	for (let node: unknown = error, depth = 0; depth <= 4 && node !== null && typeof node === "object"; depth += 1) {
		if (typeof (node as { message?: unknown }).message === "string") messages.push((node as { message: string }).message);
		node = (node as { cause?: unknown }).cause;
	}
	return messages;
}

/**
 * A known transient code spelled out in the text rather than set on `.code` — libraries commonly
 * surface `ETIMEDOUT`/`ECONNRESET` as the message. The codes are distinctive identifiers, so a
 * whole-token match is safe; it cannot fire on `requestTimeout` or `temporary`.
 */
const TRANSIENT_CODE_MENTION = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${[...TRANSIENT_ERROR_CODES].join("|")})(?![\p{L}\p{N}_])`, "iu");

/**
 * Whether a handoff failure is worth retrying. Only the shapes recognized below qualify; anything
 * else is terminal. The pattern is a heuristic over wording the runtime controls, so it is biased
 * toward "terminal" — an unrecognized transient is reported as a plain failure rather than promised
 * a retry — but it cannot be exact: an unrecognized *terminal* wording that happens to match still
 * prints the retry advice.
 * @param error - the error a handoff attempt threw.
 * @returns `true` for a cause a plain retry can clear.
 */
export function handoffFailureIsTransient(error: unknown): boolean {
	if (error instanceof HandoffTransient) return true;
	if (error instanceof HandoffDeferred) return true;
	if (!(error instanceof Error)) return false;
	// A `fetch` rejection carries its real reason on `.cause` (`UND_ERR_SOCKET`, `ECONNREFUSED`, …)
	// and leaves `.code` unset, so looking only at the top level calls a dropped connection terminal.
	// A transient code *anywhere in the first five links* wins: an outer wrapper code
	// (`ERR_MODEL_NOT_FOUND`) must not mask a nested `ECONNRESET` — the nested one is the real cause.
	const codes = errorCodesDeep(error);
	if (codes.some((code) => TRANSIENT_ERROR_CODES.has(code))) return true;
	// `AbortError` by name covers runtimes that do not set `code`.
	if (error.name === "AbortError" || error.name === "TimeoutError") return true;
	const messages = [error.message, ...errorMessagesDeep((error as { cause?: unknown }).cause)];
	// A non-Error cause still carries useful text (e.g. a rejected `{ code: "ECONNRESET" }`).
	const rawCause = (error as { cause?: unknown }).cause;
	if (typeof rawCause === "string") messages.push(rawCause);
	return messages.some((message) => transientByWording(message) || TRANSIENT_CODE_MENTION.test(message))
		|| codes.some((code) => TRANSIENT_ERROR_PATTERN.test(code));
}

/**
 * Wrap a handoff failure with the retryable/terminal verdict, preserving the original cause.
 * Used where the failure is caught and re-thrown so the verdict survives to the receipt.
 *
 * A {@link HandoffDeferred} is passed through **unchanged**: the automatic path tests
 * `instanceof HandoffDeferred` to release its pressure throttle and to archive the abandoned child,
 * and re-wrapping it would silently turn the 2026-09-17 double-write guard into an ordinary error.
 */
export function transientIfRetryable(error: unknown): Error {
	if (error instanceof HandoffDeferred || error instanceof HandoffTransient) return error;
	const message = error instanceof Error ? error.message : String(error);
	if (handoffFailureIsTransient(error)) return new HandoffTransient(message, { cause: error });
	return error instanceof Error ? error : new Error(message);
}
