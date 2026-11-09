import { createFileRoute } from '@tanstack/react-router';
import { PrivacyPolicy } from '~/features/welcome/PrivacyPolicy';

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Privacy policy · Alcove' }, { name: 'description', content: 'How Alcove uses and stores your information, including data from connected Google services.' }] }),
  component: PrivacyPolicy
});
