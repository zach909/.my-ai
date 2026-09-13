import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Corona' },
      { name: 'description', content: 'A full-stack platform for prototyping, integrating, and evaluating the essential modules required for building an Artificial Superintelligence.' },
    ],
  }),
  beforeLoad: () => {
    // Straight to Chats, not /app -- /app/index.tsx itself only redirects
    // here too now that Dashboard is gone; skip the extra hop.
    throw redirect({ to: '/app/chat' })
  },
  component: () => null,
})
