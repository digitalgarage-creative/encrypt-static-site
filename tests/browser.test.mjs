import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { protect } from '../skills/encrypt-static-site/scripts/engine.mjs';
import { browser, serve, unlock, password } from './helpers.mjs';

for (const base of ['/', '/team-preview/']) test(`browser static runtime at ${base}`, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sealed-browser-'));
  const input = path.join(dir, 'input');
  await mkdir(path.join(input, 'nested'), { recursive: true });
  await mkdir(path.join(input, 'assets'));
  await writeFile(path.join(input, 'index.html'), `<!doctype html><link rel="stylesheet" href="${base}assets/site.css"><h1>Quarterly Prototype Dashboard</h1><p id="result"></p><img src="${base}assets/image.svg"><a href="${base}nested/">Nested</a><script type="module" src="${base}assets/main.js"></script>`);
  await copyFile(new URL('../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2', import.meta.url), path.join(input, 'assets/font.woff2'));
  await writeFile(path.join(input, 'assets/site.css'), '@font-face{font-family:Fixture;src:url(./font.woff2)}h1{font-family:Fixture;color:rgb(10, 20, 30);background-image:url(./image.svg)}');
  await writeFile(path.join(input, 'assets/image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  await writeFile(path.join(input, 'assets/main.js'), `import {part} from './part.js'; const {lazy} = await import('./lazy.js'); const data = await fetch('${base}assets/data.json').then(r=>r.json()); document.querySelector('#result').textContent=part+lazy+data.message;`);
  await writeFile(path.join(input, 'assets/part.js'), 'export const part="module:";');
  await writeFile(path.join(input, 'assets/lazy.js'), 'export const lazy="dynamic:";');
  await writeFile(path.join(input, 'assets/data.json'), '{"message":"private local data"}');
  await writeFile(path.join(input, 'nested/index.html'), '<h1>Private nested route</h1><a href="../">Home</a>');
  const output = path.join(dir, 'public');
  await protect(input, output, password, { base });
  const server = await serve(output, base);
  const b = await browser();
  t.after(async () => { await b.close(); await server.close(); await rm(dir, { recursive: true, force: true }); });
  const context = await b.newContext();
  const page = await context.newPage();
  await unlock(page, server.url, 'incorrect test passphrase');
  await page.getByText('Wrong password', { exact: true }).waitFor();
  assert.equal(await page.locator('h1').textContent(), 'Protected site');
  assert.equal(await page.locator('button[type=submit]').isEnabled(), true);
  assert.equal(await page.locator('#password').getAttribute('aria-invalid'), 'true');
  await page.locator('#password').fill('another incorrect password');
  await page.locator('button[type=submit]').click();
  await page.getByText('Wrong password', { exact: true }).waitFor();
  assert.equal(await page.locator('button[type=submit]').isEnabled(), true);
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  await page.getByText('module:dynamic:private local data', { exact: true }).waitFor();
  assert.match(await page.locator('head meta[name=robots]').getAttribute('content'), /noindex, nofollow/);
  assert.equal(await page.locator('h1').evaluate(e => getComputedStyle(e).color), 'rgb(10, 20, 30)');
  assert.equal(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Fixture'); }), true);
  assert.equal(await page.locator('img').evaluate(e => e.complete && e.naturalWidth > 0), true);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(await page.evaluate(() => caches.keys()), []);
  assert.equal((await page.evaluate(() => indexedDB.databases())).length, 0);
  const data = await page.evaluate(async base => {
    const r = await fetch(base + 'assets/data.json', { headers: { Range: 'bytes=0-4' } });
    return { status: r.status, text: await r.text(), cache: r.headers.get('cache-control') };
  }, base);
  assert.deepEqual(data, { status: 206, text: '{"mes', cache: 'no-store' });
  assert.equal(await page.evaluate(async base => (await fetch(base + 'missing.js')).status, base), 404);
  await page.getByRole('link', { name: 'Nested' }).click();
  await page.getByRole('heading', { name: 'Private nested route' }).waitFor();
  assert.match(await page.locator('head meta[name=robots]').getAttribute('content'), /noindex, nofollow/);
  assert.match(await page.evaluate(async () => (await fetch(location.href)).text()), /name="robots" content="noindex, nofollow/);
  await page.reload();
  await page.getByRole('heading', { name: 'Private nested route' }).waitFor();
  await page.goto(server.url + 'nested');
  await page.getByRole('heading', { name: 'Private nested route' }).waitFor();
  assert.ok(page.url().endsWith('nested/'), 'Directory URLs must preserve relative asset resolution');
  // A separate profile has neither a password nor decrypted responses.
  const other = await b.newContext();
  const locked = await other.newPage();
  await unlock(locked, server.url + 'nested/', password);
  await locked.getByRole('heading', { name: 'Private nested route' }).waitFor();
  await other.close();
  assert.ok(!server.requests.some(p => p.endsWith('assets/main.js') || p.endsWith('assets/data.json')));
  const lockPage = await context.newPage();
  await lockPage.goto(server.url + '_sealed/index.html');
  await lockPage.locator('button[type=submit]:enabled').waitFor();
  await lockPage.getByRole('button', { name: 'Lock all site tabs' }).click();
  await page.getByRole('heading', { name: 'Protected site' }).waitFor();
  assert.equal(await page.evaluate(async base => (await fetch(base + 'assets/data.json')).status, base), 423);
  // Force an actual worker process stop, then confirm restart cannot recover plaintext.
  if (!process.env.TEST_BROWSER || process.env.TEST_BROWSER === 'chromium') {
    await unlock(page, server.url);
    await page.getByText('module:dynamic:private local data', { exact: true }).waitFor();
    const cdp = await context.newCDPSession(page);
    const version = new Promise(resolve => {
      cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        const worker = versions.find(v => v.scriptURL === server.url + 'sw.js' && v.runningStatus === 'running');
        if (worker) resolve(worker.versionId);
      });
    });
    await cdp.send('ServiceWorker.enable');
    const id = await version;
    await cdp.send('ServiceWorker.stopWorker', { versionId: id });
    await page.reload();
    await page.getByRole('heading', { name: 'Protected site' }).waitFor();
    assert.equal(await page.evaluate(async base => (await fetch(base + 'assets/data.json')).status, base), 423);
    await cdp.detach();
  }
  await context.close();
});

test('stalled download times out visibly and allows a successful retry', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sealed-timeout-'));
  const input = path.join(dir, 'input');
  await mkdir(input);
  await writeFile(path.join(input, 'index.html'), '<h1>Recovered site</h1>');
  const output = path.join(dir, 'public');
  await protect(input, output, password);
  let stall = true;
  const server = await serve(output, '/', (req, res, url) => {
    if (url.pathname.endsWith('/protected.bundle') && stall) {
      stall = false;
      res.writeHead(200, {'content-type': 'application/json'});
      res.write('{');
      return true;
    }
    return false;
  });
  const b = await browser();
  t.after(async () => { await b.close(); await server.close(); await rm(dir, { recursive: true, force: true }); });
  const page = await b.newPage();
  await unlock(page, server.url);
  await page.getByText('Downloading encrypted site…', {exact: false}).waitFor();
  await page.getByText('Download timed out. Check your connection and try again.', {exact: true}).waitFor({timeout: 40000});
  assert.equal(await page.locator('button[type=submit]').isEnabled(), true);
  await page.locator('#password').fill(password);
  await page.locator('button[type=submit]').click();
  await page.getByRole('heading', {name: 'Recovered site'}).waitFor();
});
