import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022'
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/Cesium')
  },
  server: {
    port: 5173,
    open: true
  }
});
