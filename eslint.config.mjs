/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * ESLint configuration: recommended rules, browser and extension globals for
 * `src/`, service-worker globals for `src/background/`, browser globals for
 * the landing language script and Node.js globals for scripts, tests and the
 * landing build.
 */

import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';

export default [
  {ignores: ['build/**', 'dist/**', 'node_modules/**', 'vendor/**']},
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
    files: ['landing/**/*.ts'],
    languageOptions: {parser: tsParser},
    rules: {'no-undef': 'off'},
  },
  {
    files: ['*.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'landing/*.ts'],
    languageOptions: {globals: globals.node},
  },
];
