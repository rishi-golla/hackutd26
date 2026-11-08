import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// host: true so phones and tablets on the same network can open the dev server.
// `npm run dev:https` serves over HTTPS with a self-signed certificate, which the bodycam needs for
// camera, mic and motion (secure context). Chrome shows a warning once; tap Advanced → Proceed.
//
// /hub/* is passed through to the Pi hub, so /hospital can show the bodycam's live frames without the hub having to
// allow cross-origin requests. HUB_URL (shell or .env*.local) picks the hub; the default is the Pi over Tailscale.
export default defineConfig(({ mode }) => {
  const hub = loadEnv(mode, '.', '').HUB_URL || 'http://handoff-pi:8000';
  const proxy = { '/hub': { target: hub, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/hub/, '') } };
  return {
    plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
    server: { host: true, proxy },
    preview: { proxy },
  };
});
