// discovery: dump visible nav + main structure
export async function run({ evalJs, log }) {
  const info = await evalJs(`(() => {
    const txt = (el) => (el ? el.innerText.trim().slice(0, 200) : null);
    const body = document.body.innerText;
    const buttons = [...document.querySelectorAll("button,[role=tab],a,li")].map(b => (b.innerText||"").trim()).filter(t => t && t.length < 30);
    const scrollables = [...document.querySelectorAll("*")].filter(el => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 100).slice(0, 6).map(el => ({
      cls: el.className, tag: el.tagName, ch: el.clientHeight, sh: el.scrollHeight
    }));
    return { title: document.title, url: location.href, body: body.slice(0, 1500), buttons: [...new Set(buttons)].slice(0, 60), scrollables };
  })()`);
  console.log(JSON.stringify(info, null, 2));
}
