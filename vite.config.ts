import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Cesium static asset handling: copy required directories if present.
// For now we just alias cesium for simpler imports; advanced usage may need plugin to copy Workers.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Cesium expects these sometimes; stub if needed
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  build: {
    sourcemap: true,
    target: 'esnext'
  }
});
