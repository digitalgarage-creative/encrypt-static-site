#!/usr/bin/env node
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { protect, verify } from './engine.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, output: { type: 'string' }, base: { type: 'string', default: '/' },
    spa: { type: 'boolean', default: false }, 'password-file': { type: 'string' }, 'password-stdin': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node protect.mjs [protect|verify] --input STATIC_DIR --output NEW_DIR [--base /project/] [--spa] (--password-file PRIVATE_FILE | --password-stdin)\nPasswords are never accepted as command-line values. Password files must be private and outside source/deployment folders.');
  } else {
    const command = positionals[0] || 'protect';
    if (!['protect', 'verify'].includes(command) || positionals.length > 1 || !values.input || !values.output) throw Error('Use --help for usage.');
    if (Boolean(values['password-file']) === Boolean(values['password-stdin'])) throw Error('Choose exactly one password source: --password-file or --password-stdin.');
    if (values['password-file']) {
      const s = await stat(values['password-file']);
      if (!s.isFile() || s.size > 4096 || process.platform !== 'win32' && (s.mode & 0o077)) throw Error('Password file must be a small private file (chmod 600).');
      const file = await realpath(values['password-file']);
      const input = await realpath(values.input);
      const output = path.join(await realpath(path.dirname(path.resolve(values.output))), path.basename(path.resolve(values.output)));
      if ([input, output].some(root => file === root || file.startsWith(root + path.sep))) throw Error('Keep the password file outside the static input and deployment directories.');
    }
    let password;
    if (values['password-file']) password = (await readFile(values['password-file'], 'utf8')).replace(/\r?\n$/, '');
    else {
      const chunks = [];
      let size = 0;
      for await (const chunk of process.stdin) { size += chunk.length; if (size > 4096) throw Error('Password input is too long.'); chunks.push(chunk); }
      password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    }
    const report = command === 'verify' ? await verify(values.output, values.input, password) :
      await protect(values.input, values.output, password, { base: values.base, spa: values.spa });
    password = '';
    console.log(JSON.stringify({ status: 'verified', ...report }, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
