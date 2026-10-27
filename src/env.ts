export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  AI: AiBinding;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OWNER_EMAIL: string;
  APP_SECRET: string;
  /** Optional overrides, used only for local testing against a mock server. */
  YT_API_BASE?: string;
  GOOGLE_TOKEN_URL?: string;
}

export const now = () => Date.now();
