/*
 * The operator CLI's shared parts: its options, the key file, signed requests, prompts and printing, and its core commands
 * (keygen, whoami, feature-flags). It runs on an operator's own machine and needs no .env: it reads only its options,
 * ALCOVE_OPERATOR_API, ALCOVE_OPERATOR_KEY and the key file. Each command is a CliCommand, and operator-cli.ts lists them.
 * It never prints, logs or sends the private key: only signatures leave the machine.
 *
 * Whatever the server sends is shown, never acted on: every string in an answer, a refusal or a header has what a terminal
 * would act on (control characters, line breaks among them, and the marks that reorder text) replaced before it's printed,
 * and --json escapes them, so nothing anyone got into what the server says can clear, rewrite or retitle an operator's
 * terminal, or reach their clipboard.
 */
import { REQUEST_ID_HEADER } from '@alcove/api';
import { randomBytes, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { INSTANCE_HEADER, REASON, REASON_SHAPE, authorization, bodyHash, makeKeyFile, openKeyFile, sign } from '../../../keys/operator-keys';
import { LinesAnswer } from '../../../http/operator';
import { WhoamiAnswer } from '../wire';

/** What a command works with: signed calls to the API, a line to print, whether to print JSON, the action's reason, prompts. */
export interface CliContext {
  call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown; requestId: string; instance: string | undefined }>;
  say(line: string): void;
  json: boolean;
  reason: string | undefined;
  prompt(question: string, hidden: boolean): Promise<string>;
  /** Where the operator's key is kept (--key), which keygen writes. */
  keyPath: string;
}
/** One command: the words that name it, its usage line, and what it does with the words after them. Returns the exit code. */
export interface CliCommand { words: readonly string[]; usage: string; run(ctx: CliContext, args: string[]): Promise<number> }

/** A private key and the ID the server knows it by. */
export interface SigningKey { keyId: string; privateKey: KeyObject }
/** A request to sign: the path is the API's own (`/v1/operator/…` and its query), as the API receives it. */
export interface Unsigned { audience: string; method: string; path: string; body: Uint8Array; time?: number | undefined; nonce?: string | undefined }
/**
 * The Authorization header that signs one request (operator-keys.ts › canonical), at the time now with a fresh nonce
 * unless given.
 */
export function signRequest(key: SigningKey, r: Unsigned): string {
  const time = r.time ?? Date.now();
  const nonce = r.nonce ?? randomBytes(16).toString('base64url');
  return authorization(key.keyId, time, nonce, sign(key.privateKey, { audience: r.audience, method: r.method, path: r.path, time, nonce, bodySha256: bodyHash(r.body) }));
}

/** A refusal the CLI says in words: no key, a passphrase that doesn't open it, a server out of reach. */
class CliError extends Error {}

const DEFAULT_API = 'https://api.alcove.solutions';

