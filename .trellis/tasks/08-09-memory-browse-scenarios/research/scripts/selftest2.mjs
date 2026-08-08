import { connect } from "./cdp-drive.mjs";
const c = await connect();
console.log("connected");
const r = await c.evalJs(`(() => ({ title: document.title, body: document.body.innerText.slice(0, 800) }))()`);
console.log(JSON.stringify(r, null, 1));
process.exit(0);
