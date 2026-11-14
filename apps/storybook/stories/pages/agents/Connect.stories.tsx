/*
 * The real public /connect route, where an agent sends you with its request: signing in first, no request, checking the
 * sign-in and failing to. Signed in, it hands over to Agents (/agents?request=…), which asks on its sky (Pages/Agents/Agents).
 */
import type { Meta } from '@storybook/react-vite';
import { AGENT_CONNECT_PATH } from '../../../src/api/agents/agents';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs } from '../../../src/page';
import { troubled } from '../changes';

const meta = { title: 'Pages/Agents/Connect an agent', ...pages } satisfies Meta<PageArgs>;
export default meta;
export const SignInFirst = page(AGENT_CONNECT_PATH, 'signed-out');
export const SignInFirstNight = page(AGENT_CONNECT_PATH, 'signed-out', { globals: { theme: 'dark' } });
export const SignInFirstPhone = phone(SignInFirst);
/** Signed in, it isn't this page's to ask: Agents asks, in its place. */
export const SignedIn = page(AGENT_CONNECT_PATH, 'busy');
export const NoRequest = page('/connect', 'busy');
export const SignInUnavailable = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'auth.getSession': 'failed' })) });
export const CheckingSignIn = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'auth.getSession': 'hold' })) });
