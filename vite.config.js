import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // `host: true` binds the dev/preview server to 0.0.0.0 (all network
  // interfaces) instead of just localhost, so other devices on the same LAN can
  // reach it. Vite prints a "Network:" URL (e.g. http://192.168.x.x:5173) on
  // start — open that from another device.
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
