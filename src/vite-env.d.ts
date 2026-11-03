/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_MODE?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_DONATION_VAULT_ADDRESS?: string;
  readonly VITE_DAO_GOVERNOR_ADDRESS?: string;
  readonly VITE_AUDIT_REGISTRY_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
