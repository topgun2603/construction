import nextPlugin from '@next/eslint-plugin-next';
import base from '@sitebook/config/eslint/base';

/*
 * `next lint` and `eslint-config-next` are eslintrc-era: the former is deprecated in
 * Next 15 and the latter cannot patch ESLint 9. So the Next rules are pulled in from
 * the plugin directly on top of the shared base config, and `eslint .` runs them.
 */
export default [
  ...base,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    // Build config files are plain Node modules, not TypeScript, so they do not get
    // the TS override that switches off `no-undef`.
    files: ['*.mjs', '*.js', '*.config.ts'],
    languageOptions: {
      globals: { process: 'readonly', __dirname: 'readonly', module: 'writable' },
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
];
