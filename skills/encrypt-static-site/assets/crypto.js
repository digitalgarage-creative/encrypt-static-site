// Shared by the build engine and browser worker. Web Crypto performs all AES operations.
export const KDF = Object.freeze({ name: 'argon2id', memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 });
export const MAX_BUNDLE = 96 * 1024 * 1024;
const encoder = new TextEncoder();
export const encode = value => encoder.encode(value);
export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function unb64(s) {
  if (typeof s !== 'string' || s.length % 4 || /[^A-Za-z0-9+/=]/.test(s)) throw Error('Invalid encoding');
  const padding = s.indexOf('=');
  if (padding !== -1 && !((padding === s.length - 1) || (padding === s.length - 2 && s.endsWith('==')))) throw Error('Invalid encoding');
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function metadata(e) {
  return { version: e.version, id: e.id, base: e.base, spa: e.spa, kdf: e.kdf, salt: e.salt, payloadNonce: e.payloadNonce };
}
export function validBase(base) {
  return typeof base === 'string' && /^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base);
}
export function validPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
    !/[\\\x00-\x1f\x7f?#%]/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..');
}
export function validateEnvelope(e) {
  const fields = ['version', 'id', 'base', 'spa', 'kdf', 'salt', 'payloadNonce', 'wrapNonce', 'payload', 'wrappedKey'];
  if (!e || Object.keys(e).length !== fields.length || Object.keys(e).some(key => !fields.includes(key))) throw Error('Unexpected envelope fields');
  if (!e || e.version !== 1 || !/^[a-f0-9]{32}$/.test(e.id) || !validBase(e.base) || typeof e.spa !== 'boolean' ||
      JSON.stringify(e.kdf) !== JSON.stringify(KDF) || unb64(e.salt).length !== 16 ||
      unb64(e.wrapNonce).length !== 12 || unb64(e.payloadNonce).length !== 12 ||
      unb64(e.wrappedKey).length !== 48 || typeof e.payload !== 'string' || e.payload.length > MAX_BUNDLE * 1.4) {
    throw Error('Unsupported or malformed protected bundle');
  }
}
export async function aesKey(bytes) {
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function derive(password, salt, argon2id) {
  const raw = await argon2id({ ...KDF, password, salt: unb64(salt), outputType: 'binary' });
  try { return await aesKey(raw); } finally { raw.fill(0); }
}
export async function decryptEnvelope(e, password, argon2id) {
  validateEnvelope(e);
  const aad = encode(JSON.stringify(metadata(e)));
  const key = await derive(password, e.salt, argon2id);
  let raw;
  try {
    raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.wrapNonce), additionalData: aad }, key, unb64(e.wrappedKey)));
  } catch (error) {
    if (error.name !== 'OperationError') throw error;
    const failure = Error('Wrong password');
    failure.code = 'WRONG_PASSWORD';
    throw failure;
  }
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.payloadNonce), additionalData: aad }, await aesKey(raw), unb64(e.payload)));
  } finally { raw.fill(0); }
}
export function parsePackage(bytes) {
  if (bytes.length > MAX_BUNDLE) throw Error('Bundle exceeds memory limit');
  const p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (p.version !== 1 || !Array.isArray(p.files) || p.files.length > 20000) throw Error('Invalid site package');
  const files = new Map();
  for (const f of p.files) {
    if (!validPath(f.path) || files.has(f.path) || typeof f.type !== 'string' || /[\r\n]/.test(f.type)) throw Error('Invalid file entry');
    files.set(f.path, { type: f.type, data: unb64(f.data) });
  }
  if (!files.has('index.html')) throw Error('No index.html in bundle');
  return files;
}
