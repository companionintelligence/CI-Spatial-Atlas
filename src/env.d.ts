/// <reference types="vite/client" />

/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_ACCESS_TOKEN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
