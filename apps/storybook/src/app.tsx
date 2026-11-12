/*
 * The real app, at an address. It's the app's own router (`getRouter()` in apps/web/src/router.tsx, with its query client
 * and everything it sets up) and its own route tree, with the browser's history swapped for one in memory that starts at
 * `path`: every page, guard, loader and query runs as it does in the app, against the stand-in API. Moving around inside
 * the story moves this history, never the Storybook frame's.
 *
 * The root route's document shell (its <html>, <head> and <body>) is the only thing left out: a story renders inside
 * Storybook's page, which already has them.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { useState } from 'react';
import { getRouter } from '~/router';
import { Route as root } from '~/routes/__root';

/** The router for one story, at `path`. A story that puts something over the app (checkout, src/checkout.tsx) shares its query client. */
export function routerAt(path: string) {
  Reflect.deleteProperty(root.options, 'shellComponent');
  const router = getRouter();
  const browser = router.history;
  router.update({ ...router.options, history: createMemoryHistory({ initialEntries: [path] }) });
  // It was made with the browser's own history, which watches the frame's address. Nothing should.
  browser.destroy();
  return router;
}

export interface AppProps {
  /** Where the app opens: `/home`, `/notes`, `/notes/n2`, `/team`, `/record`, `/settings`, `/call/<code>`... */
  path: string;
}

/** The app, opened at `path`. Give it a new `key` to open it again. */
export function App({ path }: AppProps) {
  const [router] = useState(() => routerAt(path));
  return <RouterProvider router={router} />;
}