/** What a terminal acts on rather than shows: C0 and C1 controls and DEL, and the marks that reorder text. */
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** Those that JSON.stringify leaves as they are: it escapes the C0 controls only. */
const UNESCAPED = /[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** A string as a terminal is given it: whatever it would act on, a line break included, is shown as �. */
export const printable = (s: string): string => s.replace(UNPRINTABLE, '\uFFFD');
/** A server's answer with every string in it, names of fields included, made printable: what the text printers are given. */
export function printableJson(v: unknown): unknown {
  if (typeof v === 'string') return printable(v);
  if (Array.isArray(v)) return v.map(printableJson);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [printable(k), printableJson(x)]));
  return v;
}
/** An answer as --json prints it: as the server sent it, with what JSON.stringify leaves unescaped escaped too. */
const jsonText = (v: unknown): string => JSON.stringify(v, null, 2).replace(UNESCAPED, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
/** Each line as a terminal is given it: the CLI's own line breaks kept, and nothing else it would act on. */
const shown = (text: string): string => text.split('\n').map(printable).join('\n');
const say = (line: string) => { process.stdout.write(`${shown(line)}\n`); };
const warn = (line: string) => { process.stderr.write(`${shown(line)}\n`); };
const ok = (status: number) => status >= 200 && status < 300;

/**
 * Says what the server answered and returns the exit code: for a 2xx, the answer as the server sent it with --json, or else
 * as `lines` puts it, given the answer with every string in it printable; 0. For anything else 1, which the call has said.
 */
export function answered(ctx: CliContext, r: { status: number; body: unknown }, lines: (body: unknown) => string[]): number {
  if (!ok(r.status)) return 1;
  if (ctx.json) { ctx.say(jsonText(r.body)); return 0; }
  for (const line of lines(printableJson(r.body))) ctx.say(line);
  return 0;
}
/** Says how a command goes, for words it doesn't take, and returns 2: nothing was sent. */
export function usage(c: CliCommand): 2 {
  warn(`usage: operator ${c.usage}`);
  return 2;
}
/** An action's reason (--reason), as the server checks it: without one that is a ticket's reference, nothing is sent. */
export function reasonOf(ctx: CliContext): { reason: string } | undefined {
  if (ctx.reason !== undefined && REASON.test(ctx.reason)) return { reason: ctx.reason };
  warn(`That needs --reason <ref>: ${REASON_SHAPE}. Nothing was sent.`);
  return undefined;
}

/** Labels and values in two columns, as the diagnostics print. */
export function aligned(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${`${label}:`.padEnd(width + 2)}${value}`);
}

/** Asks on the terminal, the answer hidden as it's typed when `hidden`. The question goes to stderr, never stdout. */
async function prompt(question: string, hidden: boolean): Promise<string> {
  const muted = { on: false };
  const output = new Writable({
    write(chunk: unknown, _encoding, done) {
      if (!muted.on && (typeof chunk === 'string' || chunk instanceof Uint8Array)) process.stderr.write(chunk);
      done();
    }
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });
  try {
    const answer = rl.question(question);
    muted.on = hidden;
    return await answer;
  } finally {
    rl.close();
    if (hidden) process.stderr.write('\n');
  }
}

/** The key in the key file, opened once: a sealed one asks for its passphrase, which needs a terminal. */
async function openKey(path: string): Promise<SigningKey> {
  const text = await readFile(path, 'utf8').catch((e: unknown) => {
    const code = e instanceof Error && 'code' in e ? String(e.code) : 'unreadable';
    throw new CliError(code === 'ENOENT' ? `There’s no operator key at ${path}. Make one with: operator keygen` : `Your operator key at ${path} can’t be read (${code}).`, { cause: e });
  });
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch (e) {
    throw new CliError(`${path} isn’t an operator key file.`, { cause: e });
  }
  const passphrase = () => (process.stdin.isTTY ? prompt('Passphrase for your operator key: ', true)
    : Promise.reject(new CliError('Your operator key is sealed with a passphrase, and there’s no terminal to ask for it in.')));
  return openKeyFile(file, passphrase).catch((e: unknown) => { throw e instanceof CliError ? e : new CliError(e instanceof Error ? e.message : 'Your operator key won’t open.', { cause: e }); });
}

/** The server's refusal in words: its message, and which fields it took issue with, each as a terminal is given it. */
function refusal(answer: unknown, text: string, status: number): string[] {
  if (typeof answer === 'object' && answer !== null && 'message' in answer && typeof answer.message === 'string') {
    const issues = 'issues' in answer && Array.isArray(answer.issues) ? answer.issues.filter((i): i is string => typeof i === 'string') : [];
    return [printable(answer.message), ...issues.map((i) => `  ${printable(i)}`)];
  }
  // Not the API's own answer: what a proxy in front of it says, its first 500 characters on one line.
  return [printable(text.trim().slice(0, 500)) || `The server answered ${status}.`];
}
const parsed = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    // Not JSON: what a proxy in front of the API may answer. It's said as it came.
    return text;
  }
};

interface Options { api: string; audience: string; keyPath: string; json: boolean; reason: string | undefined }
const VALUED = new Set(['--api', '--audience', '--key', '--reason']);
/** The options, wherever they are among the words, and the words left: a command's, and its own flags (--minutes). */
function optionsOf(argv: string[], env: NodeJS.ProcessEnv): { options: Options; words: string[] } | string {
  const given = new Map<string, string>();
  const words: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--') { words.push(...argv.slice(i + 1)); break; }
    if (arg === '--json') { json = true; continue; }
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    if (!VALUED.has(name)) { words.push(arg); continue; }
    const value = name === arg ? argv[++i] : arg.slice(eq + 1);
    if (!value) return `${name} needs a value.`;
    given.set(name, value);
  }
  const api = (given.get('--api') ?? (env['ALCOVE_OPERATOR_API'] || DEFAULT_API)).replace(/\/+$/, '');
  if (!URL.canParse(api) || !/^https?:$/.test(new URL(api).protocol)) return '--api must be the API’s http or https URL.';
  const audience = given.get('--audience') ?? api;
  if (!URL.canParse(audience)) return '--audience must be the API’s origin, such as https://api.alcove.solutions.';
  const keyPath = given.get('--key') ?? (env['ALCOVE_OPERATOR_KEY'] || join(homedir(), '.config', 'alcove', 'operator-key.json'));
  return { options: { api, audience: new URL(audience).origin, keyPath, json, reason: given.get('--reason') }, words };
}

function contextOf(o: Options): CliContext {
  let key: Promise<SigningKey> | undefined;
  return {
    json: o.json, reason: o.reason, keyPath: o.keyPath, say, prompt,
    async call(method, path, body) {
      key ??= openKey(o.keyPath);
      const signing = await key;
      const bytes = body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body));
      const headers = new Headers({ authorization: signRequest(signing, { audience: o.audience, method, path, body: bytes }) });
      if (body !== undefined) headers.set('content-type', 'application/json');
      const res = await fetch(`${o.api}${path}`, { method, headers, ...(body === undefined ? {} : { body: bytes }) }).catch((e: unknown) => {
        const cause = e instanceof Error && e.cause instanceof Error && 'code' in e.cause ? ` (${String(e.cause.code)})` : '';
        throw new CliError(`Couldn’t reach ${o.api}${cause}.`, { cause: e });
      });
      const text = await res.text();
      const answer = parsed(text);
      const requestId = printable(res.headers.get(REQUEST_ID_HEADER) ?? 'unknown');
      const sentInstance = res.headers.get(INSTANCE_HEADER);
      const instance = sentInstance === null ? undefined : printable(sentInstance);
      if (!ok(res.status)) {
        for (const line of refusal(answer, text, res.status)) warn(line);
        // A signed time out of the server's minute is refused like any other: its Date says whether the clock is why.
        const date = Date.parse(res.headers.get('date') ?? '');
        const off = Math.round((Date.now() - date) / 1000);
        if (res.status === 401 && Number.isFinite(off) && Math.abs(off) > 60) warn(`Your clock is ${Math.abs(off)} s off the server's.`);
      }
      warn(instance === undefined ? `Request ${requestId}` : `Request ${requestId} on ${instance}`);
      return { status: res.status, body: answer, requestId, instance };
    }
  };
}

