/*
 * zod, set up once for everything in this package: parse without compiling code at runtime (no
 * `new Function`), because the web app's Content-Security-Policy allows no eval. Every module here
 * imports `z` from this file, so this runs before any schema is built.
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
