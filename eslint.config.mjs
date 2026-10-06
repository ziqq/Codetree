import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['build/**', 'dist/**', 'node_modules/**']},
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {sourceType: 'module', globals: {...globals.browser, ...globals.webextensions}},
    rules: {'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error'},
  },
  {
    files: ['src/background/**/*.js'],
    languageOptions: {globals: {...globals.serviceworker, ...globals.webextensions}},
  },
  {
    files: ['*.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {globals: globals.node},
  },
];
