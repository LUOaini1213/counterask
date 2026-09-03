// Minimal Chrome DevTools Protocol client: evaluate an expression in the
// first page target of a Chrome started with --remote-debugging-port=9222.
//
//   node cdp.mjs "<js expression>"            (REPL mode, top-level await works)
//   node cdp.mjs --navigate <url>
//   node cdp.mjs --clear-cache                 (Network.clearBrowserCache)
//   node cdp.mjs --click "<css selector>"
//
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.CDP_PORT || 9222;
const args = process.argv.slice(2);

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://')) ?? list[0];
  if (!page) throw new Error('no page target');
  return page;
}

async function session() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { page, ws, send };
}

const { ws, send } = await session();
try {
  if (args[0] === '--navigate') {
    await send('Page.enable');
    await send('Page.navigate', { url: args[1] });
    await sleep(2500);
    console.log(JSON.stringify({ navigated: args[1] }));
  } else if (args[0] === '--clear-cache') {
    await send('Network.enable');
    const r = await send('Network.clearBrowserCache');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    console.log(JSON.stringify({ cleared: !r.error, cacheDisabled: true }));
  } else if (args[0] === '--click') {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(args[1])}); if (!el) return 'not found'; el.click(); return 'clicked'; })()`,
      returnByValue: true,
    });
    console.log(JSON.stringify(r.result?.result?.value ?? r));
  } else {
    const r = await send('Runtime.evaluate', {
      expression: args.join(' '),
      awaitPromise: true,
      returnByValue: true,
      replMode: true,
    });
    if (r.result?.exceptionDetails) console.log('EXCEPTION', JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails, null, 0));
    else console.log(JSON.stringify(r.result?.result?.value, null, 1));
  }
} finally {
  ws.close();
}
