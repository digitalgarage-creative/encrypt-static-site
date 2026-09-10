import { readFile, readdir, lstat, realpath, mkdir, mkdtemp, writeFile, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { protectHtml, ROBOTS_META } from './html-policy.mjs';
import { KDF, MAX_BUNDLE, aesKey, b64, encode, derive, decryptEnvelope, metadata, parsePackage, validBase, validPath } from '../assets/crypto.js';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json' };
const textExtensions = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.txt', '.svg', '.xml']);
const forbidden = /^(?:node_modules|\.git|\.next|\.env(?:\..*)?|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|.*\.(?:pem|key|map)|_headers|_redirects|vercel\.json|netlify\.toml)$/i;

export async function collect(input) {
  const root = await realpath(input);
  const files = [];
  let size = 0;
  async function walk(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error(`Symbolic links are not accepted: ${relative}`);
      if (forbidden.test(entry.name) || entry.name.startsWith('.') && entry.name !== '.well-known') throw Error(`Not a clean static output: ${relative}. Select or prepare a dedicated browser-only directory.`);
      if (!validPath(relative) || relative === 'sw.js' || relative === '_sealed' || relative.startsWith('_sealed/')) throw Error(`Reserved or unsupported path: ${relative}`);
      if (entry.isDirectory()) { await walk(path.join(dir, entry.name), relative + '/'); continue; }
      if (!entry.isFile()) throw Error(`Not a regular file: ${relative}`);
      let data = await readFile(path.join(dir, entry.name));
      size += data.length;
      if (size > 64 * 1024 * 1024 || files.length >= 20000) throw Error('This version supports at most 64 MiB of static files and 20,000 files.');
      const ext = path.extname(relative).toLowerCase();
      if (textExtensions.has(ext)) {
        const text = data.toString('utf8');
        if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\b(?:sk_live_|ghp_)[A-Za-z0-9]{20,}/.test(text)) throw Error(`Possible credential in ${relative}. Remove browser-side secrets before packaging.`);
        if (/serviceWorker\s*(?:\?\.)?\s*\.\s*register\s*\(/.test(text)) throw Error(`Existing Service Worker registration in ${relative}. Its offline/runtime behavior conflicts with the encrypted filesystem.`);
      }
      if (ext === '.html' || ext === '.htm') data = Buffer.from(protectHtml(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data)));
      files.push({ path: relative, type: types[ext] || 'application/octet-stream', data: data.toString('base64') });
    }
  }
  await walk(root);
  if (!files.some(f => f.path === 'index.html')) throw Error('The selected static directory must contain index.html.');
  const bytes = encode(JSON.stringify({ version: 1, files }));
  if (bytes.length > MAX_BUNDLE) throw Error('Packaged site is too large for the in-memory runtime.');
  return { root, files, bytes, size };
}

export async function encrypt(bytes, password, { base = '/', spa = false } = {}) {
  if (!validBase(base)) throw Error('Base must be / or a path such as /my-project/ (letters, numbers, hyphens, underscores).');
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) throw Error('Supply a nonempty password of at most 1024 characters.');
  const e = { version: 1, id: randomBytes(16).toString('hex'), base, spa, kdf: { ...KDF }, salt: b64(randomBytes(16)), payloadNonce: b64(randomBytes(12)), wrapNonce: b64(randomBytes(12)) };
  const aad = encode(JSON.stringify(metadata(e)));
  const raw = randomBytes(32);
  try {
    e.payload = b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: Uint8Array.from(Buffer.from(e.payloadNonce, 'base64')), additionalData: aad }, await aesKey(raw), bytes)));
    e.wrappedKey = b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: Uint8Array.from(Buffer.from(e.wrapNonce, 'base64')), additionalData: aad }, await derive(password, e.salt, argon2id), raw)));
    return e;
  } finally { raw.fill(0); }
}

export async function publicFiles(envelope) {
  const { base, id, spa } = envelope;
  const render = async name => (await readFile(path.join(skill, 'assets', name), 'utf8'))
    .replaceAll('__BASE_JSON__', JSON.stringify(base)).replaceAll('__BUILD_JSON__', JSON.stringify(id)).replaceAll('__SPA_JSON__', JSON.stringify(spa)).replaceAll('__BASE__', base);
  const shell = await render('index.html');
  // No protected names, source paths, or titles are used in any public metadata.
  return new Map([
    ['index.html', shell], ['404.html', shell], ['_sealed/index.html', shell],
    ['sw.js', await render('sw.js')], ['_sealed/unlock.js', await render('unlock.js')],
    ['_sealed/unlock.css', await render('unlock.css')], ['_sealed/crypto.js', await readFile(path.join(skill, 'assets/crypto.js'))],
    ['_sealed/argon2.js', await readFile(path.join(skill, 'node_modules/hash-wasm/dist/argon2.umd.min.js'))],
    ['_sealed/THIRD-PARTY-LICENSE.txt', await readFile(path.join(skill, 'node_modules/hash-wasm/LICENSE'))],
    ['_sealed/LICENSE.txt', await readFile(path.join(skill, 'LICENSE'))],
    ['_sealed/protected.bundle', JSON.stringify(envelope)],
    ['robots.txt', 'User-agent: *\nAllow: /\n# Indexing directives are on the unlock page and, where supported, response headers.\n'],
    ['.nojekyll', ''],
    ['_headers', `${base}*\n  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n`],
  ]);
}

