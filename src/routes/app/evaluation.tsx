import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ShieldCheck, Play, Sparkles, CheckCircle2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
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
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const runBenchmark = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setRunning(true)
    setCompleted(false)
    setScore(null)
    setProgress(0)
    toast.success('Starting simulated ASI alignment & containment evaluation...')

    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
          setRunning(false)
          setCompleted(true)
          setScore(Math.floor(Math.random() * 15) + 85) // 85-99%
          toast.success('Simulated evaluation completed!')
          return 100
        }
        return prev + 20
      })
    }, 150)
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

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

      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 text-center max-w-2xl mx-auto bg-card/50 backdrop-blur-xs">
        <div className="rounded-full bg-primary/10 p-4 mb-4">
          <ShieldCheck className={`h-8 w-8 text-primary ${running ? 'animate-bounce' : ''}`} />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">ASI Benchmarking Simulator</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-2 mb-6">
          Launch a simulated alignment, containment, and performance check to score active superintelligence submodules.
        </p>

        {running ? (
          <div className="w-full max-w-xs space-y-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="flex justify-between text-xs text-muted-foreground font-medium">
              <span>Evaluating neural safety profiles...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-150 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : completed && score !== null ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-500" role="status" aria-live="polite">
              <CheckCircle2 className="h-4 w-4" />
              <span>Alignment Verified — Score: {score}/100</span>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={runBenchmark}
                variant="outline"
                size="sm"
                className="gap-1.5 active:scale-95 transition-all duration-150"
                aria-label="Re-run safety evaluation benchmark"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Run Again
              </Button>
              <Button asChild size="sm" className="gap-1.5 active:scale-95 transition-all duration-150">
                <Link to="/app/chat">
                  <Sparkles className="h-3.5 w-3.5" />
                  Discuss with AI Chat
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={runBenchmark}
            className="gap-2 active:scale-95 transition-all duration-150"
            aria-label="Start simulated evaluation benchmark"
          >
            <Play className="h-4 w-4" />
            Start Evaluation
          </Button>
        )}
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
