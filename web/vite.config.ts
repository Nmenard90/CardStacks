/**
 * FILE: vite.config.ts
 * PURPOSE: Vite build + dev-server config for the CardStacks frontend.
 *          The dev proxy forwards /api to the Scala backend on Railway so
 *          local development needs no CORS setup; production builds call
 *          the backend directly via VITE_API_BASE (see src/api/client.ts).
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'https://hospitable-courtesy-production-60a0.up.railway.app',
          changeOrigin: true,
        },
      },
    },
  }
})
