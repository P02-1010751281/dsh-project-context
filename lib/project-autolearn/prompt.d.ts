/**
 * The autolearn prompts: the shared rules, the forward pass, and the backtrack pass.
 */
/**
 * The first look: memory, context, the index and the inventory. It carries **no** learned skill body
 * — a learned name becomes reusable only after the model asks for that body with `inspect_skill`,
 * which the follow-up attaches — so the prompt no longer grows with the learned population and the
 * skills past a character budget stop being silently overwritable.
 */
export declare function basePrompt(projectRoot: string, memoryText: string, contextText: string, indexText: string, skillsText: string): string;
/**
 * The follow-up: the material the first look asked for, and it is the only round that can show a
 * learned body. The session-log block and the untrusted-data warning appear only when logs are
 * actually attached, so a follow-up that carries bodies alone never claims to carry transcripts.
 */
export declare function backtrackPrompt(projectRoot: string, memoryText: string, skillsText: string, extracts: string, learnedText?: string, notShown?: readonly string[]): string;
