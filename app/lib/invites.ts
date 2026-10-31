export type RoomInvite = { id: string; token: string; url: string };
// The secret stays in the fragment: never send it as a URL query or pathname.
export function parseRoomInvite(value: string, origin: string): RoomInvite | null {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.pathname !== '/') return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    const id = fragment.get('room'), token = fragment.get('key');
    if (!id || !/^[a-f0-9]{32}$/.test(id) || !token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return { id, token, url: `${origin}/#room=${id}&key=${token}` };
  } catch { return null; }
}
