/*
 * ESLint flat config — unit 16 (A2), config-only enforcement.
 *
 * DEPENDENCY NOTE (deps are installed out-of-manifest on purpose):
 *   npm install --no-save --cache ./.npm-cache \
 *     eslint@^9 eslint-plugin-react-hooks@^6 eslint-plugin-jsx-a11y@^6 typescript-eslint@^8
 * `npm ping` works in this env but the default cache dir is ROFS; redirect it.
 * package.json/package-lock.json are intentionally untouched — a future owner
 * of deps should add these four as devDependencies to make CI enforce it.
 * Without node_modules present, this config is inert; the rule set below is the
 * documented proposal either way.
 *
 * Scope: app/src/**. Audit/scratch *.mjs at the app root are node scripts, not
 * lint targets. Motivation: hooks-after-early-return produced a live React #310
 * in unit 15 — rules-of-hooks is the guard that class needs.
 */
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.npm-cache/**', '*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      /* the unit-15 #310 class: hooks after early returns */
      'react-hooks/rules-of-hooks': 'error',
      /* drift between renders and their data deps — warn so fixes stay deliberate */
      'react-hooks/exhaustive-deps': 'warn',
      /* keyboard/AT correctness (APG) — pairs with the unit-16 Modal focus work */
      ...jsxA11y.configs.recommended.rules,
      /* house style already handles these via tsc/strict; keep signal high */
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
