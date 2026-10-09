/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'pages' (GitHub Pages, backend-less) or 'aws' (hosted build, see .env.aws). */
  readonly VITE_DEPLOY: 'pages' | 'aws';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
