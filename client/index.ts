/**
 * Project-context plugin, browser half.
 *
 * Registers the `project-context` settings card on the Plugins page, under this bundle's own
 * configuration slot. The host plugins read the same settings namespace.
 */

import type { Context as ClientContext } from "@deepseek-ai/cordis";
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from "@deepseek-ai/dsh-client-locale/client";
// Type-only: pulls the settings-surface Context merge (ctx.configForms).
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
// Type-only: pulls the slots service Context merge (ctx.slots).
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
// Type-only: pulls the `plugins.bundle.config` SlotMap merge declared by the Plugins page.
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import { createSnapshotStore } from "./dsh-store-compat.ts";
// Shared with the host half so the switch logic is unit-testable without a browser.
import { watchHandoffSwitch } from "../src/project-handoff/watch.ts";
import { en, zh, type SettingsCardKey } from "./locales.ts";
import {
	ProjectContextSettingsCard,
	ProjectContextSettingsCardController,
	type ProjectContextSettings,
} from "./settings-card.tsx";

/** Dictionary namespace and settings namespace owned by this plugin. */
const NS = "project-context";

/**
 * The bundle whose Plugins-page row owns this card. The page dispatches `plugins.bundle.config` by the
 * bundle's package name, which is how every community bundle with a settings surface is wired
 * (`dsh-context`, `dsh-client-auto-continue`, `dshmarket`, `@liustack/modlens`): dsh 0.1.7-alpha.1
 * renamed the old `settings.plugin.item` list into this bundle-scoped slot plus the official-only
 * `plugins.item`, and `slots.register` throws for a slot nobody declared — so the lookup waits.
 */
const CARD_SLOT = "plugins.bundle.config";

/** Key the Plugins page dispatches for this bundle's own page. */
const BUNDLE_KEY = "dsh-project-context";

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface LocaleNamespaceMap {
		/** project-context settings-card copy. */
		"project-context": SettingsCardKey;
	}
}

/**
 * Services required by this plugin.
 *
 * Neither `settingsScope` nor `configForms` belongs in this static list: dsh 0.1.7-alpha.1 replaced
 * the client-side settings-scope service with `configForms` (per-profile plugin Config), and a static
 * dependency on a service the composition does not provide keeps the whole client entry pending — the
 * web boot then reports "N entries did not activate", which the desktop turns into a fatal crash. The
 * settings card resolves the service through an optional `ctx.inject` instead, so a core without it
 * degrades to "no settings card" rather than blocking activation.
 */
export const inject = ["slots", "locale"];

/**
 * Plugin body: register the card under the `project-context` settings namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "project-context: dictionaries");

	// The settings card. Both of its harness dependencies are optional: the `configForms` service, and
	// the `project-context` entry the Host must serve. `whileServed` keeps the card off the page until
	// that entry is in the Host's describe mirror — which only happens when the entry's exported
	// `Config` has volatile fields (`SettingsForms.describe` drops a schema `volatileForm` cannot strip
	// to live fields) — and the slot lookup waits for the Plugins page to declare this slot.
	ctx.inject(["configForms"], (formsCtx) => {
		const controller = new ProjectContextSettingsCardController(
			formsCtx.configForms.get<ProjectContextSettings>(NS),
			createSnapshotStore,
		);
		// The controller subscribes to the form in its constructor; that
		// subscription belongs to this fiber, so a reload must not leak it.
		formsCtx.effect(() => () => controller.dispose(), "project-context: settings card");

		formsCtx.effect(
			() =>
				formsCtx.configForms.whileServed([NS], () =>
					formsCtx.slots.inject(CARD_SLOT, () =>
						formsCtx.slots.register(
							{
								name: CARD_SLOT,
								key: BUNDLE_KEY,
								locale: NS,
								inject: () => controller.inject(),
							},
							ProjectContextSettingsCard,
						),
					),
				),
			"project-context: settings page",
		);
	});

	// Handoff switch: open the fresh handoff session when the current session
	// receives a live marker. Waits for the client sessions service; degrades to
	// no switch when that service is absent from the composition.
	ctx.inject(["sessions"], (sessionsCtx) => {
		sessionsCtx.effect(() => watchHandoffSwitch(sessionsCtx), "project-context: handoff switch");
	});
}
