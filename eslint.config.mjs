// ESLint (flat config): TypeScript's recommended rules and React's rules of hooks.
// `npm run lint` checks; `npm run lint -- --fix` fixes what it can.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'build/**', '_handoff/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.{js,mjs,cjs,ts,mts}'],
    languageOptions: { globals: globals.node }
  },
  {
    rules: {
      // `_name` marks an argument or value that's deliberately unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // TypeScript checks names itself (and knows the DOM and Node types).
      'no-undef': 'off',
      // Empty catch blocks here always carry a comment on why.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
)
