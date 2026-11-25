import { defineConfig } from 'vitest/config';

// Emulator tests: run with `npm run test:emulator` (starts Firestore + Auth emulators).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: { VITE_USE_EMULATOR: 'true', VITE_FIREBASE_PROJECT_ID: '', VITE_EMULATOR_FIRESTORE_PORT: '8085' },
  },
});
