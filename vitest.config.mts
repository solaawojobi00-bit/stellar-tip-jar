import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    // Node by default; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock, so the lib suites stay fast.
    environment: 'node',
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
  },
});
