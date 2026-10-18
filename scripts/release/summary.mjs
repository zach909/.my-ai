#!/usr/bin/env node
/**
 * The run summary: one table saying, for every build, what actually happened.
 *
 *   NEEDS_JSON='<toJSON(needs)>' PLAN_JSON='<plan outputs>' node scripts/release/summary.mjs
 *
 * Writes Markdown to $GITHUB_STEP_SUMMARY (or stdout) and exits 1 when any build failed or was cancelled.
 * The words come only from each job's real result: "success" is the only thing reported as built; a build
 * that was not needed for this change says so; a build that never ran is "skipped", never "passed".
 * Signing is reported from what the build step recorded, not assumed.
 */
import { appendFileSync } from 'node:fs';

const JOBS = [
  ['verify', 'Lint, type check, tests', null],
  ['extension', 'Chrome extension (ChromeOS, Chrome)', 'Zip for the Chrome Web Store or developer-mode install. Chrome updates a published extension itself.'],
  ['linux', 'Linux (.deb and .tar.gz)', 'Not code-signed.'],
  ['windows', 'Windows (.exe installer and .zip)', 'Not code-signed: SmartScreen will warn on first run until a signing certificate is configured.'],
  ['macos', 'macOS (.app and .dmg)', null],
  ['android', 'Android (APK)', 'Debug-signed APK for sideloading. A Play Store release needs the maintainer\'s upload key and Play account.'],
  ['ios', 'iOS (simulator build)', 'Unsigned simulator app: it proves the code compiles. A device build and the App Store need an Apple developer team and signing certificates.'],
];

/**
 * @param {Record<string, {result: string}>} needs   GitHub's `needs` context
 * @param {Record<string, string|boolean>} plan       which builds the change affected
 * @param {{macosSigning?: string}} notes
 */
export function renderSummary(needs, plan = {}, notes = {}) {
  const extra = notes.vitest ? ['', `Existing vitest suite: ${notes.vitest}`] : [];
  const rows = [];
  let failed = 0;
  let built = 0;
  for (const [id, label, note] of JOBS) {
    const r = needs[id]?.result;
    const wanted = id === 'verify' ? String(plan.tests) === 'true' : String(plan[id]) === 'true';
    let state;
    if (r === 'success') { state = id === 'verify' ? 'Passed' : 'Built'; if (id !== 'verify') built++; }
    else if (r === 'failure') { state = '**FAILED**'; failed++; }
    else if (r === 'cancelled') { state = '**Cancelled**'; failed++; }
    else if (r === 'skipped' && !wanted) state = 'Not rebuilt (this change does not affect it)';
    else if (r === 'skipped') state = 'Skipped (a job it depends on did not succeed)';
    else state = 'Did not run';
    let n = note ?? '';
    if (id === 'macos') n = notes.macosSigning === 'developer-id' ? 'Developer ID signed.' : 'Ad-hoc signed only: macOS asks you to confirm opening it. Developer ID signing and notarisation need Apple credentials that are not configured.';
    if (r !== 'success') n = id === 'verify' ? '' : (r === 'failure' ? 'See the job log. No artifact was produced.' : '');
    rows.push(`| ${label} | ${state} | ${n} |`);
  }
  const verdict = failed ? `**Not releasable: ${failed} job(s) failed or were cancelled.**` : built > 0 ? `All ${built} requested build(s) completed.` : 'No build was requested by this change.';
  const md = ['## Build summary', '', '| Build | Result | Notes |', '| --- | --- | --- |', ...rows, '', verdict, ...extra, ''].join('\n');
  return { md, ok: failed === 0, failed };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const needs = JSON.parse(process.env.NEEDS_JSON || '{}');
  const plan = JSON.parse(process.env.PLAN_JSON || '{}');
  const { md, ok } = renderSummary(needs, plan, { macosSigning: process.env.MACOS_SIGNING, vitest: process.env.VITEST_NOTE });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
  process.exit(ok ? 0 : 1);
}
