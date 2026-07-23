import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/evaluation')({
  head: () => ({
    meta: [
      { title: 'Evaluation · ASI Architect' },
      { name: 'description', content: 'Measure and benchmark ASI module performance against defined criteria.' },
    ],
  }),
  component: EvaluationPage,
})

function EvaluationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Evaluation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Measure, benchmark, and score ASI modules against defined criteria and safety thresholds.
        </p>
      </div>
    </div>
  )
}
