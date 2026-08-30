import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Minimal config for the backend describe/it-style test suites
// (test/integration.test.ts, test/core/system-tests.test.ts) that were
// never wired to any runner. Deliberately does NOT reuse vite.config.ts —
// these are plain Node/TS backend tests with no need for the
// TanStack Start / React / Tailwind plugins there, and pulling those in
// would drag SSR/prerender concerns into a backend unit-test run.
//
// NEUROCLAW_GENERATED_DIR redirects every self-authored skill/plugin/
// prompt a test creates (SkillMakerExtension, PluginMakerExtension,
// UniversalLanguageSkill, SkillLibrary/PluginLibrary/PromptLibrary's
// defaults, src/index.ts's selfAuthoredSkills()) into one real scratch
// directory for this whole run, instead of this repo's own generated/ --
// those are meant to be genuinely public/committed content, and a test
// run creating dozens of throwaway "zzz test fixture ..." skills directly
// in the working tree is exactly the kind of pollution that shouldn't
// happen just from running the suite.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      NEUROCLAW_GENERATED_DIR: mkdtempSync(join(tmpdir(), 'neuroclaw-vitest-generated-')),
    },
  },
});
