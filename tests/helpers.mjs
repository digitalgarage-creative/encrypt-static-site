import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
export const password = 'test-only meadow copper orbit lantern';
export async function browser() {
  const name = process.env.TEST_BROWSER || 'chromium';
  const type = { chromium, firefox, webkit }[name];
  if (!type) throw Error('Unknown TEST_BROWSER');
  return type.launch({ headless: true, ...(process.env.CHROME_PATH && name === 'chromium' ? { executablePath: process.env.CHROME_PATH } : {}) });
}
export async function serve(root, base = '/', intercept) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (intercept && await intercept(req, res, url)) return;
    try {
      if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end(); return; }
      const relative = decodeURIComponent(url.pathname.slice(base.length));
      let file = path.resolve(root, relative || 'index.html');
      if (!file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root)) throw Error('Invalid path');
      let status = 200;
      try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); await stat(file); }
      catch { file = path.join(root, '404.html'); status = 404; }
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}${base}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}
export async function unlock(page, url, secret = password) {
  await page.goto(url);
  await page.locator('button[type=submit]:enabled').waitFor();
  await page.locator('#password').fill(secret);
  await page.locator('button[type=submit]').click();
}
