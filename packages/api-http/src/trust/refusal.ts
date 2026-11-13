/* Why a check of the server didn't pass. Neither leaves verifyServer: it answers `unverified` with the reason. */

/** A check that failed, with the short sentence that says why, which the app may show. */
export class Refused extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.name = 'Refused'; this.reason = reason; }
}

/** Evidence that isn't in the shape it should be: the stage reading it says what that means (`stage`). */
export class Unreadable extends Error {
  constructor(what: string) { super(`unreadable ${what}`); this.name = 'Unreadable'; }
}

/** Runs one stage of the check: anything that goes wrong in it but a refusal is refused with `unreadable`. */
export async function stage<T>(unreadable: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) { throw e instanceof Refused ? e : new Refused(unreadable); }
}
