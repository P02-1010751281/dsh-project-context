// Resolve the plugin's @deepseek-ai peer imports from the dsh store the running host
// loaded, so the installed plugin's imports bind to the same runtime packages the host
// supplies in-process. The installed copy under ~/.dsh/profiles has no @deepseek-ai
// packages of its own; the status path never calls into these peers, so this only
// satisfies the side-effect imports.
import { pathToFileURL } from "node:url";

const ANCHORS = [
  "/nix/store/xbbn6inj2q64j88gsmjrljqkh1m572sy-dsh-desktop-0.2.2-rc.3/lib/dsh-desktop/repo/node_modules/",
  "/mnt/Data/Projects/dsh-project-context/node_modules/",
  "/home/user/.dsh/profiles/desktop/node_modules/",
];

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@deepseek-ai/")) return nextResolve(specifier, context);
  let lastError;
  for (const anchor of ANCHORS) {
    try {
      return await nextResolve(specifier, {
        ...context,
        parentURL: pathToFileURL(`${anchor}.probe-anchor.mjs`).href,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
