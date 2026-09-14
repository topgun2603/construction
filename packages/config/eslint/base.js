// Shared flat ESLint config. TypeScript strict, no `any` (spec §17).
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // `dist-worker` is the worker's own build output — it compiles separately because two Nest
    // watchers sharing one `dist` with `deleteOutDir` raced and died. It is gitignored, and
    // linting emitted JavaScript only produces noise about `exports` not being defined.
    ignores: [
      '**/dist/**',
      '**/dist-worker/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/*.config.js',
    ],
  },
];
