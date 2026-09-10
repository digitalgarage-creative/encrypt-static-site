import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { protect, verify, encrypt, collect } from '../skills/encrypt-static-site/scripts/engine.mjs';
import { decryptEnvelope, encode, parsePackage, b64, unb64 } from '../skills/encrypt-static-site/assets/crypto.js';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const require = createRequire(new URL('../skills/encrypt-static-site/package.json', import.meta.url));
const { argon2id } = require('hash-wasm');
const password = 'test-only meadow copper orbit lantern';
test('envelope authenticates password, content, metadata; encryption is randomized', async () => {
  const plain = encode('confidential fixture text');
  const one = await encrypt(plain, password);
  const two = await encrypt(plain, password);
  assert.notEqual(one.payload, two.payload);
  assert.notEqual(one.salt, two.salt);
  assert.deepEqual(await decryptEnvelope(one, password, argon2id), plain);
  await assert.rejects(decryptEnvelope(one, 'wrong password', argon2id));
  for (const field of ['wrappedKey', 'payload']) {
    const altered = { ...one, [field]: (one[field][0] === 'A' ? 'B' : 'A') + one[field].slice(1) };
    await assert.rejects(decryptEnvelope(altered, password, argon2id));
  }
  await assert.rejects(decryptEnvelope({ ...one, password }, password, argon2id), /Unexpected envelope/);
  await assert.rejects(decryptEnvelope({ ...one, base: '/other/' }, password, argon2id));
  await assert.rejects(decryptEnvelope({ ...one, kdf: { ...one.kdf, memorySize: 1 } }, password, argon2id));
  await assert.rejects(encrypt(plain, ''));
  const chosen = await encrypt(plain, 'short');
  assert.deepEqual(await decryptEnvelope(chosen, 'short', argon2id), plain);
});
test('fresh output roundtrips exact input, rejects leakage, symlinks and overlap', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sealed-engine-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input');
  const output = path.join(dir, 'public');
  await mkdir(input);
  await writeFile(path.join(input, 'index.html'), '<h1>Quarterly Prototype Dashboard</h1>');
  const report = await protect(input, output, password);
  assert.equal(report.correctPassword, true);
  assert.ok(report.plaintextSamples > 0);
  assert.ok(!(await readFile(path.join(output, 'index.html'), 'utf8')).includes('Quarterly'));
  await assert.rejects(protect(input, output, password), /already exists/);
  await assert.rejects(protect(input, path.join(input, 'public'), password), /overlap/);
  await writeFile(path.join(output, 'leak.html'), 'Quarterly Prototype Dashboard');
  await assert.rejects(verify(output, input, password), /Unexpected/);
  await rm(path.join(output, 'leak.html'));
  await writeFile(path.join(output, '_sealed/unlock.js'), '// tampered');
  await assert.rejects(verify(output, input, password), /changed/);
  await symlink(path.join(input, 'index.html'), path.join(input, 'link.html'));
  await assert.rejects(protect(input, path.join(dir, 'other'), password), /Symbolic/);
});
test('package rejects traversal and duplicate paths', () => {
  for (const files of [[{ path: '../secret', type: 'text/plain', data: '' }],
    [{ path: 'index.html', type: 'text/html', data: '' }, { path: 'index.html', type: 'text/html', data: '' }]]) {
    assert.throws(() => parsePackage(encode(JSON.stringify({ version: 1, files }))));
  }
});
test('inspector explains server blockers without misclassifying build-time components', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sealed-inspect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'app'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '16.3.4' }, scripts: { build: 'next build' } }));
  await writeFile(path.join(dir, 'app/page.jsx'), 'export default function Page(){return <h1>Static component</h1>}');
  const script = new URL('../skills/encrypt-static-site/scripts/inspect.mjs', import.meta.url).pathname;
  let report = JSON.parse((await exec(process.execPath, [script, dir])).stdout);
  assert.equal(report.framework, 'next');
  assert.deepEqual(report.findings, []);
  await writeFile(path.join(dir, 'app/actions.js'), '"use server"; export async function action(){}');
  try { await exec(process.execPath, [script, dir]); assert.fail('Expected incompatibility exit'); }
  catch (e) {
    assert.equal(e.code, 2);
    report = JSON.parse(e.stdout);
    assert.equal(report.findings[0].file, 'app/actions.js');
    assert.equal(report.findings[0].level, 'blocker');
    assert.match(report.findings[0].reason, /running server/);
  }
});
test('CLI keeps password files outside the input, accepts stdin and emits only counts', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sealed-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'input'));
  await writeFile(path.join(dir, 'input/index.html'), '<h1>Confidential CLI test heading</h1>');
  const secretFile = path.join(dir, 'input/password.txt');
  await writeFile(secretFile, password, { mode: 0o600 });
  const script = new URL('../skills/encrypt-static-site/scripts/protect.mjs', import.meta.url).pathname;
  const args = [script, '--input', path.join(dir, 'input'), '--output', path.join(dir, 'output')];
  await assert.rejects(exec(process.execPath, [...args, '--password-file', secretFile]), /outside/);
  await rm(secretFile);
  const result = await new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [...args, '--password-stdin'], (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
    child.stdin.end(password);
  });
  assert.equal(JSON.parse(result.stdout).status, 'verified');
  assert.ok(!result.stdout.includes(password));
  assert.equal(result.stderr, '');
});

