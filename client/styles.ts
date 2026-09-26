/**
 * The card's own layout, injected at factory materialization so the client module system's style
 * bookkeeping owns it.
 *
 * **Geometry only.** No declaration here names a colour, a background, a border or any other paint:
 * every pixel the card shows comes from the platform's components (`SettingsForm`,
 * `SettingsValueField`, `Switch`, `Pill`, `Tag`, `Button`), which carry the theme tokens themselves.
 * That is what makes the theme un-representable here — a literal colour next to a themed fill is
 * exactly the defect this sheet used to carry (a white label on the dark theme's near-white fill).
 * `test/client-styles.test.mjs` asserts the invariant.
 */

const css = `
.dshPcSection { margin-top: 18px; }
.dshPcSection:first-child { margin-top: 4px; }
.dshPcSectionTitle {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.dshPcSectionDescription { margin: 2px 0 6px; font-size: 12px; }
.dshPcRow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 10px 0; }
.dshPcRowHead { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
.dshPcRowLabel { font-size: 13px; font-weight: 500; }
.dshPcRowControl { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.dshPcRowText { flex: 1 1 100%; min-width: 0; margin: 0; font-size: 12px; }
.dshPcPills { display: inline-flex; align-items: center; gap: 6px; }
`;

const STYLE_ID = "dsh-project-context-card-styles";

/** Inject the card's layout sheet once. */
export function injectStyles(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById(STYLE_ID) !== null) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = css;
	document.head.appendChild(style);
}
