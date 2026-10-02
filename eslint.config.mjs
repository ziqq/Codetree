import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['dist/**', 'node_modules/**']},
  js.configs.recommended,
  {
    files: ['*.js'],
    languageOptions: {sourceType: 'script', globals: {...globals.browser, ...globals.webextensions}},
    rules: {'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error'},
  },
  {
    files: ['background.js', 'gitlab.js'],
    languageOptions: {globals: {...globals.serviceworker, ...globals.webextensions}},
  },
  {
    files: ['*.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {globals: globals.node},
  },
];
