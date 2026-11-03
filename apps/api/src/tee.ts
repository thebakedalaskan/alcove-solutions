/*
 * Running inside a confidential VM: Intel TDX under Phala's dstack (docs: privacy-keys-and-sessions ›
 * Moving to confidential computing). The dstack guest agent answers on a Unix socket only the VM can
 * reach. Its key service derives keys from this app's identity and gives them only to a VM whose
 * measured build the app's key policy allows, so KMASTER and KSERVICE never exist in the environment, a
 * secret manager or the deploy pipeline. And it produces TDX quotes, so anyone can check what is
 * running before trusting it.
 */
import type { Attestation } from '@alcove/api';
import { request } from 'node:http';
import { sha512 } from '@noble/hashes/sha2.js';
import { z } from 'zod';
import type { Config } from './config';
import { b64u, utf8 } from './crypto';
import { UnavailableError } from './errors';
import { log } from './log';

const tlog = log.child({ component: 'tee' });

const Hex = z.string().regex(/^[0-9a-fA-F]*$/);
const KeyReply = z.object({ key: Hex.min(64), signature_chain: z.array(Hex) });
const QuoteReply = z.object({ quote: Hex.min(2), event_log: z.string(), vm_config: z.string().optional() });
const InfoReply = z.object({ app_id: z.string(), instance_id: z.string(), compose_hash: z.string().optional(), os_image_hash: z.string().optional() });

/**
 * One call to the guest agent: a JSON POST over its Unix socket. Never a network address: only the VM
 * can reach the socket, so keys and quotes can't come from anywhere else.
 */
function rpc(socket: string, path: string, body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, host: 'localhost', path, method: 'POST', timeout: 10_000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) { reject(new Error(`The TEE guest agent refused ${path} (${res.statusCode ?? 'no status'}).`)); return; }
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`The TEE guest agent didn’t answer ${path} in time.`)));
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * The server's two keys, derived by the TEE's key service from this app's identity: the same for every
 * build the app's key policy allows, and given to nothing else.
 */
export async function teeKeys(socket: string): Promise<{ KMASTER: string; KSERVICE: string }> {
  const derive = async (path: string) => {
    const r = KeyReply.parse(await rpc(socket, '/GetKey', { path, purpose: 'alcove', algorithm: 'secp256k1' }));
    return b64u(Buffer.from(r.key, 'hex').subarray(0, 32));
  };
  const keys = { KMASTER: await derive('alcove/kmaster/v1'), KSERVICE: await derive('alcove/kservice/v1') };
  tlog.info('keys derived inside the TEE');
  return keys;
}

/** The 64 bytes a quote vouches for: the caller's nonce and the build, so a quote can't be replayed or borrowed by another build. */
export const reportData = (nonce: string, commit: string): Uint8Array => sha512(utf8(`alcove-attestation/v1\n${nonce}\n${commit}`));

/** A TDX quote over `data`, with the event log that lets a verifier replay the app's measurements. */
export async function quote(socket: string, data: Uint8Array): Promise<z.infer<typeof QuoteReply>> {
  return QuoteReply.parse(await rpc(socket, '/GetQuote', { report_data: Buffer.from(data).toString('hex') }));
}

/** This app's identity as the TEE knows it: its app ID, instance, and the hash of the compose it runs. */
export async function info(socket: string): Promise<z.infer<typeof InfoReply>> {
  return InfoReply.parse(await rpc(socket, '/Info', {}));
}

/** What's running, for a verifier's nonce: plainly "not in a TEE", or a fresh quote bound to the nonce and this build. */
export async function attest(cfg: Config, nonce: string): Promise<Attestation> {
  const build = { commit: cfg.ALCOVE_COMMIT };
  if (cfg.TEE === 'none') return { tee: 'none', nonce, build };
  const data = reportData(nonce, cfg.ALCOVE_COMMIT);
  try {
    const [q, i] = await Promise.all([quote(cfg.DSTACK_SOCKET, data), info(cfg.DSTACK_SOCKET)]);
    return {
      tee: 'dstack', nonce, build, reportData: Buffer.from(data).toString('hex'), quote: q.quote, eventLog: q.event_log, appId: i.app_id, instanceId: i.instance_id,
      ...(i.compose_hash ? { composeHash: i.compose_hash } : {}), ...(i.os_image_hash ? { osImageHash: i.os_image_hash } : {})
    };
  } catch (e) {
    throw new UnavailableError('This server can’t attest to itself right now.', { cause: e, context: { tee: cfg.TEE } });
  }
}
