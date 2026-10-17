#!/usr/bin/env node
/**
 * Put Node 22 or newer, from the runner's own tool cache, first on PATH for the rest of a CI job.
 *
 * GitHub's runners ship several Node versions in RUNNER_TOOL_CACHE, but the default on PATH
 * may be older than the Node 22 this project's tests and tools use. Nothing is downloaded and no
 * third-party setup action is used: this only picks one of the versions already installed.
 *
 *   node scripts/release/use-node.mjs [minMajor=22]
 *
 * Writes the directory to $GITHUB_PATH. Fails, saying so, when no suitable version is installed.
 */
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const min = Number(process.argv[2] || 22);
const cache = process.env.RUNNER_TOOL_CACHE;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
if (process.versions.node.split('.')[0] >= min) { console.log(`node ${process.version} on PATH is new enough`); process.exit(0); }
if (!cache || !existsSync(path.join(cache, 'node'))) { console.error(`node ${process.version} is older than ${min} and the runner tool cache has no other Node.`); process.exit(1); }

const versions = readdirSync(path.join(cache, 'node'))
  .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && Number(v.split('.')[0]) >= min && existsSync(path.join(cache, 'node', v, arch)))
  .sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
if (!versions.length) { console.error(`no Node >= ${min} in ${path.join(cache, 'node')}`); process.exit(1); }
const pick = versions[0]; // the oldest that qualifies: closest to the major this project targets
const base = path.join(cache, 'node', pick, arch);
const dir = existsSync(path.join(base, 'bin')) ? path.join(base, 'bin') : base;
console.log(`using node ${pick} from ${dir}`);
if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, dir + '\n');
