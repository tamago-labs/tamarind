// Crypto-strong id for canvas entities. Always returns 32 lowercase hex
// chars (16 random bytes) so the renderer and the worker agree on the
// same id format end-to-end:
//   • renderer: optimistic add-item uses this id locally
//   • worker (Bare): encodes the same id into a 16-byte buffer with
//     `b4a.from(id, 'hex')`. UUIDs-with-dashes would either silently
//     truncate (Node) or throw "Invalid input" (Bare); a uniform
//     hex-only string dodges both.

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, '0')
    }
    return out
  }
  // Non-secure fallback — timestamp + base36 random tail.
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}
