declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    TURN_KEY_ID?: string;
    TURN_KEY_API_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
