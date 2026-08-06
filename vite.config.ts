import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
      // /assets 由 Vite 直接从 public/ 服务；若代理到后端，新增的
      // public 资产必须重新 build 进 dist 才能被访问（dev 迭代时容易 404）。
    },
  },
});
