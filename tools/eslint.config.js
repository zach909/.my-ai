import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Scoped to src/ to match tsconfig.json's own `include: ["src"]` -- the
// Vite React frontend. Everything else in this repo (interface/,
// plugin_manager/, plugins/, etc.) is backend Node.js TypeScript with no
// React in it, so the react-hooks/react-refresh rules below wouldn't mean
// anything there; it has its own separate build (scripts/build-backend.mjs)
// and was never covered by this lint config either before or after this fix.
export default tseslint.config(
  { ignores: ['dist', 'vite-out'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactRefresh.configs.vite()],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // The two rules React codebases have used for years. Newer major
      // versions of this plugin bundle a much larger "React Compiler
      // readiness" rule family (purity, refs, immutability, ...) under
      // `configs.recommended`/`recommended-latest` -- opting into that
      // wholesale here, on a codebase that has never been linted before,
      // would surface dozens of pre-existing findings across the app that
      // need their own dedicated review, not a side effect of just wiring
      // up the config file that was missing entirely until now.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Standard convention for an intentionally-unused destructured element,
      // e.g. `.filter(([_, apps]) => ...)` when only the value is needed.
      '@typescript-eslint/no-unused-vars': ['error', { destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    // TanStack Router's file-based routes must export both a non-component
    // `Route` object and the route's component from the same file -- that's
    // the framework's own convention, not a fast-refresh mistake.
    files: ['src/routes/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // shadcn/ui-style primitives conventionally export a `cva` variants
    // helper (e.g. `buttonVariants`) alongside the component -- upstream
    // library convention, not app code meant to be fast-refresh-friendly.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