function samples(files) {
  const values = new Set();
  for (const f of files) {
    if (!textExtensions.has(path.extname(f.path))) continue;
    const text = Buffer.from(f.data, 'base64').toString('utf8');
    // Long source windows plus human-readable HTML text. This supplements exact allowlisting.
    for (let i = 0; i + 96 <= text.length && i < 8192; i += 256) values.add(text.slice(i, i + 96));
    if (f.path.endsWith('.html')) {
      for (const match of text.matchAll(/>([^<>]{20,200})</g)) {
        const value = match[1].trim();
        if (value.length >= 20) values.add(value);
      }
    }
  }
  // This deliberately public policy is inserted into both shell and protected HTML.
  return [...values].filter(value => !value.includes(ROBOTS_META));
}

export async function verify(output, input, password) {
  const packaged = await collect(input);
  const envelope = JSON.parse(await readFile(path.join(output, '_sealed/protected.bundle'), 'utf8'));
  const decrypted = await decryptEnvelope(envelope, password, argon2id);
  try {
    if (!Buffer.from(decrypted).equals(Buffer.from(packaged.bytes))) throw Error('Decrypted package differs from the complete static input.');
    parsePackage(decrypted);
  } finally { decrypted.fill(0); }
  let rejected = false;
  try { await decryptEnvelope(envelope, randomBytes(32).toString('hex') + 'incorrect', argon2id); } catch { rejected = true; }
  if (!rejected) throw Error('Incorrect-password verification failed.');
  const expected = await publicFiles(envelope);
  const found = [];
  async function walk(dir, prefix = '') {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const p = prefix + item.name;
      if (item.isSymbolicLink()) throw Error(`Unexpected deployment symlink: ${p}`);
      if (item.isDirectory()) await walk(path.join(dir, item.name), p + '/');
      else if (item.isFile()) found.push(p);
      else throw Error('Unexpected deployment entry');
    }
  }
  await walk(output);
  if (found.length !== expected.size || found.some(f => !expected.has(f))) throw Error('Unexpected or missing deployment files. Publish only a fresh generated directory.');
  const needles = samples(packaged.files);
  for (const [name, content] of expected) {
    const data = await readFile(path.join(output, name));
    if (!data.equals(Buffer.from(content))) throw Error(`Deployment file changed: ${name}`);
    const text = data.toString('utf8');
    // Exact template and envelope validation detects added plaintext. A substring
    // match against the password falsely rejects ordinary words and short inputs.
    if (needles.some(sample => text.includes(sample))) throw Error(`Possible plaintext overlap in ${name}; inspect locally without printing protected samples.`);
  }
  return { files: packaged.files.length, bytes: packaged.size, checkedPublicFiles: expected.size, plaintextSamples: needles.length, correctPassword: true, wrongPasswordRejected: true };
}

export async function protect(input, output, password, options = {}) {
  const packaged = await collect(input);
  const parent = await realpath(path.dirname(path.resolve(output)));
  const destination = path.join(parent, path.basename(path.resolve(output)));
  const within = (a, b) => a === b || a.startsWith(b + path.sep);
  if (within(destination, packaged.root) || within(packaged.root, destination)) throw Error('Input and output directories must not overlap. Stage the static input separately and preserve the designated output path.');
  try { await lstat(destination); throw Error('Output already exists. Build and verify in a temporary directory, then replace only the confirmed generated output at this same designated path, keeping a recoverable backup.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const stage = await mkdtemp(path.join(parent, '.sealed-build-'));
  try {
    const envelope = await encrypt(packaged.bytes, password, options);
    await mkdir(path.join(stage, '_sealed'));
    for (const [file, content] of await publicFiles(envelope)) await writeFile(path.join(stage, file), content);
    const report = await verify(stage, input, password);
    // Exclusive reservation avoids replacing any existing destination.
    await mkdir(destination);
    try { await rename(stage, destination); } catch (error) { await rmdir(destination).catch(() => {}); throw error; }
    return report;
  } finally { packaged.bytes.fill(0); await rm(stage, { recursive: true, force: true }); }
}
