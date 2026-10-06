import js from '@eslint/js';
import globals from 'globals';

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
    ],
  },
];
