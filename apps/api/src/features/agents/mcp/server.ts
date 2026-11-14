/* The remote agent boundary never accepts a browser cookie as delegation. */
import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import type { Deps } from '../../../platform/context';
import { AuthError, ForbiddenError, TooLargeError, ValidationError, toAppError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import { authenticateAgent, issuerUrl, type AgentPrincipal } from '../service';
import { buildServer } from './tools';

const mlog = log.child({ component: 'agent-mcp' });
const MAX_BODY = 64 * 1024;

async function body(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) throw new TooLargeError('The MCP request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError('Send an MCP request body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => { mlog.debug('MCP body cancellation failed'); }); }, 5000);
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_BODY) { await reader.cancel(); throw new TooLargeError('The MCP request is too large.'); }
      chunks.push(part.value);
    }
    if (timedOut) throw new ValidationError('The MCP request body timed out.');
  } finally { clearTimeout(timeout); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (cause) { throw new ValidationError('The MCP request must use valid UTF-8.', { cause }); }
}

export async function handleMcp(d: Deps, request: Request): Promise<Response> {
  let principal: AgentPrincipal | undefined;
  const started = performance.now();
  try {
    const canonical = new URL(d.cfg.API_URL);
    const requested = new URL(request.url);
    const host = request.headers.get('host') ?? requested.host;
    // Tests and development may run a second loopback instance on another port; production stays on its configured host.
    const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
    const local = canonical.protocol === 'http:' && loopback.has(canonical.hostname) && requested.protocol === 'http:' && loopback.has(requested.hostname) && host === requested.host;
    if (host !== canonical.host && !local) throw new ForbiddenError('This MCP host is not allowed.');
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(d.cfg.WEB_ORIGIN).origin && origin !== canonical.origin) throw new ForbiddenError('This MCP origin is not allowed.');
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
    const authorization = request.headers.get('authorization');
    const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,256})$/i)?.[1];
    if (!bearer) throw new AuthError('Connect an agent with a valid bearer credential.');
    principal = await authenticateAgent(d, bearer);
    const text = await body(request);
    const principalForRequest = principal;
    const pending = new Set<Promise<unknown>>();
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const bounded = new Request(request.url, { method: 'POST', headers, body: text, signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]) });
    const finish = async (response: Response): Promise<Response> => {
      const bytes = await response.arrayBuffer();
      const outHeaders = new Headers(response.headers);
      outHeaders.set('cache-control', 'no-store');
      return new Response(bytes.byteLength ? bytes : null, { status: response.status, headers: outHeaders });
    };
    // v2's built-in legacy fallback always uses SSE. Use its official JSON transport for that era.
    if (await isLegacyRequest(bounded, undefined, { maxRequestBodySize: MAX_BODY })) {
      const server = buildServer(d, principalForRequest, pending);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY });
      try { await server.connect(transport); return await finish(await transport.handleRequest(bounded)); }
      finally { await Promise.allSettled(pending); await server.close(); }
    }
    // No notifications are emitted; auto mode produces complete JSON. Disable subscription streams entirely.
    const handler = createMcpHandler(() => buildServer(d, principalForRequest, pending), { maxSubscriptions: 0, maxRequestBodySize: MAX_BODY });
    try { return await finish(await handler.fetch(bounded)); }
    finally { await Promise.allSettled(pending); await handler.close(); }
  } catch (error) {
    const app = toAppError(error);
    mlog.at(app.level, 'agent MCP request refused', { code: app.code, ms: Math.round(performance.now() - started) });
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    if (app.status === 401) headers.set('www-authenticate', `Bearer resource_metadata="${issuerUrl(d)}/.well-known/oauth-protected-resource/mcp"`);
    return new Response(JSON.stringify({ error: { code: app.code, message: app.code === 'unknown' ? 'Alcove could not complete the MCP request.' : app.message } }), { status: app.status, headers });
  } finally { principal?.owner.root.fill(0); principal?.owner.wrapKey.fill(0); }
}
