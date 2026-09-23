/**
 * Project-context plugin, browser half.
 *
 * Registers the `project-context` settings card into the Plugin configuration
 * section (Settings → Plugins). The host plugins read the same namespace.
 */

import type { Context as ClientContext } from "@deepseek-ai/cordis";
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from "@deepseek-ai/dsh-client-locale/client";
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
// Type-only: pulls the slots service Context merge (ctx.slots).
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
// Type-only: pulls the `settings.plugin.item` SlotMap merge.
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import { createSnapshotStore } from "./dsh-store-compat.ts";
// Shared with the host half so the switch logic is unit-testable without a browser.
import { watchHandoffSwitch } from "../src/shared/handoff-watch.ts";
import { en, zh, type SettingsCardKey } from "./locales.ts";
import {
	ProjectContextSettingsCard,
	ProjectContextSettingsCardController,
	type ProjectContextSettings,
} from "./settings-card.tsx";

/** Dictionary namespace and settings namespace owned by this plugin. */
const NS = "project-context";

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface LocaleNamespaceMap {
		/** project-context settings-card copy. */
		"project-context": SettingsCardKey;
	}
}

/**
 * Services required by this plugin.
 *
 * `settingsScope` is deliberately NOT in this static list: dsh 0.1.7-alpha.1
 * removed the client-side settings-scope service (settings moved to per-profile
 * plugin Config driven by `ctx.configForms`), and a static dependency on a
 * missing service keeps the whole client entry pending — the web boot then
 * reports "N entries did not activate", which the desktop turns into a fatal
 * crash. The settings card is attached through an optional `ctx.inject`
 * instead, so a core without the service degrades to "no settings card"
 * rather than blocking activation.
 */
export const inject = ["slots", "locale"];

/**
 * Plugin body: register the card under the `project-context` settings namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "project-context: dictionaries");

	// Optional: the settings card is the only consumer of the (pre-0.1.7)
	// settings-scope service; everything else works without it.
	ctx.inject(["settingsScope"], (settingsCtx) => {
		const scope = settingsCtx.settingsScope.bind<ProjectContextSettings>({ namespace: NS });
		const controller = new ProjectContextSettingsCardController(scope, createSnapshotStore);
		// The controller subscribes to the settings scope in its constructor; that
		// subscription belongs to this fiber, so a reload must not leak it.
		settingsCtx.effect(() => () => controller.dispose(), "project-context: settings card");

		settingsCtx.slots.inject("settings.plugin.item", () =>
			settingsCtx.slots.register(
				{
					name: "settings.plugin.item",
					key: NS,
					locale: NS,
					inject: () => controller.inject(),
				},
				ProjectContextSettingsCard,
			),
		);
	});

	// Handoff switch: open the fresh handoff session when the current session
	// receives a live marker. Waits for the client sessions service; degrades to
	// no switch when that service is absent from the composition.
	ctx.inject(["sessions"], (sessionsCtx) => {
		sessionsCtx.effect(() => watchHandoffSwitch(sessionsCtx), "project-context: handoff switch");
	});
}
