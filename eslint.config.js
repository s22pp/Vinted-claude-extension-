// Lint: correctness rules only (formatting and style are not linted). `npm run lint`.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/**', '.output-analyze/**', '.wxt/**', '.qa/**', 'extension/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TypeScript already checks these (noUnusedLocals, undefined names).
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  {
    // Playwright fixtures: `use` is Playwright's, and `({}, use)` is how a fixture without dependencies is written.
    files: ['tests/e2e/**/*.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off', 'no-empty-pattern': 'off' },
  },
  {
    // Node scripts.
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
  },
);
