import './_sealed/argon2.js';
import { decryptEnvelope, parsePackage, MAX_BUNDLE } from './_sealed/crypto.js';
const BASE = __BASE_JSON__;
const BUILD = __BUILD_JSON__;
const SPA = __SPA_JSON__;
let files = null;
let busy = false;
let generation = 0;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex', 'X-Content-Type-Options': 'nosniff' };
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
function wipe() {
  generation++;
  if (files) for (const file of files.values()) file.data.fill(0);
  files = null;
}
self.addEventListener('message', event => {
  const port = event.ports[0];
  const source = event.source;
  if (!port || !source?.url) return;
  const url = new URL(source.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (event.data?.type === 'lock') {
    wipe();
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      await Promise.allSettled(clients.filter(c => new URL(c.url).pathname.startsWith(BASE)).map(c => c.navigate(BASE + '_sealed/index.html')));
      port.postMessage({ ok: true });
    })());
    return;
  }
  if (event.data?.type !== 'unlock' || busy || typeof event.data.password !== 'string' || event.data.password.length > 1024) {
    port.postMessage({ ok: false }); return;
  }
  busy = true;
  const attempt = generation;
  event.waitUntil((async () => {
    let bytes;
    try {
      const res = await fetch(BASE + '_sealed/protected.bundle', { cache: 'no-store' });
      if (!res.ok) throw Error('Bundle unavailable');
      // Bound the download as well as the parsed/decrypted data.
      const reader = res.body.getReader();
      const parts = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_BUNDLE * 1.4 + 8192) { await reader.cancel(); throw Error('Bundle too large'); }
        parts.push(value);
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) { body.set(part, offset); offset += part.length; }
      const envelope = JSON.parse(new TextDecoder().decode(body));
      if (envelope.id !== BUILD || envelope.base !== BASE || envelope.spa !== SPA) throw Error('Deployment changed');
      bytes = await decryptEnvelope(envelope, event.data.password, self.hashwasm.argon2id);
      event.data.password = '';
      const next = parsePackage(bytes);
      if (attempt !== generation) throw Error('Locked during unlock');
      wipe();
      files = next;
      port.postMessage({ ok: true });
    } catch {
      port.postMessage({ ok: false });
    } finally {
      event.data.password = '';
      bytes?.fill(0);
      busy = false;
    }
  })());
});
async function respond(request, url) {
  let path;
  try { path = decodeURIComponent(url.pathname.slice(BASE.length)); } catch { return new Response('Invalid path', { status: 400, headers }); }
  // Only public runtime files may reach the actual server.
  if (path.startsWith('_sealed/') || path === 'sw.js' || path === 'robots.txt') return fetch(request, { cache: 'no-store' });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('This site has no server API.', { status: 405, headers });
  if (!files) {
    if (request.mode === 'navigate') {
      const shell = await fetch(BASE + '_sealed/index.html', { cache: 'no-store' });
      return new Response(await shell.arrayBuffer(), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('Site locked. Reload and unlock again.', { status: 423, headers });
  }
  const candidates = path === '' ? ['index.html'] : [path, path.endsWith('/') ? path + 'index.html' : path + '.html', path + '/index.html'];
  if (request.mode === 'navigate' && path && !path.endsWith('/') && !files.has(path) && !files.has(path + '.html') && files.has(path + '/index.html')) {
    url.pathname += '/';
    return new Response(null, { status: 302, headers: { ...headers, Location: url.href } });
  }
  let file = candidates.map(p => files.get(p)).find(Boolean);
  let status = 200;
  if (!file && request.mode === 'navigate') {
    if (SPA) file = files.get('index.html');
    else { file = files.get('404.html'); status = 404; }
  }
  if (!file) return new Response('Not found', { status: 404, headers });
  const h = { ...headers, 'Content-Type': file.type, 'Accept-Ranges': 'bytes' };
  let data = file.data;
  const range = request.headers.get('range');
  if (range && status === 200 && request.method === 'GET') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { ...h, 'Content-Range': `bytes */${data.length}` } });
    const start = m[1] ? Number(m[1]) : Math.max(0, data.length - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
    if (start > end || start >= data.length) return new Response(null, { status: 416, headers: { ...h, 'Content-Range': `bytes */${data.length}` } });
    h['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
    data = data.subarray(start, end + 1);
    status = 206;
  }
  h['Content-Length'] = String(data.length);
  return new Response(request.method === 'HEAD' ? null : data, { status, headers: h });
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith(BASE)) event.respondWith(respond(event.request, url));
});
