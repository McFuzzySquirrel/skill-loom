import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/skills/loom-run-bundle/scripts',
    emptyOutDir: true,
    sourcemap: false,
    target: 'node24',
    lib: {
      entry: 'src/portable/cli.ts',
      formats: ['es'],
      fileName: 'loom-bundle',
    },
    rollupOptions: {
      external: /^node:/,
    },
  },
});
