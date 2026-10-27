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
}

export const now = () => Date.now();
