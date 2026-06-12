import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'https://hospitable-courtesy-production-60a0.up.railway.app',
        changeOrigin: true,
      },
    },
  },
})
