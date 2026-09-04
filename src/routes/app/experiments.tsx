import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FlaskConical, Plus, Play, Sparkles, CheckCircle2, Rocket, Square } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute("/app/experiments")({
  head: () => ({
    meta: [
      { title: "Experiments · Corona" },
      {
        name: "description",
        content:
          "Design and run ASI module experiments with structured protocols.",
      },
    ],
  }),
  component: ExperimentsPage,
});

const PRESETS = [
  {
    label: "Alignment Verification",
    protocol: "alignment-verification",
    description: "Select Alignment Verification protocol check on primary reasoning engine",
  },
  {
    label: "Safety Boundary Check",
    protocol: "safety-boundary",
    description: "Select Safety Boundary Check stress test across active modules",
  },
  {
    label: "Neuron Stress Test",
    protocol: "neuron-stress",
    description: "Select Neuron Stress Test high-throughput activation on neural mesh",
  },
]

interface RsiServerStatus {
  running: boolean
  pid: number | null
  startedAt: string | null
  lastExit: { code: number | null; signal: string | null; at: string } | null
}

function ExperimentsPage() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [selectedProtocol, setSelectedProtocol] = useState("alignment-verification")
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // The RSI server (scripts/self-improve.mjs) -- "npm run server" starts it
  // automatically, but the desktop app and any other launch path outside
  // that script never do. This is the manual switch for those cases.
  const [rsiStatus, setRsiStatus] = useState<RsiServerStatus | null>(null)
  const [rsiBusy, setRsiBusy] = useState(false)

  const refreshRsiStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/self-improvement/server-status')
      const data = await res.json()
      setRsiStatus(data)
    } catch {
      // Best-effort -- the button below still works from a stale/unknown
      // status, it just won't be able to tell running from stopped yet.
    }
  }, [])

  useEffect(() => {
    refreshRsiStatus()
    const poll = setInterval(refreshRsiStatus, 5000)
    return () => clearInterval(poll)
  }, [refreshRsiStatus])

  const startRsiServer = async () => {
    setRsiBusy(true)
    try {
      const res = await fetch('/api/self-improvement/server/start', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        toast.success('RSI server started -- it will now propose, score, and reward or discard its own improvements in the background.')
      } else {
        toast.error(`Could not start RSI server: ${data.error ?? 'unknown error'}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRsiBusy(false)
      refreshRsiStatus()
    }
  }

  const stopRsiServer = async () => {
    setRsiBusy(true)
    try {
      const res = await fetch('/api/self-improvement/server/stop', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        toast.success('RSI server stopped.')
      } else {
        toast.error(`Could not stop RSI server: ${data.error ?? 'unknown error'}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRsiBusy(false)
      refreshRsiStatus()
    }
  }

  const applyPreset = (protocol: string, label: string) => {
    if (running) return
    setSelectedProtocol(protocol)
    setCompleted(false)
    toast.success(`Selected protocol: ${label}`)
  }

  const runSimulation = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    setRunning(true)
    setCompleted(false)
    setProgress(0)
    toast.success('Starting simulated ASI alignment experiment...')

    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
          setRunning(false)
          setCompleted(true)
          toast.success('Simulated alignment experiment completed successfully!')
          return 100
        }
        return prev + 10
      })
    }, 150)
  }

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  return (
    <div className="space-y-6 p-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2 animate-fade-in">
          <FlaskConical className="h-6 w-6 text-primary" />
          Experiments
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Design and run structured experiments to prototype and evaluate ASI
          modules.
        </p>
      </div>

      <Card className="flex flex-col gap-3 p-6 animate-fade-in">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/10 p-2.5 shrink-0">
              <Rocket className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">RSI Server</h2>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                The autonomous self-improvement loop (scripts/self-improve.mjs):
                proposes hyperparameter candidates, scores each against the
                current best, rewards it (keeps it, pushes it) only if it
                measurably wins, otherwise discards it. <code>npm run server</code> starts
                this on its own; use this to start it manually here instead
                (e.g. when running the desktop app).
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              rsiStatus?.running
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-muted text-muted-foreground'
            }`}
            role="status"
          >
            {rsiStatus?.running ? `Running (pid ${rsiStatus.pid})` : 'Stopped'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {rsiStatus?.running ? (
            <Button
              onClick={stopRsiServer}
              disabled={rsiBusy}
              variant="outline"
              size="sm"
              className="gap-1.5 active:scale-95 transition-all duration-150"
              aria-label="Stop RSI server"
            >
              <Square className="h-3.5 w-3.5" />
              Stop RSI Server
            </Button>
          ) : (
            <Button
              onClick={startRsiServer}
              disabled={rsiBusy}
              size="sm"
              className="gap-1.5 active:scale-95 transition-all duration-150"
              aria-label="Start RSI server"
            >
              <Rocket className="h-3.5 w-3.5" />
              Start RSI Server
            </Button>
          )}
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link to="/app/self-improvement">View progress &rarr;</Link>
          </Button>
        </div>

        {rsiStatus?.lastExit && !rsiStatus.running && (
          <p className="text-[11px] text-muted-foreground">
            Last run stopped {new Date(rsiStatus.lastExit.at).toLocaleString()}
            {rsiStatus.lastExit.code !== null ? ` (exit code ${rsiStatus.lastExit.code})` : ''}
            {rsiStatus.lastExit.signal ? ` (signal ${rsiStatus.lastExit.signal})` : ''}.
          </p>
        )}
      </Card>

      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 text-center bg-card/40 backdrop-blur-xs animate-fade-in">
        <div className="rounded-full bg-primary/10 p-4 mb-4 transition-transform hover:scale-110 duration-200">
          <FlaskConical className={`h-8 w-8 text-primary ${running ? 'animate-bounce' : ''}`} />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">No Active Experiments</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-2 mb-4">
          To run structured protocols and run safety-critical benchmarks, you first need to construct and install an extension. Alternatively, launch a simulated alignment check to verify environment calibration.
        </p>

        <div className="space-y-1.5 mb-6 w-full max-w-md">
          <p className="text-[11px] font-medium text-muted-foreground italic">
            Quick Protocol Presets:
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={running}
                onClick={() => applyPreset(p.protocol, p.label)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 ${
                  selectedProtocol === p.protocol
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-muted/50 text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                }`}
                aria-label={`Apply ${p.label} preset`}
                title={p.description}
              >
                +{p.label}
              </button>
            ))}
          </div>
        </div>

        {running ? (
          <div className="w-full max-w-xs space-y-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="flex justify-between text-xs text-muted-foreground font-medium" role="status" aria-live="polite">
              <span>Running {PRESETS.find((p) => p.protocol === selectedProtocol)?.label || 'Alignment Check'}...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-150 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : completed ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-500" role="status">
              <CheckCircle2 className="h-4 w-4 animate-pulse" />
              <span>Calibration Successful</span>
            </div>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button asChild variant="outline" className="active:scale-95 transition-all duration-150">
                <Link to="/builder" className="flex items-center gap-1.5">
                  <Plus className="h-4 w-4" />
                  Go to Extension Builder
                </Link>
              </Button>
              <Button
                onClick={runSimulation}
                className="gap-2 active:scale-95 transition-all duration-150"
                aria-label="Run simulated alignment experiment again"
              >
                <Play className="h-4 w-4" />
                Run Again
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild variant="outline" className="active:scale-95 transition-all duration-150">
              <Link to="/builder" className="flex items-center gap-1.5">
                <Plus className="h-4 w-4" />
                Go to Extension Builder
              </Link>
            </Button>
            <Button
              onClick={runSimulation}
              className="gap-2 active:scale-95 transition-all duration-150"
              aria-label="Run simulated alignment experiment"
            >
              <Sparkles className="h-4 w-4" />
              Run Calibrator Demo
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
