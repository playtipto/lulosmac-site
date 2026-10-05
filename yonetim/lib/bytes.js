// Small byte helpers shared by the panel's server code (sign-in, Gmail token sealing, the automation key).
export function cat(a, b) {
  const u = new Uint8Array(a.length + b.length);
  u.set(a);
  u.set(b, a.length);
  return u;
}

export function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDec(text) {
  let s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
