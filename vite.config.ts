import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app is served from https://apps.unitedceres.edu.sg/ppd_converter/ via an
// nginx proxy_pass to 127.0.0.1:4020. Unlike gd4_simulator (a static alias with
// a relative base and hash routing), we own the server here, so an absolute base
// plus a real router basename gives working deep links into a document or job.
// BASE_PATH must stay in step with the Express mount point in server/index.ts
// and with the nginx location block.
export const BASE_PATH = '/ppd_converter'

export default defineConfig({
  plugins: [react()],
  base: `${BASE_PATH}/`,
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    // Dev only: the SPA runs on Vite while the API runs on the Express port, so
    // the browser talks to one origin and Vite forwards /api through.
    proxy: {
      [`${BASE_PATH}/api`]: 'http://127.0.0.1:4020',
    },
  },
})
