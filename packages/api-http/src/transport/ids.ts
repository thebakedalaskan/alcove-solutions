export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
