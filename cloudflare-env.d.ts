declare namespace Cloudflare {
  interface Env {
    DIAGNOSTICS_OWNER_EMAIL?: string;
    DB?: D1Database;
    TURN_KEY_ID?: string;
    TURN_KEY_API_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
