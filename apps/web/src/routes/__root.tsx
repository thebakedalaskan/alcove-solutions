import { themeBootScript } from '@alcove/ui';
import type { QueryClient } from '@tanstack/react-query';
import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppRoot } from '~/features/shell/AppRoot';
import css from '~/styles/app.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Alcove' },
      { name: 'description', content: 'Video calls with built-in transcripts, summaries, live translation and breakout rooms.' }
    ],
    links: [
      { rel: 'stylesheet', href: css },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
    ],
    scripts: [{ children: themeBootScript }]
  }),
  shellComponent: Document,
  component: Root
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

/* Everything round every page (features/shell/AppRoot.tsx), with the router's query client. */
function Root() {
  const { queryClient } = Route.useRouteContext();
  return <AppRoot queryClient={queryClient} />;
}
