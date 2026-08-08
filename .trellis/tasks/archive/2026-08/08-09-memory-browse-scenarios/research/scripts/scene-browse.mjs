// scene-browse.mjs — three browse/mixed scenes driven via CDP
// Phases: A) library scroll rounds, B) search→detail→back rounds, C) mixed browse+play
// Emits browse-timeline.jsonl: { t, phase, step, nodes, imgs, jsHeapUsedKB }
import { clickByText, waitFor, domStats, heapStats, scrollContainer, fillSearch, pressKey } from "./ui-utils.mjs";

const OUT = "research/data/browse-timeline.jsonl";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(ctx) {
  const { evalJs, send, log } = ctx;
  const line = [];

  const mark = async (phase, step, extra = {}) => {
    const st = await domStats(ctx);
    const hp = await heapStats(ctx);
    const rec = { ts: Date.now(), phase, step, ...st, ...hp, ...extra };
    line.push(rec);
    log("MARK", phase, step, "nodes=" + st.nodes, "heap=" + (hp.jsHeapUsedKB ?? "?") + "KB");
  };

  await send("Performance.enable").catch(() => {});
  await mark("start", 0);

  // ---------- A: local library scroll rounds ----------
  const clickLocal = await clickByText(ctx, "本地音乐");
  log("A0 click 本地音乐 ->", JSON.stringify(clickLocal));
  await sleep(2500);

  // switch to 歌曲 list view inside library (tabs: 歌曲/专辑/歌手 …) — try clicking 歌曲 tab
  const tabHit = await clickByText(ctx, "歌曲", { tag: "div,span,button" });
  await sleep(1500);

  for (let round = 1; round <= 4; round++) {
    // scroll to bottom in steps
    await evalJs(`(() => {
      const root = document.body;
      const els = [root, ...root.querySelectorAll("*")].filter(el =>
        el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 80
      ).sort((a, b) => b.scrollHeight - a.scrollHeight);
      const el = els[0];
      window.__scrollEl = el;
      return el ? el.scrollHeight : 0;
    })()`);
    const sh = await evalJs(`window.__scrollEl ? window.__scrollEl.scrollHeight : 0`);
    const ch = await evalJs(`window.__scrollEl ? window.__scrollEl.clientHeight : 0`);
    log(`A${round} list h=${sh} ch=${ch}`);
    if (!sh) { await mark("library", "round" + round, { skipped: true }); continue; }
    if (sh > ch) {
      let done = false;
      while (!done) {
        await evalJs(`(() => {
          const el = window.__scrollEl;
          const cur = el.scrollTop;
          el.scrollTop = Math.min(cur + Math.floor(el.clientHeight * 0.8), el.scrollHeight);
          el.dispatchEvent(new Event("scroll", { bubbles: true }));
          return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
        })()`).then((reached) => { done = reached; });
        await sleep(350);
      }
    }
    await mark("library", "round" + round + "-bottom");
    await sleep(1200);
    // back to top
    if (sh > 600) {
      await evalJs(`(() => { const el = window.__scrollEl; el.scrollTop = 0; el.dispatchEvent(new Event("scroll", { bubbles: true })); return true; })()`);
    }
    await mark("library", "round" + round + "-top");
    await sleep(800);
  }

  // ---------- B: online search → detail → back rounds ----------
  const searchInputs = await evalJs(`JSON.stringify([...document.querySelectorAll("input")].map(i => ({ ph: i.placeholder, cls: i.className })).slice(0, 6))`);
  log("B inputs:", searchInputs);
  const inputSel = await evalJs(`(() => { const i = [...document.querySelectorAll("input")].find(x => x.placeholder && /搜索/.test(x.placeholder)); return i ? null : null; })()`);
  // focus by placeholder text regardless
  await evalJs(`(() => {
    const i = [...document.querySelectorAll("input")].find(x => x.placeholder && /搜索|搜/.test(x.placeholder));
    window.__searchInput = i ? "input#" + i.id + "." + (i.className || "") : "nothing";
    return !!i;
  })()`);
  const hasSearch = await evalJs(`!!window.__searchInput`);
  console.log("B search input?", hasSearch);

  const keywords = ["周杰伦", "陈奕迅", "钢琴"];
  for (let round = 1; round <= 8; round++) {
    const kw = keywords[round % keywords.length];
    const f = await fillSearch(ctx, "input", kw);
    log(`B${round} fill "${kw}" ok=${f}`);
    await sleep(2200);
    await mark("search", `round${round}-results`);
    // open first result
    const opened = await evalJs(`(() => {
      const cards = [...document.querySelectorAll("[class*=card], [class*=item], li, button, div")].filter(n => /歌单|歌曲/.test(n.innerText || "") && n.innerText.length < 60 && n.querySelector);
      // best-effort: click first clickable with >2 chars text that isn't nav
      const cands = [...document.querySelectorAll("div[class], li, button, td")].filter(n => {
        const t = (n.innerText || "").trim();
        return t && t.length >= 4 && t.length <= 50 && !/歌单|推荐|发现/.test(t.slice(0, 3));
      });
      const el = cands[3] || cands[0];
      if (!el) return false;
      el.dispatchEvent(new (window.MouseEvent || Event)("click", { bubbles: true }));
      return true;
    })()`);
    log(`B${round} open result ok=${opened}`);
    await sleep(2000);
    await mark("B", "round" + round + "-detail");
    // back
    const back = await evalJs(`(() => {
      const fire = (el) => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; };
      const btns = [...document.querySelectorAll("button, [role=button], [class*=back], [class*=Back]")];
      const b = btns.find(n => { const t = (n.innerText || "").trim(); return t === "返回" || /back/i.test(n.className || "") || /返回/.test(n.getAttribute("aria-label") || ""); }) || btns.find(n => /back/i.test(n.className || ""));
      if (b) return fire(b);
      return false;
    })()`);
    log(`B${round} back ok=${back}`);
    await sleep(1800);
    await mark("B", "round" + round + "-back");
    if (round === 4) {
      // go back to discover main to reset route stack occasionally
      await clickByText(ctx, "为我推荐", { tag: "div,span,li,button" });
      await sleep(1500);
    }
  }

  // ---------- C: mixed — open local library and play a track ----------
  await clickByText(ctx, "本地音乐", { partial: true });
  await sleep(2000);
  await clickByText(ctx, "歌曲", {});
  await sleep(1500);
  const played = await evalJs(`(() => {
    const rows = [...document.querySelectorAll("[class*=row], [class*=item], tr, li")].filter(n => n.innerText && n.innerText.trim().length > 6);
    const el = rows.find(n => !/歌单|搜索/.test(n.innerText));
    if (!el) return false;
    // try clicking a play affordance inside the row (svg/button), fallback double-click row
    const btn = el.querySelector("svg") || el.querySelector("button");
    if (btn) btn.dispatchEvent(new (window.MouseEvent || window.Event)("click", { bubbles: true }));
    else { el.click(); el.click(); }
    return true;
  })()`);
  log("C played:", played);
  await sleep(4000);
  await mark("C", "play-1");

  // switch track: play next (double-click another row)
  await evalJs(`(() => {
    const rows = [...document.querySelectorAll("[class*=row], [class*=item], tr, li")].filter(n => n.innerText && n.innerText.trim().length > 1);
    const n = rows[Math.floor(Math.random() * Math.min(rows.length, 30))];
    if (n) { n.click(); n.click(); }
    return !!n;
  })()`);
  await sleep(3000);
  await mark("C", "play-2");
  // pause
  await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(n => n.getAttribute("aria-label") === "暂停" || /pause|暂停/i.test(n.className));
    if (b) { b.click(); return true; }
    return false;
  })()`);
  await sleep(1500);
  await mark("C", "paused");

  // back to library top & settle for 30s to observe GC
  await evalJs(`(() => { const el = window.__scrollEl; if (el) { el.scrollTop = 0; el.dispatchEvent(new Event("scroll", { bubbles: true })); } return true; })()`);
  await sleep(25000);
  await mark("settle", "after-30s-gc");

  console.log("DONE scenes");
}