const usageOf = (commands: readonly CliCommand[]): string => [
  'usage: operator <command> [--api <url>] [--audience <origin>] [--key <file>] [--json] [--reason <ref>]', '',
  ...commands.map((c) => `  operator ${c.usage}`)
].join('\n');

/** Runs the command `argv` names, and returns the exit code: 0 when the server answered 2xx, 1 otherwise, 2 for words that aren't a command. */
export async function runCli(argv: string[], commands: readonly CliCommand[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const given = optionsOf(argv, env);
  if (typeof given === 'string') { warn(given); warn(usageOf(commands)); return 2; }
  // The command whose words come first, the longest that does: `account find` before `account`.
  const command = commands.filter((c) => c.words.every((w, i) => given.words[i] === w)).sort((a, b) => b.words.length - a.words.length)[0];
  if (!command) { warn(usageOf(commands)); return 2; }
  try {
    return await command.run(contextOf(given.options), given.words.slice(command.words.length));
  } catch (e) {
    warn(e instanceof CliError ? e.message : `That failed: ${e instanceof Error ? e.message : 'something went wrong'}`);
    return 1;
  }
}

const keygen: CliCommand = {
  words: ['keygen'],
  usage: 'keygen [--no-passphrase]                  makes your key, sealed with a passphrase, and says the line env.sh lists it by',
  async run(ctx, args) {
    const bare = args.includes('--no-passphrase');
    if (args.some((a) => a !== '--no-passphrase')) return usage(keygen);
    if (existsSync(ctx.keyPath)) {
      warn(`There’s a key at ${ctx.keyPath} already, and keygen never overwrites one. Move it away first, or name another file with --key.`);
      return 1;
    }
    let passphrase: string | null = null;
    if (!bare) {
      if (!process.stdin.isTTY) { warn('keygen asks for a passphrase, and there’s no terminal to ask in. Run it in one, or give --no-passphrase.'); return 1; }
      const first = await ctx.prompt('Passphrase for the new key: ', true);
      if (!first) { warn('A passphrase can’t be empty. For a key without one, give --no-passphrase.'); return 1; }
      if ((await ctx.prompt('The same passphrase again: ', true)) !== first) { warn('Those passphrases don’t match. Nothing was written.'); return 1; }
      passphrase = first;
    }
    const { file } = makeKeyFile(passphrase);
    await mkdir(dirname(ctx.keyPath), { recursive: true, mode: 0o700 });
    // `wx`: never over a file that's there, even one made since the check above.
    await writeFile(ctx.keyPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    ctx.say(`Key ID: ${file.keyId}`);
    ctx.say(`Public key: ${file.publicKey}`);
    ctx.say(`For env.sh: read:${file.publicKey}  (or write:${file.publicKey})`);
    return 0;
  }
};

const whoami: CliCommand = {
  words: ['whoami'],
  usage: 'whoami                                   your key’s ID and scope, as the server sees them',
  async run(ctx, args) {
    if (args.length) return usage(whoami);
    return answered(ctx, await ctx.call('GET', '/v1/operator/whoami'), (body) => {
      const a = WhoamiAnswer.parse(body);
      return aligned([['Key', a.keyId], ['Scope', a.scope], ['Instance', a.instance], ['Server time', a.at]]);
    });
  }
};

const featureFlags: CliCommand = {
  words: ['feature-flags'],
  usage: 'feature-flags <words…> [--reason <ref>]  what feature-flags takes; a change, or asking about an address, needs a write key and a reason',
  async run(ctx, args) {
    if (!args.length) return usage(featureFlags);
    // Listing needs no reason, so the server says when one was needed; one given that isn't a ticket's is never sent.
    const reason = ctx.reason === undefined ? {} : reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', '/v1/operator/feature-flags', { words: args, ...reason }), (body) => LinesAnswer.parse(body).lines);
  }
};

/** The commands every operator has: making a key, checking it, and feature flags. */
export const core: CliCommand[] = [keygen, whoami, featureFlags];
