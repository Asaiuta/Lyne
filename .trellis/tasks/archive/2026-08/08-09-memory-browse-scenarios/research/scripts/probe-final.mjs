import { domStats, heapStats } from "./ui-utils.mjs";
export async function run(ctx) {
  await ctx.send("Performance.enable").catch(() => {});
  const d = await domStats(ctx);
  const h = await heapStats(ctx);
  const txt = await ctx.evalJs("document.body.innerText.slice(0, 200)");
  console.log("FINAL nodes=" + d.nodes + " imgs=" + d.imgs + " heapUsedKB=" + h.jsHeapUsedKB + " heapTotalKB=" + h.jsHeapTotalKB + " | " + txt.replace(/\n/g, " "));
}
