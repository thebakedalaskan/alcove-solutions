import { AgentAuthorizeInputSchema, AgentClientInputSchema, AgentDecisionInputSchema, AgentRevokeBodySchema, AgentTokenBodySchema, AgentTokenInputSchema } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { ZodError } from 'zod';
import { log } from '../../log';
import { body, capped } from '../../http/body';
import { clientAddress, type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';
import * as agents from './service';
import * as agentOAuth from './oauth';
import { handleMcp } from './mcp/server';

const rlog = log.child({ component: 'http' });

/** Public OAuth/MCP boundaries precede browser-session and operation-receipt middleware. */
export function registerAgentPublicRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { limiter } = runtime.limits;

  app.all('/mcp', (c) => handleMcp(d, c.req.raw));

  app.use('/oauth/*', capped(16 * 1024));

  app.use('/oauth/*', async (c, next) => { c.header('cache-control', 'no-store'); c.header('pragma', 'no-cache'); await next(); });

  const oauthResult = async (c: Context, run: () => Promise<Response>) => {
    try { return await run(); }
    catch (e) {
      if (!(e instanceof agentOAuth.OAuthError) && !(e instanceof ZodError)) throw e;
      const error = e instanceof agentOAuth.OAuthError ? e.oauthCode : 'invalid_request';
      rlog.info('agent authorization refused', { oauthCode: error });
      return c.json({ error }, 400);
    }
  };

  const oauthParams = (parameters: URLSearchParams): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [key, value] of parameters) {
      if (key in result) throw new agentOAuth.OAuthError('invalid_request');
      result[key] = value;
    }
    return result;
  };

  const oauthForm = async (c: Context) => {
    if ((c.req.header('content-type') ?? '').split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') throw new agentOAuth.OAuthError('invalid_request');
    return oauthParams(new URLSearchParams(await c.req.text()));
  };

  app.get('/.well-known/oauth-authorization-server', (c) => c.json(agentOAuth.metadata(d)));

  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(agentOAuth.resourceMetadata(d)));

  const issuerPath = new URL(d.cfg.API_URL).pathname.replace(/\/+$/, '');

  if (issuerPath) {
    app.get(`/.well-known/oauth-authorization-server${issuerPath}`, (c) => c.json(agentOAuth.metadata(d)));
    app.get(`/.well-known/oauth-protected-resource${issuerPath}/mcp`, (c) => c.json(agentOAuth.resourceMetadata(d)));
  }

  app.post('/oauth/register', (c) => oauthResult(c, async () => {
    limiter(clientAddress(c), 'agent registration');
    return c.json(await agentOAuth.register(d, await body(c, AgentClientInputSchema)), 201);
  }));

  app.get('/oauth/authorize', (c) => oauthResult(c, async () => {
    limiter(clientAddress(c), 'agent authorization');
    return c.redirect(await agentOAuth.authorize(d, AgentAuthorizeInputSchema.parse(oauthParams(new URL(c.req.url).searchParams))), 302);
  }));

  app.post('/oauth/token', (c) => oauthResult(c, async () => {
    limiter(clientAddress(c), 'agent token');
    return c.json(await agentOAuth.token(d, AgentTokenBodySchema.parse(await oauthForm(c))));
  }));

  app.post('/oauth/revoke', (c) => oauthResult(c, async () => {
    limiter(clientAddress(c), 'agent revocation');
    const input = AgentRevokeBodySchema.parse(await oauthForm(c));
    await agentOAuth.revoke(d, input.token, input.client_id);
    return c.json({});
  }));
}

/** Managing a delegation requires the browser account session. Credential answers never become receipts. */
export function registerAgentRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { limiter } = runtime.limits;

  app.get('/v1/agents', async (c) => { c.header('cache-control', 'no-store'); return c.json(await agents.list(c.get('owner'))); });

  app.post('/v1/agents/tokens', async (c) => {
    limiter(c.get('owner').ownerId, 'agent connection');
    c.header('cache-control', 'no-store'); c.header('pragma', 'no-cache');
    return c.json(await agents.createToken(c.get('owner'), await body(c, AgentTokenInputSchema)));
  });

  app.delete('/v1/agents/:id', async (c) => { await agents.revoke(c.get('owner'), c.req.param('id')); return c.json({ revoked: true }); });

  app.get('/v1/agents/authorization/:id', async (c) => { c.header('cache-control', 'no-store'); return c.json(await agentOAuth.authorization(c.get('owner'), c.req.param('id'))); });

  app.post('/v1/agents/authorization/:id', async (c) => {
    limiter(c.get('owner').ownerId, 'agent consent');
    c.header('cache-control', 'no-store'); c.header('pragma', 'no-cache');
    return c.json(await agentOAuth.decide(c.get('owner'), c.req.param('id'), await body(c, AgentDecisionInputSchema)));
  });
}
