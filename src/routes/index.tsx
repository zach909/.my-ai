import { createFileRoute } from '@tanstack/react-router'
import { useElasticMesh } from '@/features/mesh/use-elastic-mesh'
import { MeshVisualization } from '@/features/mesh/mesh-visualization'
import { ControlPanel } from '@/features/mesh/control-panel'
import { BlinkClientBoundary } from '@/components/BlinkClientBoundary'
import { Sparkles, Cpu, ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Prometheus Elastic Core — Non-Linear Neural Mesh' },
      { name: 'description', content: 'A locally-run autonomous AI built on a fundamentally different substrate: an all-to-all non-linear neural mesh that learns continuously without catastrophic forgetting.' },
    ],
  }),
  component: Home,
})

function Home() {
  return (
    <BlinkClientBoundary
      fallback={
        <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Initializing neural mesh...</p>
        </main>
      }
    >
      <MeshLab />
    </BlinkClientBoundary>
  )
}

function MeshLab() {
  const {
    meshState,
    stats,
    isRunning,
    speed,
    selectedNeuron,
    selectNeuron,
    toggleRunning,
    reset,
    step,
    setSpeed,
    injectInput,
    learnHebbian,
  } = useElasticMesh({ neuronCount: 64, dimensions: 4, totalVale: 3200 })

  const dims = 4

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* ─── Header ──────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-semibold tracking-tight">
              Prometheus Elastic Core
            </h1>
            <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 font-mono">
              v0.1.0
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/zach909/.my-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">zach909/.my-ai</span>
            </a>
          </div>
        </div>
      </header>

      {/* ─── Body ────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Visualization — takes remaining space */}
        <div className="flex-1 min-w-0 p-2">
          <MeshVisualization
            meshState={meshState}
            selectedNeuron={selectedNeuron}
            onSelectNeuron={selectNeuron}
            dims={dims}
          />
        </div>

        {/* Control Panel — fixed-width sidebar */}
        <aside className="w-72 shrink-0 border-l border-border overflow-y-auto p-3 space-y-3">
          <ControlPanel
            stats={stats}
            selectedNeuron={selectedNeuron}
            isRunning={isRunning}
            speed={speed}
            onToggle={toggleRunning}
            onReset={reset}
            onStep={step}
            onSpeedChange={setSpeed}
            onInjectInput={injectInput}
            onLearn={learnHebbian}
            onDeselectNeuron={() => selectNeuron(null)}
          />
        </aside>
      </div>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className="shrink-0 border-t border-border px-4 h-8 flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            All-to-All Non-Linear Mesh
          </span>
          <span>|</span>
          <span>64 neurons · 4 dims · Continuous Learning</span>
        </div>
        <span>No external APIs · Runs Locally</span>
      </footer>
    </main>
  )
}
