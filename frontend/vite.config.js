import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1996,
    proxy: {
      '/api': 'http://localhost:1997',
    },
  },
});
