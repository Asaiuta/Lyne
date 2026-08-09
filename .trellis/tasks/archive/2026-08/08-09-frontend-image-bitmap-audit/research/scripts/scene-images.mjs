// scene-images.mjs — per-route image/bitmap memory audit
// Scenes: start → library-list → library-albums-grid → discover → settings (no-image baseline)
// Emits research/data/image-timeline.jsonl
import { execSync } from "node:child_process";
async function clickAt(ctx, label, partial = false) {
  const { evalJs, send } = ctx;
  const geo = await evalJs(`(() => {
    const want = ${JSON.stringify(label)};
    const el = [...document.querySelectorAll("li, div, span, button, a")].find(n => {
      const t = (n.innerText || "").trim();
      if (!t) return false;
      return ${partial} ? t.startsWith(want) : t === want;
    });
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, ok: true };
  })()`);
  if (!geo || !geo.ok) return false;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: geo.x, y: geo.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: geo.x, y: geo.y, button: "left", clickCount: 1 });
  return true;
}

const sleepms = (ms) => new Promise((r) => setTimeout(r, ms));

function webviewProcs() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \\"Name='msedgewebview2.exe'\\"; foreach ($x in $p) { $t='browser'; if ($x.CommandLine -match '--type=(\\S+)') { $t=$matches[1] }; $q=Get-Process -Id $x.ProcessId -ErrorAction SilentlyContinue; if ($q) { Write-Output ($t+'|'+[math]::Round($q.WorkingSet64/1MB,1)+'|'+[math]::Round($q.PrivateMemorySize64/1MB,1)) } }"`,
      { encoding: "utf8" }
    );
    return out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
      const [t, ws, pb] = l.split("|");
      return { t, ws: +ws, pb: +pb };
    });
  } catch {
    return [];
  }
}

export async function run(ctx) {
  const { evalJs, send, log } = ctx;
  const fsp = await import("node:fs/promises");
  const rec = [];

  const stats = async (phase, extra = {}) => {
    const dom = await evalJs(`new Promise((resolve) => {
      const imgs = [...document.images];
      const texBytes = imgs.reduce((a, i) => a + ((i.complete && i.naturalWidth) ? i.naturalWidth * i.naturalHeight * 4 : 0), 0);
      const resourceEntries = performance.getEntriesByType("resource").filter(r => r.initiatorType === "img");
      resolve({
        nodes: document.querySelectorAll("*").length,
        imgs: imgs.length,
        decodedTexBytes: texBytes,
        loadedImgs: imgs.filter(i => i.complete && i.naturalWidth).length,
        resImgs: resourceEntries.length,
        imgBytes: resourceEntries.reduce((a, r) => a + r.transferSize, 0)
      });
    })`);
    const heap = await evalJs(`(performance.memory ? performance.memory.usedJSHeapSize : 0)`);
    const wv = webviewProcs();
    const renderers = wv.filter((p) => p.t === "renderer");
    const recObj = {
      phase,
      nodes: dom.nodes, imgs: dom.imgs, loadedImgs: dom.loadedImgs,
      decodedPx: dom.decodedTexBytes / 4,
      imgTexMB: +(dom.decodedTexBytes / 1048576).toFixed(1),
      resImgs: dom.resImgs, imgBytesMB: +(dom.imgBytes / 1048576).toFixed(2),
      heapMB: +(heap / 1048576).toFixed(2),
      rendererWSMB: renderers.length ? +renderers.reduce((a, p) => a + p.ws, 0).toFixed(1) : 0,
      rendererPBMB: renderers.length ? +renderers.reduce((a, p) => a + p.pb, 0).toFixed(1) : 0,
      wvProcs: wv.length,
      t: Date.now(), ...extra,
    };
    rec.push(recObj);
    log("IMG", phase,
      "nodes=" + dom.nodes, "imgs=" + dom.imgs + "/" + dom.loadedImgs,
      "tex=" + recObj.imgTexMB + "MB", "imgBytes=" + recObj.imgBytesMB + "MB",
      "heap=" + recObj.heapMB + "MB",
      "rendererWS=" + recObj.rendererWSMB + "MB / PB=" + recObj.rendererPBMB + "MB",
      "wv=" + wv.length);
  };

  await send("Performance.enable").catch(() => {});
  await sleepms(6000); // settle initial route
  await stats("start");

  // S1: library list view (thumbnail rows)
  await clickAt(ctx, "本地音乐");
  await sleepms(2500);
  await clickAt(ctx, "专辑", true);
  await sleepms(1500);
  await evalJs(`(() => { const e = [...document.querySelectorAll('*')].find(x => x.scrollHeight > x.clientHeight + 50 && x.clientHeight > 80); if (e) { e.scrollTop = Math.floor(e.scrollHeight * 0.5); e.dispatchEvent(new Event('scroll', { bubbles: true })); } return !!e; })()`);
  await sleepms(2500);
  await stats("library-list");

  // S2: library albums grid (cover wall)
  await clickAt(ctx, "专辑", true);
  await sleepms(2500);
  await evalJs(`(() => { const e = [...document.querySelectorAll('*')].find(x => x.scrollHeight > x.clientHeight + 80 && x.clientHeight > 80); if (e) { e.scrollTop = Math.min(e.scrollTop + e.clientHeight * 3, e.scrollHeight); e.dispatchEvent(new Event('scroll', { bubbles: true })); } return true; })()`);
  await sleepms(4000);
  await stats("library-albums-grid");

  // S3: discover (online grids)
  await clickAt(ctx, "发现音乐");
  await sleepms(3500);
  await stats("discover");

  // S4: settings (no-image baseline)
  await clickAt(ctx, "设置");
  await sleepms(2500);
  await stats("settings-baseline");

  await fsp.writeFile("D:/AI/AudioPlayer/.trellis/tasks/08-09-frontend-image-bitmap-audit/research/data/image-timeline.jsonl", rec.map((r) => JSON.stringify(r)).join("\n"));
  log("SAVED", rec.length, "records");
}