import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/experiments')({
  head: () => ({
    meta: [
      { title: 'Experiments · ASI Architect' },
      { name: 'description', content: 'Design and run ASI module experiments with structured protocols.' },
    ],
  }),
  component: ExperimentsPage,
})

function ExperimentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Experiments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Design and run structured experiments to prototype and evaluate ASI modules.
        </p>
      </div>
    </div>
  )
}
