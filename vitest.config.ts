import { defineConfig } from 'vitest/config';

// Frontend unit tests run in jsdom so pure helpers that touch `localStorage`/`window`
// (e.g. sessions.ts persistence) work without a real browser. Setup stubs the bits
// jsdom omits (matchMedia).
export default defineConfig({
  // config.ts references __APP_VERSION__, normally injected by vite.config's `define`.
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
});
