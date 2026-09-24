import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.PAGEVOICE_PORT || '8765'}`, '/v1': `http://127.0.0.1:${process.env.PAGEVOICE_PORT || '8765'}` } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.js'] },
})
