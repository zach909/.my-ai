import { createFileRoute } from '@tanstack/react-router'

/**
 * Home route (/). A neutral, FULL-BLEED starting point — no app chrome, no
 * sidebar. Replace this body with your real landing page or app home.
 *
 * Add more pages as files under `src/routes/` (e.g. `src/routes/about.tsx`
 * → /about). The HTML document + providers live once in `__root.tsx`.
 *
 * Building a SaaS / dashboard app? Opt into the sidebar shell by adding a
 * `src/routes/_app.tsx` layout route with pages under `src/routes/_app/`.
 * Landing pages, marketing sites, content, and games stay full-bleed (default).
 *
 * SEO: set per-page title/description/Open Graph here in `head()`.
 *
 * SSR / routing (this template is server-rendered — TanStack Start):
 * - Routes are files under `src/routes/` that `export const Route =
 *   createFileRoute('/path')({ component })`. NEVER `export default` a route.
 *   Navigate with `Link` from `@tanstack/react-router` (there is no `NavLink`).
 * - Reading Blink auth/SDK state (`blink.auth`), `localStorage`, or `window` at
 *   render CRASHES SSR / hydration-mismatches and ships a blank first page. Wrap
 *   that subtree in `<BlinkClientBoundary fallback={…}>` (from
 *   `@/components/BlinkClientBoundary`), or set `ssr: false` on the route for a
 *   fully client-only page. Keep static content outside the boundary.
 */
export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Home · Blink App' },
      { name: 'description', content: 'Welcome — an app built with Blink.' },
    ],
  }),
  component: Home,
})

function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Your Blink app is ready</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This is the full-bleed starter home with no sidebar. Edit{' '}
        <code className="rounded bg-muted px-1">src/routes/index.tsx</code> to build your
        page, or add routes under{' '}
        <code className="rounded bg-muted px-1">src/routes/</code>.
      </p>
    </main>
  )
}
