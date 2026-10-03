/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_VERGE_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
