import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Rendering code mutates three.js objects inside useFrame callbacks by design (D-043); the
    // React Compiler immutability/purity rules do not fit that model. Renderer modules also export
    // helpers alongside components.
    files: ['src/render/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // The simulation must be pure and deterministic.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', '@react-three/*', 'react', 'react-dom', 'zustand'],
              message: 'src/sim must stay pure: no rendering/UI/state libraries.',
            },
            {
              group: ['../render/*', '../ui/*', '../state/*'],
              message: 'src/sim must not depend on render/ui/state.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/sim/rng.ts.' },
        {
          object: 'Date',
          property: 'now',
          message: 'Simulation time comes from game state, not the wall clock.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'Simulation time comes from game state, not the wall clock.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'No wall-clock dates inside src/sim.',
        },
      ],
      'no-restricted-globals': ['error', 'document', 'window', 'localStorage'],
    },
  },
  {
    // Worker timing and test benchmarks may read the wall clock; the simulation itself may not.
    files: ['src/sim/worker.ts', 'src/sim/**/*.test.ts'],
    rules: { 'no-restricted-properties': 'off', 'no-console': 'off' },
  },
);
