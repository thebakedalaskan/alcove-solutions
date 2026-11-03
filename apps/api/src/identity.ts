/** Who a sign-in says someone is: the provider's account, a verified email, a name and a photo. */
export interface Identity {
  /** Unique per provider account, e.g. "google:104412…". Only its keyed hash is stored. */
  subject: string;
  /** Lower-cased. Notes are shared by email, so it must be one the provider has verified. */
  email: string;
  name: string;
  photoUrl?: string | undefined;
  /** A demo identity, which comes with a sample calendar and company directory. */
  sample: boolean;
}

/** A name to show when a provider doesn't give one: "priya.raman@lumen.health" → "Priya Raman". */
export const nameFrom = (email: string) =>
  (email.split('@')[0] ?? email).split(/[._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || email;
