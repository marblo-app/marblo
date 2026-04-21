import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      'firebase/firestore': new URL('./tests/mocks/firebase-firestore.ts', import.meta.url).pathname,
      'firebase/app': new URL('./tests/mocks/firebase-app.ts', import.meta.url).pathname,
    },
  },
});
