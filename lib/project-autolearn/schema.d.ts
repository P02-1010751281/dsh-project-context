/**
 * The `record_skill` tool schema.
 *
 * The text reply shape allowed `skill: null`, which cannot be expressed in a strict JSON schema: an
 * object member would be wrapped into `anyOf: [<object>, {type: "null"}]`, and object unions are
 * rejected. The tool shape is therefore always an object whose empty `name` carries "nothing to
 * propose", so every property is required and no `anyOf` is needed. The text fallback keeps the
 * nullable `skill` member it has always had.
 *
 * Ported from pi's `extensions/project-context/autolearn/schema.ts`, keeping this repo's
 * `need_sessions` field name (pi renamed it to `inspect` in the same change; the rename is not the
 * port, and the existing prompt, parser and tests already use `need_sessions`).
 */
import { type PluginTool } from "../shared/model-call.js";
export declare const RECORD_SKILL_TOOL: PluginTool;
