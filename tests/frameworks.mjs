import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { protect } from '../skills/encrypt-static-site/scripts/engine.mjs';
import { browser, serve, unlock, password } from './helpers.mjs';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.test-work');
await mkdir(work, { recursive: true });
const runDir = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(work, 'frameworks-')));
const b = await browser();
try {
  for (const framework of ['vite', 'next']) {
    const base = '/' + framework + '-preview/';
    const project = path.join(runDir, framework);
    await mkdir(project);
    await symlink(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir');
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { react: '19.3.0', 'react-dom': '19.3.0', ...(framework === 'next' ? { next: '16.3.4' } : {}) } }));
    if (framework === 'vite') {
      await writeFile(path.join(project, 'index.html'), '<div id="root"></div><script type="module" src="/main.jsx"></script>');
      await writeFile(path.join(project, 'main.jsx'), `import React from 'react'; import {createRoot} from 'react-dom/client'; function App(){ const [count,setCount]=React.useState(0); const [lazy,setLazy]=React.useState(''); const [route,setRoute]=React.useState(location.pathname); return <><h1>Private React fixture</h1><button onClick={()=>setCount(count+1)}>Count {count}</button><button onClick={async()=>setLazy((await import('./lazy.js')).default)}>Load chunk</button><p>{lazy}</p><a href="${base}reports" onClick={e=>{e.preventDefault();history.pushState({},'',e.currentTarget.href);setRoute(location.pathname)}}>Reports</a><p>{route}</p></> }createRoot(document.getElementById('root')).render(<App/>);`);
      await writeFile(path.join(project, 'lazy.js'), 'export default "Private React lazy chunk";');
      await exec(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--base', base], { cwd: project });
    } else {
      await mkdir(path.join(project, 'app/about'), { recursive: true });
      await mkdir(path.join(project, 'public'));
      await writeFile(path.join(project, 'next.config.mjs'), `export default { output: 'export', trailingSlash: true, basePath: '${base.slice(0, -1)}', images: { unoptimized: true } };`);
      await writeFile(path.join(project, 'app/layout.jsx'), `import React from 'react'; import './style.css'; export default function Layout({children}){return <html lang="en"><body>{children}</body></html>}`);
      await writeFile(path.join(project, 'app/style.css'), 'h1 { color: rgb(35, 55, 75); }');
      await writeFile(path.join(project, 'app/page.jsx'), `import React from 'react'; import Link from 'next/link'; import Counter from './counter'; export default function Page(){return <><h1>Private Next export fixture</h1><Counter/><Link href="/about/">About</Link></>}`);
      await writeFile(path.join(project, 'app/counter.jsx'), `'use client'; import React from 'react'; export default function Counter(){const [n,setN]=React.useState(0);const [text,setText]=React.useState('');return <><button onClick={()=>setN(n+1)}>Count {n}</button><button onClick={async()=>setText((await import('./lazy')).default)}>Load chunk</button><p>{text}</p></>}`);
      await writeFile(path.join(project, 'app/lazy.js'), 'export default "Private Next lazy chunk";');
      await writeFile(path.join(project, 'app/about/page.jsx'), `import React from 'react'; import Link from 'next/link'; export default function About(){return <><h1>Private Next nested route</h1><Link href="/">Home</Link></>}`);
      await exec(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], { cwd: project, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, maxBuffer: 4 * 1024 * 1024 });
    }
    const output = path.join(runDir, framework + '-protected');
    await protect(path.join(project, framework === 'vite' ? 'dist' : 'out'), output, password, { base, spa: framework === 'vite' });
    const server = await serve(output, base);
    const ctx = await b.newContext();
    try {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await unlock(page, server.url);
      await page.getByRole('button', { name: 'Count 0' }).click();
      await page.getByRole('button', { name: 'Count 1' }).waitFor();
      await page.getByRole('button', { name: 'Load chunk' }).click();
      await page.getByText(framework === 'vite' ? 'Private React lazy chunk' : 'Private Next lazy chunk', { exact: true }).waitFor();
      if (framework === 'next') {
        await page.getByRole('link', { name: 'About' }).click();
        await page.getByRole('heading', { name: 'Private Next nested route' }).waitFor();
        await page.reload();
        await page.getByRole('heading', { name: 'Private Next nested route' }).waitFor();
        await page.getByRole('link', { name: 'Home' }).click();
        await page.getByRole('button', { name: 'Count 0' }).waitFor();
      } else {
        await page.getByRole('link', { name: 'Reports' }).click();
        assert.ok(page.url().endsWith('/reports'));
        await page.reload();
        await page.getByRole('button', { name: 'Count 0' }).waitFor();
      }
      assert.deepEqual(errors, []);
      assert.ok(!server.requests.some(r => /\/(?:assets|_next)\//.test(r)), 'Protected assets must not hit the public server');
      console.log(`${framework}: real production build, hydration, dynamic chunk, client navigation and refresh passed at ${base}`);
    } finally { await ctx.close(); await server.close(); }
  }
} finally { await b.close(); await rm(runDir, { recursive: true, force: true }); }
