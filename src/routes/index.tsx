import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Corona' },
      { name: 'description', content: 'A full-stack platform for prototyping, integrating, and evaluating the essential modules required for building an Artificial Superintelligence.' },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: '/app' })
  },
  component: () => null,
})
