import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 800 },
  server: {
    port: 5173,
    host: true, // im Lab-Netz vom Tablet aus erreichbar
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
