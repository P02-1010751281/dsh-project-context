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

/** Services required by this plugin. */
export const inject = ["slots", "locale", "settingsScope"];

/**
 * Plugin body: register the card under the `project-context` settings namespace.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "project-context: dictionaries");

	const scope = ctx.settingsScope.bind<ProjectContextSettings>({ namespace: NS });
	const controller = new ProjectContextSettingsCardController(scope, createSnapshotStore);
	// The controller subscribes to the settings scope in its constructor; that
	// subscription belongs to this fiber, so a reload must not leak it.
	ctx.effect(() => () => controller.dispose(), "project-context: settings card");

	ctx.slots.inject("settings.plugin.item", () =>
		ctx.slots.register(
			{
				name: "settings.plugin.item",
				key: NS,
				locale: NS,
				inject: () => controller.inject(),
			},
			ProjectContextSettingsCard,
		),
	);

	// Handoff switch: open the fresh handoff session when the current session
	// receives a live marker. Waits for the client sessions service; degrades to
	// no switch when that service is absent from the composition.
	ctx.inject(["sessions"], (sessionsCtx) => {
		sessionsCtx.effect(() => watchHandoffSwitch(sessionsCtx), "project-context: handoff switch");
	});
}
