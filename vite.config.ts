import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Two builds from one codebase:
//   vite build              → GitHub Pages (backend-less). Set via CI: VITE_BASE_PATH=/<repo-name>/
//   vite build --mode aws   → hosted build behind CloudFront (.env.aws: VITE_DEPLOY=aws), base "/"
/** AWS build: static, public page the auth Lambda's logout ends on (CONTRACT: /signed-out.html). */
function signedOutPage(): Plugin {
  return {
    name: 'quizzer-signed-out-page',
    apply: 'build',
    generateBundle() {
      for (const f of ['signed-out.html']) {
        this.emitFile({ type: 'asset', fileName: f, source: readFileSync(new URL(`./src/aws/static/${f}`, import.meta.url)) });
      }
    },
  };
}

/** <title> must match the PWA manifest name (index.html itself keeps the Pages default). */
function htmlTitle(title: string): Plugin {
  return {
    name: 'quizzer-html-title',
    transformIndexHtml(html) {
      return html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const aws = env.VITE_DEPLOY === 'aws';
  const base = aws ? '/' : (process.env.VITE_BASE_PATH ?? '/');

  return {
    base,
    plugins: [
      react(),
      ...(aws ? [signedOutPage(), htmlTitle('Quizzer')] : []),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
        manifest: {
          name: aws ? 'Quizzer' : 'AWS Quizzer',
          short_name: 'Quizzer',
          description: aws ? 'Quizzer: practice tests' : 'AWS Developer Associate (DVA-C02) Practice Tests',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          ...(aws ? { start_url: '/', scope: '/' } : {}),
          icons: [
            { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
            { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
          cleanupOutdatedCaches: true,
          ...(aws
            ? {
                // CRITICAL: never answer /auth/* (e.g. /auth/callback), /data/* or /api/* navigations
                // with the cached index.html — they must reach CloudFront / the Lambda.
                navigateFallbackDenylist: [/^\/auth\//, /^\/data\//, /^\/api\//],
                // Private or session-bound: never cached by the service worker.
                runtimeCaching: [
                  { urlPattern: ({ url }) => url.pathname.startsWith('/data/'), handler: 'NetworkOnly' as const },
                  { urlPattern: ({ url }) => url.pathname.startsWith('/auth/'), handler: 'NetworkOnly' as const },
                  { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' as const },
                ],
              }
            : {}),
        },
      }),
    ],
  };
});
