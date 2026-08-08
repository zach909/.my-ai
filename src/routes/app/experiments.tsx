import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FlaskConical, Plus } from "lucide-react";
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FlaskConical, Play, Sparkles, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute("/app/experiments")({
  head: () => ({
    meta: [
      { title: "Experiments · ASI Architect" },
      {
        name: "description",
        content:
          "Design and run ASI module experiments with structured protocols.",
      },
    ],
  }),
  component: ExperimentsPage,
});

function ExperimentsPage() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [completed, setCompleted] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

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
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Experiments
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Design and run structured experiments to prototype and evaluate ASI
          modules.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center min-h-[350px] p-8 border-2 border-dashed border-muted rounded-xl bg-muted/20 text-center animate-fade-in">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 transition-transform hover:scale-110 duration-200">
          <FlaskConical className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          No active experiments
        </h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm mb-6">
          To run structured protocols and run safety-critical benchmarks, you
          first need to construct and install an extension.
        </p>
        <Button asChild className="active:scale-95 transition-all duration-150">
          <Link to="/builder" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Go to Extension Builder
          </Link>
        </Button>
      </div>
      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 text-center max-w-2xl mx-auto mt-8 bg-card/50 backdrop-blur-xs">
        <div className="rounded-full bg-primary/10 p-4 mb-4">
          <FlaskConical className={`h-8 w-8 text-primary ${running ? 'animate-bounce' : ''}`} />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">No Active Experiments</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-2 mb-6">
          You haven't run any ASI prototype evaluations yet. Launch a simulated alignment check to verify environment calibration.
        </p>

        {running ? (
          <div className="w-full max-w-xs space-y-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="flex justify-between text-xs text-muted-foreground font-medium">
              <span>Running Alignment Check...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-150 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : completed ? (
          <div className="flex flex-col items-center space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-500" role="status">
              <CheckCircle2 className="h-4 w-4" />
              <span>Calibration Successful</span>
            </div>
            <Button
              onClick={runSimulation}
              className="gap-2 active:scale-95 transition-all duration-150"
              aria-label="Run simulated alignment experiment again"
            >
              <Play className="h-4 w-4" />
              Run Again
            </Button>
          </div>
        ) : (
          <Button
            onClick={runSimulation}
            className="gap-2 active:scale-95 transition-all duration-150"
            aria-label="Run simulated alignment experiment"
          >
            <Sparkles className="h-4 w-4" />
            Run Calibrator Demo
          </Button>
        )}
      </Card>
    </div>
  );
}
