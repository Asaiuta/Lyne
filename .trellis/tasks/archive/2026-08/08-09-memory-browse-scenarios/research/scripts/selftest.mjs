import { connect } from "./cdp-drive.mjs";
const c = await connect();
console.log("connected");
const r = await c.evalJs("document.title");
console.log("title:", JSON.stringify(r));
await c.close; 
process.exit(0);
