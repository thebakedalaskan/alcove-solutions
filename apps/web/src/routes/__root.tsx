import { TooltipProvider, ThemeProvider, ToastProvider, themeBootScript } from '@alcove/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import css from '~/styles/app.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Alcove' }, { name: 'theme-color', content: '#100E0C' }],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Gabarito:wght@500;600;700;800&family=Geist+Mono:wght@400;500;600&family=Onest:wght@400;500;600;700&display=swap' },
      { rel: 'stylesheet', href: css },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
    ],
    scripts: [{ children: themeBootScript }]
  }),
  shellComponent: Document,
  component: Root,
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div><h1 className="text-4xl">Nothing here</h1><p className="mt-2 text-ink-2">That page doesn’t exist. <a className="font-semibold underline" href="/">Go home</a></p></div>
    </div>
  )
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <Outlet />
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
