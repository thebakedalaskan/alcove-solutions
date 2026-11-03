/*
 * zod, set up once for everything that imports the contract: parse without compiling code at
 * runtime (no `new Function`), because the web app's Content-Security-Policy allows no eval. Every
 * contract module imports `z` from here, so this runs before any schema is built.
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
