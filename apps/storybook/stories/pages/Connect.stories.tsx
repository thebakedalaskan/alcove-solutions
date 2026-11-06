/* The real public /connect route: no request, signing in, consent, and its failure states. */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { AGENT_CONNECT_PATH, EXPIRED_AGENT_REQUEST } from '../../src/api/agents';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { troubled } from './changes';

const meta = { title: 'Pages/Connect an agent', ...pages } satisfies Meta<PageArgs>;
export default meta;
const deciding: NonNullable<PageStory['play']> = async ({ userEvent, step }) => {
  await step('Allow the selected permissions; this scenario keeps or refuses the request before the hand-off', async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Allow selected access' }, { timeout: 8000 }));
  });
};
export const RequestedAccess = page(AGENT_CONNECT_PATH, 'busy');
export const RequestedAccessNight = page(AGENT_CONNECT_PATH, 'busy', { globals: { theme: 'dark' } });
export const RequestedAccessPhone = phone(RequestedAccess);
export const SignInFirst = page(AGENT_CONNECT_PATH, 'signed-out');
export const NoRequest = page('/connect', 'busy');
export const ExpiredRequest = page(`/connect?request=${EXPIRED_AGENT_REQUEST}`, 'busy');
export const SignInUnavailable = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'auth.getSession': 'failed' })) });
export const CheckingSignIn = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'auth.getSession': 'hold' })) });
export const LoadingRequest = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'agents.authorization': 'hold' })) });
export const RequestUnavailable = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'agents.authorization': 'failed' })) });
export const AccessRefused = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'agents.decide': 'failed' })), play: deciding });
export const SendingDecision = page(AGENT_CONNECT_PATH, 'busy', { beforeEach: changing(troubled({ 'agents.decide': 'hold' })), play: deciding });
