import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { LoadingScreen } from './components/LoadingScreen'

/**
 * TanStack Start entry — the framework imports this `createRouter` factory.
 * `routeTree.gen.ts` is generated automatically by the TanStack Start Vite
 * plugin from the files under `src/routes/` (do not edit it by hand).
 */
export function createRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    // The twisted-strip loading screen covers every navigation that has to
    // wait, including first paint when the desktop app opens -- the longest
    // wait the user actually sees.
    defaultPendingComponent: () => <LoadingScreen />,
    // Show it promptly rather than flashing in late on a slow route, but not
    // so eagerly that a fast navigation blinks a loading screen on and off.
    defaultPendingMs: 300,
    defaultPendingMinMs: 400,
  })
}

// TanStack Start's hydration entry imports `getRouter` from this module
// (production `vite build` fails with "getRouter is not exported" without it).
export const getRouter = createRouter

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
