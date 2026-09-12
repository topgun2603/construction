import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Tests for the dashboard.
 *
 * The suite is deliberately narrow. Most of this app is layout, and a test that asserts a heading
 * says "Sites" costs more to maintain than the bug it would ever catch. What is covered here is the
 * logic that decides *what a person is allowed to see and do* — the audience a message goes to,
 * whether the control that takes one back is drawn at all, which destinations appear in the
 * navigation — plus the arithmetic underneath the numbers on screen.
 *
 * Those are the places where being wrong is expensive rather than untidy: a note meant for the team
 * rendered into the client's thread, or a client handed a link to the builder's cost of the job.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['{app,components,lib,test}/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      // Mirrors the `@/*` path in tsconfig.json; Vitest does not read that itself.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
