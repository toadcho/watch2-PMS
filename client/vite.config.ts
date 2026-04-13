import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    hmr: {
      host: 'localhost',
      port: 5174,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3100',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3100',
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
    },
  },
})
