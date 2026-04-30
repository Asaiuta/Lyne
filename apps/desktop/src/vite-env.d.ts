/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUDIO_SERVER_URL?: string;
  readonly VITE_AUDIO_SERVER_WS_URL?: string;
  readonly VITE_AUDIO_SERVER_HOST?: string;
  readonly VITE_AUDIO_SERVER_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}