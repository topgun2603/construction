const base = require('@sitebook/config/eslint/base');

module.exports = [
  ...base,
  {
    rules: {
      /*
       * Off for the API specifically.
       *
       * NestJS resolves constructor dependencies from the metadata TypeScript emits
       * for parameter types, which means the class has to be a *value* import. The
       * rule sees a service used only in a parameter position and suggests
       * `import type` — and `--fix` would take it, erasing the runtime reference and
       * breaking dependency injection with a "Nest can't resolve dependencies"
       * error at boot rather than a compile failure.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
