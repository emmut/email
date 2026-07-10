export interface Account {
  id: string;
  kind: "google" | "icloud";
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  is_default: boolean;
}

export interface GoogleAccountConfig {
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
}

export interface IcloudAccountConfig {
  app_password: string;
  imap_server: string;
  imap_port: number;
  smtp_server: string;
  smtp_port: number;
}

export type AccountConfig = { kind: "google" } & GoogleAccountConfig | { kind: "icloud" } & IcloudAccountConfig;