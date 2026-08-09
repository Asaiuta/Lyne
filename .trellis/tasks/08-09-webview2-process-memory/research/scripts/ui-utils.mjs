// ui-utils.mjs — DOM helpers for driving the Lyne app via CDP
export async function clickByText(ctx, label, { tag = "*", partial = false } = {}) {
  const expr = `(() => {
    const want = ${JSON.stringify(label)};
    const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})];
    const el = nodes.find(n => {
      const t = (n.innerText || "").trim();
      return t === want || (${partial} && t.startsWith(want));
    });
    if (!el) return { ok: false };
    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true, tag: el.tagName, text: (el.innerText || "").trim().slice(0, 40) };
  })()`;
  return ctx.evalJs(expr);
}

export async function waitFor(ctx, jsExpr, timeoutMs = 8000, interval = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ctx.evalJs(jsExpr)) return true;
    await ctx.sleep(interval);
  }
  return false;
}

export async function domStats(ctx) {
  return await ctx.evalJs(`(() => {
    const all = document.getElementsByTagName("*");
    let imgs = 0, notes = 0;
    for (let i = 0; i < all.length; i++) {
      const n = all[i];
      if (n.tagName === "IMG") imgs++;
      if (n.tagName === "svg" || n.tagName === "path" || n.tagName === "circle") notes++;
    }
    return { nodes: all.length, imgs, svgs: notes };
  })()`);
}

export async function heapStats(ctx) {
  try {
    const r = await ctx.send("Performance.getMetrics");
    const m = {};
    for (const kv of r.metrics) m[kv.name] = kv.value;
    return { jsHeapUsedKB: Math.round(m.JSHeapUsedSize / 1024), jsHeapTotalKB: Math.round(m.JSHeapTotalSize / 1024) };
  } catch {
    return { jsHeapUsedKB: null, jsHeapTotalKB: null };
  }
}

// scroll the tallest scrollable container inside a root selector
export async function scrollContainer(ctx, rootSel, targetTop) {
  return await ctx.evalJs(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSel)}) || document.body;
    const els = [root, ...root.querySelectorAll("*")].filter(el =>
      el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 80
    );
    if (!els.length) return false;
    const el = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    el.scrollTop = ${JSON.stringify(targetTop)};
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    return true;
  })()`);
}

export async function fillSearch(ctx, inputSel, text) {
  const focused = await ctx.evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(inputSel)});
    if (!el) return false;
    el.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!focused) return false;
  await ctx.send("Input.insertText", { text });
  await ctx.evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(inputSel)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await ctx.sleep(300);
  await ctx.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await ctx.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  return true;
}

export async function pressKey(ctx, key) {
  await ctx.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 9 });
  await ctx.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 9 });
}