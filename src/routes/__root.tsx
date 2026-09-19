/// <reference types="vite/client" />
import {
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import type { ReactNode } from 'react'
import indexCss from '../index.css?url'

/**
 * Pre-paint theme script. Runs synchronously in <head> BEFORE first paint, so
 * the document renders in the correct theme on the very first frame — no flash.
 * Dark mode is a single `.dark` class on <html>; the token values in index.css
 * flip under it. Persisted to localStorage, falls back to system preference.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`

const queryClient = new QueryClient()

/**
 * Root route — owns the HTML document (SSR), global <head> (SEO-ready),
 * and the app-wide providers.
 *
 * NO app chrome (sidebar/top bar) is applied here by default, so every app —
 * landing pages, marketing sites, content, games — renders FULL-BLEED.
 * Building a SaaS / dashboard app? The sidebar shell already ships at
 * `src/routes/app.tsx` (mounted at the real `/app` segment) with pages under
 * `src/routes/app/` — add pages there. Never create a pathless `src/routes/_app.tsx`:
 * it adds no URL segment, so it (or its `index.tsx`) collides with the root index
 * route at "/". Keep this root bare — don't add chrome here.
 *
 * SEO/AEO: <HeadContent /> renders the merged head() output (title, meta,
 * Open Graph, links) on the server, so crawlers and AI bots receive a
 * fully-rendered, indexable document on the first request. Per-page routes
 * override title/description via their own head().
 *
 * SSR: this document (and every route) is server-rendered/prerendered. A child
 * that reads browser-only state at render — auth state from `localStorage`,
 * `window` — must be wrapped in `<ClientOnlyBoundary>`
 * (`src/components/ClientOnlyBoundary.tsx`) or use the route's `ssr: false`,
 * or the page ships blank / hydration-mismatched. Do NOT read auth state here.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'Corona — Prototype & Evaluate Superintelligence Modules' },
      { name: 'description', content: 'A full-stack platform for prototyping, integrating, and evaluating the essential modules required for building an Artificial Superintelligence.' },
      { name: 'theme-color', content: '#0b1120' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Corona — Prototype & Evaluate Superintelligence Modules' },
      { property: 'og:description', content: 'A full-stack platform for prototyping, integrating, and evaluating the essential modules required for building an Artificial Superintelligence.' },
      // Shared-shell SEO defaults — set these to the real brand/locale per app.
      { property: 'og:site_name', content: 'Corona' },
      { property: 'og:locale', content: 'en_US' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [
      { rel: 'stylesheet', href: indexCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* MUST be first: sets the theme class before paint so there is no
            flash-of-wrong-theme. Do not move below <HeadContent />. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
        {/*
          WebSite + Organization entity (rendered on every page, once at the root).
          Gives Google's Knowledge Graph + AI answer engines explicit, machine-
          readable identity. Replace name/url and add the brand's real profile
          links to `sameAs` (LinkedIn, GitHub, X, Crunchbase) per app.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                { '@type': 'WebSite', name: 'Corona', url: '/' },
                { '@type': 'Organization', name: 'Corona', url: '/', sameAs: [] },
              ],
            }),
          }}
        />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={0}>
            <Toaster />
            {/*
              Full-bleed by default — NO app chrome. Child routes render directly.
              SaaS / dashboard app? The sidebar shell already exists at
              `src/routes/app.tsx` (the real `/app` segment) — add pages under
              `src/routes/app/`. Landing pages, marketing sites, content, and games
              stay full-bleed (delete `src/routes/app.tsx` + `src/routes/app/`).
            */}
            {children}
          </TooltipProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
