import type { Meta } from '@storybook/react-vite';
import { phone } from '../../../src/call';
import { page, pages, type PageArgs } from '../../../src/page';

const meta = { title: 'Pages/Signing in/Privacy policy', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const SignedOut = page('/privacy', 'signed-out');
export const Phone = phone(SignedOut);
export const Night = { ...SignedOut, globals: { theme: 'dark' } };
