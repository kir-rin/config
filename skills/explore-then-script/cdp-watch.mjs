// 떠 있는 브라우저(CDP)에 오래 붙어 있으면서 4xx/5xx 응답·콘솔 에러·예외를 한 줄씩 낸다(Monitor 용).
// 사용: node cdp-watch.mjs <ws://…/devtools/browser/…>   — 주소·토큰 같은 쿼리는 지운다.
const ws = new WebSocket(process.argv[2]);
let n = 0; const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++n, method, params, ...(sessionId ? { sessionId } : {}) }));
const clean = (u) => String(u).split('?')[0];
const t = () => new Date().toTimeString().slice(0, 8);
const out = (s) => console.log(`${t()} ${s}`);
const reqs = new Map(); // requestId -> {url, method}
ws.onopen = () => { send('Target.setDiscoverTargets', { discover: true }); send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); };
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data), sid = m.sessionId;
  if (m.method === 'Target.targetCreated' && ['page', 'iframe'].includes(m.params.targetInfo.type)) send('Target.attachToTarget', { targetId: m.params.targetInfo.targetId, flatten: true });
  if (m.method === 'Target.attachedToTarget') {
    const s = m.params.sessionId;
    send('Network.enable', {}, s); send('Runtime.enable', {}, s); send('Log.enable', {}, s);
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s);
    send('Runtime.runIfWaitingForDebugger', {}, s);
  }
  if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, { url: m.params.request.url, method: m.params.request.method, body: m.params.request.postData });
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.status >= 400 && !/favicon|\.map$/.test(r.url)) {
      const q = reqs.get(m.params.requestId) || {};
      let tool = ''; try { const b = JSON.parse(q.body || '{}'); tool = b.tool || b.name || b.params?.name || ''; } catch {}
      out(`[http ${r.status}] ${q.method || ''} ${clean(r.url)}${tool ? ` tool=${tool}` : ''}`);
      send('Network.getResponseBody', { requestId: m.params.requestId }, sid);
      reqs.set(m.params.requestId + ':want', true);
    }
  }
  if (m.result && 'body' in (m.result || {})) { const b = String(m.result.body).replace(/https?:\/\/\S+/g, (u) => clean(u)).slice(0, 300); out(`  body: ${b}`); }
  if (m.method === 'Runtime.exceptionThrown') out(`[exception] ${(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 300)}`);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) out(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '')) out(`[log] ${m.params.entry.text.slice(0, 300)}`);
};
ws.onclose = () => { out('[watch] 브라우저 연결이 끊겼어요'); process.exit(1); };
ws.onerror = (e) => { out(`[watch] 연결 오류 ${e.message || ''}`); };
