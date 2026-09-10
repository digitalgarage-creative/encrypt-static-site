#!/usr/bin/env node
import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { validBase } from '../assets/crypto.js';
import { protectHtml } from './html-policy.mjs';

export async function browserCheck({ input, output, password, base = '/', executablePath, timeoutMs = 120000 }) {
  if (!validBase(base)) throw Error('Invalid base path');
  const candidates = executablePath ? [executablePath] : [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap(key => process.env[key] ? [
      path.join(process.env[key], 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env[key], 'Microsoft/Edge/Application/msedge.exe')
    ] : []),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    chromium.executablePath()
  ].filter(Boolean);
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) return { status: 'unavailable', reason: 'No installed Chrome, Edge, or Playwright Chromium found. Browser verification was not performed.' };
  const root = await realpath(output);
  const source = await realpath(input);
  let server, browser, timer, phase = 'setup', timedOut = false;
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const cleanup = async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
  const work = async () => {
    // No fixed port, user browser profile, extension, or remote debugging setup.
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end(); return; }
        const relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
        let file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
        let code = 200;
        try { file = await realpath(file); if (!file.startsWith(root + path.sep)) throw Error(); await access(file); }
        catch { file = path.join(root, '404.html'); code = 404; }
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
        res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        const stream = createReadStream(file);
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
      } catch { res.destroy(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (timedOut) return;
    phase = 'browser launch';
    try { browser = await chromium.launch({ executablePath: executable, headless: true, timeout: 15000 }); }
    catch { return { status: 'unavailable', reason: 'Installed browser could not be launched. Browser verification was not performed.' }; }
    if (timedOut) { await browser.close(); return; }
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const origin = `http://127.0.0.1:${server.address().port}`;
    // Restrict this basic check to packaged resources. External integration testing is separate.
    let externalRequests = 0;
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests++; return route.abort();
    });
    let nested;
    async function findNested(dir, prefix = '') {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.isSymbolicLink()) continue;
        const relative = prefix + item.name;
        if (item.isDirectory()) await findNested(path.join(dir, item.name), relative + '/');
        else if (!nested && /\.html?$/i.test(relative) && !['index.html', '404.html'].includes(relative)) nested = relative;
        if (nested) return;
      }
    }
    await findNested(source);
    const first = nested || 'index.html';
    const urlFor = file => origin + base + file.split('/').map(encodeURIComponent).join('/');
    phase = 'wrong password';
    await page.goto(urlFor(first), { waitUntil: 'domcontentloaded' });
    await page.locator('button[type=submit]:enabled').waitFor();
    await page.locator('#password').fill(randomBytes(24).toString('hex'));
    await page.locator('button[type=submit]').click();
    await page.getByText('Wrong password', { exact: true }).waitFor({ timeout: 45000 });
    check(await page.locator('button[type=submit]').isEnabled(), 'Retry button remains disabled');
    phase = 'correct password retry';
    const navigation = page.waitForResponse(r => r.request().isNavigationRequest() && r.fromServiceWorker(), { timeout: 45000 });
    await page.locator('#password').fill(password);
    await page.locator('button[type=submit]').click();
    const response = await navigation;
    check(await response.text() === protectHtml(await readFile(path.join(source, first), 'utf8')), 'Unlocked HTML differs from prepared input');
    await page.waitForLoadState('domcontentloaded');
    phase = 'navigation and reload';
    for (const file of [...new Set(['index.html', first])]) {
      const response = await page.goto(urlFor(file), { waitUntil: 'domcontentloaded' });
      check(response.fromServiceWorker(), 'Page did not come from encrypted runtime');
      check(await response.text() === protectHtml(await readFile(path.join(source, file), 'utf8')), 'Page navigation failed');
      const robots = await page.locator('head meta[name=robots]').first().getAttribute('content');
      check(robots.includes('noindex') && robots.includes('nofollow'), 'Missing robots directive');
    }
    const reloaded = await page.reload({ waitUntil: 'domcontentloaded' });
    check(await reloaded.text() === protectHtml(await readFile(path.join(source, first), 'utf8')), 'Reload did not stay unlocked');
    return { status: 'passed', checks: ['wrong password', 'correct password retry', 'HTML source', 'robots directive', 'navigation', 'reload'], htmlPages: nested ? 2 : 1, externalRequestsBlocked: externalRequests, scope: 'Local browser smoke check; app interactions and published hosting are not covered.' };
  };
  try {
    return await Promise.race([work(), new Promise(resolve => {
      timer = setTimeout(() => { timedOut = true; resolve({ status: 'incomplete', reason: `Browser check reached its time limit during ${phase}.` }); }, timeoutMs);
    })]);
  } catch { return { status: 'failed', reason: `Browser check failed during ${phase}. Inspect this phase; do not claim browser verification passed.` }; }
  finally { clearTimeout(timer); await cleanup(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, base: { type: 'string', default: '/' }, 'executable-path': { type: 'string' }, 'password-stdin': { type: 'boolean' } } });
    if (!values.input || !values.output || !values['password-stdin']) throw Error('Use --input STATIC_INPUT --output ENCRYPTED_OUTPUT --password-stdin [--base /] [--executable-path BROWSER].');
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 4096) throw Error('Password input too long'); chunks.push(chunk); }
    let password = Buffer.concat(chunks).toString('utf8');
    const report = await browserCheck({ input: values.input, output: values.output, base: values.base, password: password.replace(/\r?\n$/, ''), executablePath: values['executable-path'] });
    password = '';
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
