import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `npm run dev`, Vite serves the editor and forwards the account pages
// and API to the DropToApp server (server/index.ts).
const server = `http://127.0.0.1:${process.env.PORT || 3000}`;

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app also works from a sub-folder.
  base: './',
  server: {
    proxy: {
      '/api': server,
      '/login': server,
    },
  },
});
