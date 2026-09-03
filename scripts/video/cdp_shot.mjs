// Screenshot the first page target of a Chrome started with --remote-debugging-port=9222.
//   node cdp_shot.mjs out.png
import { writeFileSync } from 'node:fs';

const list = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const reply = new Promise((res) => { ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) res(m); }; });
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
const m = await reply;
writeFileSync(process.argv[2] || 'shot.png', Buffer.from(m.result.data, 'base64'));
console.log('saved', process.argv[2] || 'shot.png');
ws.close();
