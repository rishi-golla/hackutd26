import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// host: true so phones and tablets on the same network can open the dev server.
// `npm run dev:https` serves over HTTPS with a self-signed certificate, which the bodycam needs for
// camera, mic and motion (secure context). Chrome shows a warning once; tap Advanced → Proceed.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: { host: true },
}));
