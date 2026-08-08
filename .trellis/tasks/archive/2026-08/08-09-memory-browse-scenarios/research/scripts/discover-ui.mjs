// discovery: dump inner nav text and scrollable containers
export async function run({ evalJs, log }) {
  const info = await evalJs(`(() => {
    const body = document.body.innerText;
    const buttons = [...document.querySelectorAll("button,[role=button],a,li")].map(n => (n.innerText||"").trim()).filter(t => t && t.length < 30);
    const scrollables = [...document.querySelectorAll("*")].filter(el => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 100).slice(0, 8).map(el => ({
      tag: el.tagName, cls: String(el.className).slice(0, 90), ch: el.clientHeight, sh: el.scrollHeight
    }));
    return { title: document.title, url: location.href, body: body.slice(0, 1600), buttons: [...new Set(buttons)].slice(0, 60), scrollables };
  })()`);
  console.log(JSON.stringify(info, null, 1));
}