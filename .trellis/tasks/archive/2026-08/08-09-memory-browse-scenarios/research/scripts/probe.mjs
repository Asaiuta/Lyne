export async function run(ctx) {
  console.log("PROBE entered");
  const r = await ctx.evalJs("document.title");
  console.log("PROBE title:", r);
}
