/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_ALCOVE_API?: 'mock' | 'http';
  readonly VITE_ALCOVE_API_URL?: string;
}
