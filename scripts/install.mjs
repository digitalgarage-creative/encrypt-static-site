#!/usr/bin/env node
import { cp, mkdir, lstat, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/encrypt-static-site');
try {
  const { values } = parseArgs({ options: { target: { type: 'string' }, scope: { type: 'string' }, project: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help || !values.target || !values.scope) {
    console.log('node scripts/install.mjs --target codex|claude|both --scope user|project [--project /absolute/project]\nCreates new skill directories and installs the locked dependencies. Never overwrites an existing skill.');
  } else {
    if (!['codex', 'claude', 'both'].includes(values.target) || !['user', 'project'].includes(values.scope)) throw Error('Invalid target or scope.');
    if (values.scope === 'project' && !values.project) throw Error('Project scope requires --project.');
    if (values.scope === 'user' && values.project) throw Error('--project applies only to project scope.');
    const root = values.scope === 'user' ? homedir() : path.resolve(values.project);
    const targets = values.target === 'both' ? ['codex', 'claude'] : [values.target];
    const destinations = targets.map(target => path.join(root, target === 'codex' ? '.agents' : '.claude', 'skills/encrypt-static-site'));
    for (const destination of destinations) {
      try { await lstat(destination); throw Error(`Already installed at ${destination}. Move the old version aside before installing an update.`); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    for (const destination of destinations) {
      await mkdir(path.dirname(destination), { recursive: true });
      await mkdir(destination); // exclusive ownership before copying; never overwrite an existing skill
      try {
        await cp(source, destination, { recursive: true, filter: p => path.basename(p) !== 'node_modules' });
        execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--omit=dev'], { cwd: destination, stdio: 'inherit' });
      } catch (error) {
        await rm(destination, { recursive: true, force: true });
        throw error;
      }
      console.log(`Installed: ${destination}`);
    }
    console.log('Open a new Codex/Claude Code session to discover the installed skill.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
