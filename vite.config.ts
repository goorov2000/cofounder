import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    // Local reports, ledgers and browser profiles must not reload a conversation.
    watch: { ignored: ['**/.autopilot/**', '**/.repair/**', '**/.data/**', '**/.validation/**', '**/validation/**', '**/test-results/**', '**/playwright-report/**', '**/coverage/**', '**/docs/maintenance/**'] },
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
});
