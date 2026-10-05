/**
 * Reading a session as rendered conversation sections — the shape the consolidation prompt,
 * the handoff split and the language detector all consume — plus the input fitting that keeps
 * a consolidation request inside its budget.
 */
import { type Session } from "@deepseek-ai/dsh-session";
/**
 * What the pass sends instead of the stored artifacts, plus the budget it asks for.
 *
 * The clip is reported per artifact as a character count, not just a boolean: the receipt has to say
 * which of the two was shortened and by how much, and a bare flag cannot distinguish a pass that hid
 * a few characters of memory from one that hid a whole context. `clipped` stays the derived "either
 * one was shortened" answer the call sites already read.
 */
export type MemoryInput = {
    text: string;
    contextText: string;
    maxTokens: number;
    /** True when either stored artifact had to be shortened to fit the output budget. */
    clipped: boolean;
    /** Characters of the stored memory the model was not shown (head-and-tail clip); 0 when whole. */
    memoryHiddenChars: number;
    /** Characters of the stored context the model was not shown; 0 when whole. */
    contextHiddenChars: number;
};
/**
 * Match the output budget to everything the reply must re-emit. A large memory is what truncated
 * replies (and the poisoned files they used to leave) came from: the cap is raised up to the
 * model's own limit, and when even that cannot hold memory plus context, both are shortened
 * head-and-tail so the reply can still come back complete and parseable. Each artifact is budgeted
 * by its own token rate, so a large cheap context cannot let a small dense memory pass the cap.
 */
export declare function fitMemoryInput(memory: string, context: string, configuredMaxTokens: number, model: {
    maxTokens?: number;
    reasoning?: boolean;
}, ceilingTokens?: number, extraHeadroomTokens?: number): MemoryInput;
/**
 * One rendered conversation section, with the unclipped user text kept alongside it.
 *
 * The handoff pass must recognize a previous continuation prompt in the *raw* text — the render
 * clips a user message to 4000 characters, which is shorter than a real continuation — so both
 * callers share this one pass instead of each re-implementing the rendering and drifting apart.
 */
export interface ConversationSection {
    /** The rendered `## user` / `## assistant` / `## tool result` block. */
    readonly rendered: string;
    /** Unclipped text, present only for user-role messages. */
    readonly userText?: string;
    /** dsh source kind of that user message. */
    readonly sourceKind?: string;
}
/** Compact section-per-message rendering of the derived conversation. */
export declare function conversationMessageSections(session: Session): ConversationSection[];
/** Compact, budgeted rendering of the derived conversation for the learn prompt. */
export declare function conversationText(session: Session): string;
/** Human turns only: injected user-role context and handoff banners do not count. */
export declare function userTurnCount(session: Session): number;
/** First message a person wrote; injected context and handoff banners are skipped. */
export declare function firstUserText(session: Session): string;
