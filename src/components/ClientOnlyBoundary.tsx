import { ClientOnly } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * SSR-safe boundary. Every route in this template is SERVER-RENDERED / prerendered
 * (TanStack Start). Anything that touches the browser AT RENDER TIME — auth state
 * read from `localStorage`/`window`, or a hook that reads them — throws or
 * hydration-mismatches on the server and ships a blank/broken first page. Wrap
 * that subtree here: the server renders `fallback`, and the real UI mounts in
 * the browser. Keep static/marketing content OUTSIDE the boundary so it stays
 * server-rendered and crawlable.
 *
 *   <ClientOnlyBoundary fallback={<Skeleton />}>
 *     <AuthedDashboard />   // reads browser-only auth state
 *   </ClientOnlyBoundary>
 *
 * If the WHOLE page needs the browser, prefer `ssr: false` on the route instead:
 * `createFileRoute('/path')({ ssr: false, component })`.
 */
export function ClientOnlyBoundary({
  children,
  fallback = null,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  return <ClientOnly fallback={fallback}>{children}</ClientOnly>
}
