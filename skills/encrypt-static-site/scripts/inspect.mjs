#!/usr/bin/env node
// Read-only hints; a successful static build and source review remain authoritative.
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] || '.');
const findings = [];
const skip = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'build', 'encrypted', '.agents', '.claude']);
let pkg = {};
try { pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const framework = deps.next ? 'next' : deps.vite ? 'vite' : deps['react-scripts'] ? 'create-react-app' : deps.react ? 'react-custom' : 'static-or-other';
const rules = [
  [/['"]use server['"]/, 'blocker', 'This file declares a Server Action, which needs a running server.'],
  [/\bgetServerSideProps\b/, 'blocker', 'This page generates content on each server request.'],
  [/from\s*['"]next\/headers['"]|require\(['"]next\/headers['"]\)/, 'review', 'This file reads request headers or cookies. Check whether the code runs at build time or needs a server.'],
  [/export\s+(?:const|let)\s+dynamic\s*=\s*['"]force-dynamic['"]/, 'blocker', 'This page explicitly requires server rendering on each visit.'],
  [/serviceWorker\s*\.\s*register\s*\(/, 'blocker', 'An existing Service Worker would compete with the encrypted filesystem.'],
  [/(?:fetch|axios\.(?:get|post))\s*\(\s*['"](?:https?:\/\/|\/api\/)/, 'review', 'This code calls an external or server API. Confirm browser access, authentication, and data exposure.'],
  [/process\.env\.(?:NEXT_PUBLIC_|VITE_|REACT_APP_)\w+|import\.meta\.env\.VITE_\w+/, 'review', 'This environment variable becomes browser-visible. Confirm it is safe for every password holder.'],
];
async function walk(dir) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(f.name) || f.name.startsWith('.')) continue;
    const full = path.join(dir, f.name);
    if (f.isSymbolicLink()) continue;
    if (f.isDirectory()) { await walk(full); continue; }
    const relative = path.relative(root, full);
    if (!/\.(?:[cm]?[jt]sx?|html)$/.test(f.name)) continue;
    if (/(?:^|\/)(?:middleware|proxy)\.[jt]s$/.test(relative)) findings.push({ file: relative, level: 'review', reason: 'Request middleware needs a server; check what behavior would be lost in a static export.' });
    if (/(?:^|\/)pages\/api\//.test(relative) || /(?:^|\/)route\.[jt]s$/.test(relative)) findings.push({ file: relative, level: 'review', reason: 'API/route handler: only build-time static responses can be included. Request-dependent behavior needs a backend.' });
    const text = await readFile(full, 'utf8');
    for (const [regex, level, reason] of rules) {
      const m = regex.exec(text);
      if (m) findings.push({ file: relative, line: text.slice(0, m.index).split('\n').length, level, reason });
    }
  }
}
await walk(root);
const candidates = [];
for (const dir of ['out', 'dist', 'build', '.']) {
  try { await access(path.join(root, dir, 'index.html')); candidates.push(dir); } catch {}
}
console.log(JSON.stringify({ framework, suggestedOutput: path.join(root, 'encrypted'), buildScript: pkg.scripts?.build || null, staticCandidates: candidates, findings,
  note: 'Heuristic source inspection, not a security audit. Review findings, build with the existing package manager, and browser-test the generated output.' }, null, 2));
if (findings.some(f => f.level === 'blocker')) process.exitCode = 2;
