/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API's dev port (apps/api/src/main.ts: `process.env.PORT ?? 3000`,
// and PORT=3000 in apps/api/.env.example).
const API_DEV_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // `apiClient` builds request URLs from VITE_API_BASE_URL, which
    // defaults to '' (same-origin). These proxy entries make those
    // same-origin calls reach the API in dev, so no env var is needed
    // for the standard `npm run dev:api` + `npm run dev:web` setup.
    proxy: {
      '/auth': { target: API_DEV_TARGET, changeOrigin: true },
      '/health': { target: API_DEV_TARGET, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    mockReset: true,
  },
});