test('large binary assets decode without recursive regex or iterator expansion', () => {
  const bytes = new Uint8Array(8 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  assert.deepEqual(unb64(b64(bytes)), bytes);
  for (const invalid of ['A===', '=AAA', 'AA=A', 'AAA', 'AA!A']) assert.throws(() => unb64(invalid));
});

import { protectHtml, ROBOTS_META, ROBOTS_CONTENT } from '../skills/encrypt-static-site/scripts/html-policy.mjs';
const { parse } = require('parse5');
test('every packaged HTML gets a real head robots directive without modifying originals', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sealed-html-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sources = [
    '<!doctype html><html><head><title>Private</title></head><body>Content</body></html>',
    '<!-- fake <head> --><HTML><HEAD><meta name="robots" content="index,follow"><script>const tag="<head>";</script></HEAD><BODY>Content</BODY></HTML>',
    '<!doctype html><title>Implicit head</title><h1>Content</h1>',
    '<html><body>Content</body></html>', '<h1>Fragment</h1>',
    '<!doctype html><html></head><body>Content</body></html>'
  ];
  await mkdir(path.join(dir, 'en'));
  for (const [i, source] of sources.entries()) {
    const name = i === 0 ? 'index.html' : `en/page${i}.${i === 1 ? 'htm' : 'html'}`;
    await writeFile(path.join(dir, name), source);
    const result = protectHtml(source);
    assert.equal(protectHtml(result), result);
    assert.equal(result.replace('\n' + ROBOTS_META + '\n', ''), source);
    const head = parse(result).childNodes.find(n => n.tagName === 'html').childNodes.find(n => n.tagName === 'head');
    assert.ok(head.childNodes.some(n => n.tagName === 'meta' && n.attrs.some(a => a.name === 'content' && a.value === ROBOTS_CONTENT)));
  }
  const packaged = await collect(dir);
  assert.equal(packaged.files.length, sources.length);
  for (const file of packaged.files) {
    assert.equal(file.type, 'text/html; charset=utf-8');
    const original = await readFile(path.join(dir, file.path), 'utf8');
    assert.ok(sources.includes(original));
    assert.equal(Buffer.from(file.data, 'base64').toString(), protectHtml(original));
  }
});

test('chosen password is not rejected for coincidental public text', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sealed-password-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input');
  await mkdir(input);
  await writeFile(path.join(input, 'index.html'), '<h1>Private fixture</h1>');
  for (const [i, chosen] of ['a', 'Protected site'].entries()) {
    const output = path.join(dir, `output${i}`);
    const report = await protect(input, output, chosen);
    assert.equal(report.correctPassword, true);
    assert.equal(report.wrongPasswordRejected, true);
    const envelope = JSON.parse(await readFile(path.join(output, '_sealed/protected.bundle'), 'utf8'));
    await writeFile(path.join(output, '_sealed/protected.bundle'), JSON.stringify({...envelope, password: chosen}));
    await assert.rejects(verify(output, input, chosen), /Unexpected envelope/);
  }
});
