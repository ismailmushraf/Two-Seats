import { env } from 'cloudflare:workers';
import { authenticatedUser } from '../../lib/session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
  const user = authenticatedUser(request.headers);
  if (!user) return Response.json({ authenticated: false }, { status: 401, headers });
  let available = false;
  try {
    if (env.DB) {
      // Verify the provisioned schema, not just that a DB binding exists.
      await env.DB.prepare('SELECT id FROM rooms LIMIT 1').all();
      available = true;
    }
  } catch { /* Never expose infrastructure details to the browser. */ }
  return Response.json({ authenticated: true, user: { email: user.email, displayName: user.displayName }, roomService: { available } }, { headers });
}
