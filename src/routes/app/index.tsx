import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Dashboard removed -- "remove the dashboard page on the web page". `/app`
 * itself still has to resolve to something real (see app.tsx's own doc
 * comment: `/` redirects here, and anyone with `/app` bookmarked still
 * lands here too), so rather than deleting this route outright it now just
 * forwards straight into Chats, the new first nav entry where Dashboard
 * used to be.
 */
export const Route = createFileRoute('/app/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/chat' })
  },
})
