/**
 * FILE: vite.config.ts
 * PURPOSE: Vite build + dev-server config for the CardStacks frontend.
 *          The dev proxy forwards /api to the Scala backend on Railway so
 *          local development needs no CORS setup; production builds call
 *          the backend directly via VITE_API_BASE (see src/api/client.ts).
 *          The 3D room's stylesheets (src/room3d) are scoped under `.room3d`
 *          so they can't restyle other pages (room3dCss.mjs), and the dev
 *          server answers /card-art like the production server does
 *          (cardArt.mjs).
 */
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import prefixer from 'postcss-prefix-selector'
import { serveCardArt } from './cardArt.mjs'
import { ROOM_ROOT, scopeRoomSelector } from './room3dCss.mjs'

/** Dev-only twin of server.mjs's /card-art route. */
const cardArtDev = (): Plugin => ({
  name: 'card-art-dev',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname !== '/card-art') return next()
      void serveCardArt(req, res, url.searchParams)
    })
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), cardArtDev()],
    css: {
      postcss: {
        plugins: [
          prefixer({
            prefix: ROOM_ROOT,
            includeFiles: [/[\\/]src[\\/]room3d[\\/]/],
            transform: (_prefix, selector) => scopeRoomSelector(selector),
          }),
        ],
      },
    },
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
