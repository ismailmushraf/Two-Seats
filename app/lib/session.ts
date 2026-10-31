// These headers are trusted only behind the Sites authentication gateway.
export function authenticatedUser(headers: Headers) {
  const userId = headers.get('oai-authenticated-user-id');
  const email = headers.get('oai-authenticated-user-email');
  if (!userId || !email) return null;
  let fullName: string | null = null;
  const encoded = headers.get('oai-authenticated-user-full-name');
  if (encoded && headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { fullName = decodeURIComponent(encoded).trim() || null; } catch { /* Fall back to verified email. */ }
  }
  return { userId, email, displayName: fullName ?? email };
}
