import js from '@eslint/js';
import globals from 'globals';

// ESLint owns every JavaScript directory: public/js, server, scripts and test.
// It deliberately does not lint the TypeScript frontend under `src/`. ESLint
// cannot parse TypeScript without a TS parser, and the only maintained one,
// typescript-eslint, caps its peer range at `typescript <6.1.0` and hard-errors
// on the TypeScript 7 this repo runs ("typescript-eslint does not support TS 7.0"),
// so there is no ESLint parser that can open these files. `src/` is linted by
// Biome, the repo's installed TypeScript-aware linter, which the `lint` script
// runs after ESLint — so `npm run lint` still covers every source directory.
// The globs below only make that split explicit; ESLint would skip them anyway.

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-duplicate-imports': 'error',
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'warn',
      'require-await': 'off',
    },
  },
  {
    // Frontend browser & vanilla scripts
    files: ['public/js/**/*.js', 'public/wire.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // Backend server code
    files: ['server/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Scripts (Playwright runners + adapter check scripts)
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-await-in-loop': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      '.next/',
      'data/',
      '.worktrees/',
      '.opencode/',
      'artifacts/',
      'docs/',
      '**/*.min.js',
      // Linted by Biome through the `lint` script, not ESLint (see the note
      // at the top of this file): ESLint has no TypeScript 7 parser.
      'src/**/*.ts',
      'src/**/*.tsx',
    ],
  },
];
