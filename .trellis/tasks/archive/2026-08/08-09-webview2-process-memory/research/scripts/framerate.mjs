export async function run(ctx) {
  await ctx.send("Page.enable").catch(() => {});
  await ctx.send("Runtime.enable").catch(() => {});
  const expr = `
    new Promise((resolve) => {
      const t0 = performance.now();
      let frames = 0, total = 0, last = t0;
      function step() {
        const t = performance.now();
        if (frames > 0) total += t - last;
        last = t; frames++;
        window.scrollBy(0, 2);
        if (t - t0 < 3000) requestAnimationFrame(step);
        else resolve({ frames, avgFrameMs: total / Math.max(1, frames - 1), probeMs: t - t0 });
      }
      requestAnimationFrame(step);
    })`;
  const r = await ctx.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const v = r.result && r.result.value;
  console.log("FPS_PROBE " + JSON.stringify(v));
}
