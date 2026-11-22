export function onDispose(ctx, cleanup, label) {
    ctx.effect(() => cleanup, label);
}
