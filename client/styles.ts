/**
 * Styles for the project-context settings card, injected at factory
 * materialization so the client module system's style bookkeeping owns them.
 * Uses DSH design tokens so the card follows the active theme.
 */

const css = `
.dshPcCard {
  border: 1px solid var(--dsw-alias-border-l2, rgb(127 127 127 / 24%));
  background: var(--dsw-alias-bg-layer-3, transparent);
  border-radius: 14px;
  list-style: none;
  margin-bottom: 10px;
  overflow: hidden;
}
.dshPcHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.dshPcHeader:hover { background: var(--dsw-alias-bg-module-platform, rgb(127 127 127 / 8%)); }
.dshPcHeadText { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dshPcName { font-size: 14px; font-weight: 600; }
.dshPcDescription { font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.dshPcPending {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--dsw-alias-brand-primary, inherit);
  border: 1px solid var(--dsw-alias-brand-primary, currentColor);
}
.dshPcChevron { flex: none; display: inline-flex; transition: transform .18s ease; }
.dshPcChevronOpen { transform: rotate(180deg); }
.dshPcBody { padding: 4px 16px 14px; border-top: 1px solid var(--dsw-alias-border-l2, rgb(127 127 127 / 18%)); }
.dshPcReadOnly { margin: 10px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.dshPcSection { margin-top: 14px; }
.dshPcSectionTitle { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--dsw-alias-label-secondary, inherit); }
.dshPcSectionDescription { margin: 2px 0 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.dshPcGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 14px; }
.dshPcField { display: flex; flex-direction: column; gap: 4px; }
.dshPcFieldHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dshPcLabel { font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.dshPcBadges { display: inline-flex; align-items: center; gap: 6px; }
.dshPcBadge {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--dsw-alias-label-dimmed, inherit);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
}
.dshPcReset {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-brand-primary, inherit);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.dshPcReset:disabled { opacity: .5; cursor: default; }
.dshPcInput, .dshPcSelect {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(127 127 127 / 30%));
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
}
.dshPcInput:focus, .dshPcSelect:focus { outline: none; border-color: var(--dsw-alias-brand-primary, currentColor); }
.dshPcInput:disabled, .dshPcSelect:disabled { opacity: .6; }
.dshPcInputInvalid { border-color: var(--dsw-alias-label-error, #e5484d); }
.dshPcHint { margin: 0; font-size: 11px; color: var(--dsw-alias-label-tertiary, inherit); }
.dshPcInvalid { margin: 0; font-size: 11px; color: var(--dsw-alias-label-error, #e5484d); }
.dshPcFooter { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 16px; }
.dshPcFailed { margin: 0 auto 0 0; font-size: 12px; color: var(--dsw-alias-label-error, #e5484d); }
.dshPcDiscard, .dshPcSave {
  padding: 6px 14px;
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgb(127 127 127 / 30%));
}
.dshPcDiscard { background: transparent; color: var(--dsw-alias-label-secondary, inherit); }
.dshPcSave { background: var(--dsw-alias-brand-primary, #4f7cff); border-color: transparent; color: #fff; }
.dshPcDiscard:disabled, .dshPcSave:disabled { opacity: .5; cursor: default; }
`;

const STYLE_ID = "dsh-project-context-card-styles";

/** Inject the card stylesheet once. */
export function injectStyles(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById(STYLE_ID) !== null) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = css;
	document.head.appendChild(style);
}
