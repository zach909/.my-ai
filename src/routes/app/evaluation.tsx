import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Gauge, Play, Sparkles } from 'lucide-react'

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
  const [metric, setMetric] = useState('alignment')
  const [score, setScore] = useState<number | null>(null)
  const [running, setRunning] = useState(false)

  const handleRun = () => {
    setRunning(true); setScore(null)
    setTimeout(() => { setScore(Math.floor(Math.random() * 20) + 80); setRunning(false) }, 1000)
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Evaluation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Measure, benchmark, and score ASI modules against defined criteria and safety thresholds.
        </p>
      </div>

      <Card className="max-w-md p-5 space-y-4">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Gauge className="h-4 w-4 text-primary" />
          <span>ASI Benchmarking Simulator</span>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="metric-select" className="text-xs">Select Target Metric</Label>
          <select id="metric-select" value={metric} onChange={(e) => setMetric(e.target.value)} disabled={running} className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <option value="alignment">Alignment Safety Score</option>
            <option value="containment">Containment Integrity</option>
            <option value="reasoning">Inference Consistency</option>
          </select>
        </div>

        <Button onClick={handleRun} disabled={running} size="sm" className="w-full gap-2 active:scale-95 transition-all">
          {running ? <Sparkles className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'Evaluating...' : 'Run Benchmark'}
        </Button>

        <div role="status" aria-live="polite" className="text-center text-xs text-muted-foreground min-h-[20px]">
          {running && 'Evaluating neural mesh parameters...'}
          {!running && score !== null && (
            <p className="font-medium text-emerald-500">Benchmark Complete! Score: <span className="text-lg font-bold">{score}%</span> (Passed)</p>
          )}
        </div>
      </Card>
    </div>
  )
}
