import { createFileRoute, Link } from '@tanstack/react-router'
import {
  useElasticMesh,
  MeshVisualization,
  ControlPanel,
  DEFAULT_CONFIG,
} from '@/features/mesh'

/**
 * Home route (/) — the Prometheus Elastic Core live dashboard.
 *
 * Runs the real all-to-all elastic mesh engine (src/features/mesh) directly in
 * the browser: a 3D visualization of every neuron (vale → brightness,
 * activation → hue/size) with the control surface for injecting input,
 * stepping/settling propagation, and triggering Hebbian learning.
 *
 * `ssr: false` — the page drives three.js and requestAnimationFrame, which
 * only exist client-side.
 */
export const Route = createFileRoute('/')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Neuroclaw · Prometheus Elastic Core' },
      {
        name: 'description',
        content:
          'Live all-to-all elastic neuron mesh — zero-sum vale plasticity, multi-dimensional state, settle-to-convergence reasoning.',
      },
    ],
  }),
  component: MeshDashboard,
})

function MeshDashboard() {
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
  } = useElasticMesh()

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Prometheus Elastic Core
          </h1>
          <p className="text-xs text-muted-foreground">
            {DEFAULT_CONFIG.neuronCount} neurons · {DEFAULT_CONFIG.dimensions}D
            state · all-to-all mesh · zero-sum vale {DEFAULT_CONFIG.totalVale}
          </p>
        </div>
        <nav className="flex items-center gap-3">
          <Link
            to="/builder"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Extension Builder →
          </Link>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              isRunning
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {isRunning ? 'Propagating' : 'Idle'}
          </span>
        </nav>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3 lg:flex-row">
        <section className="min-h-[400px] flex-1" aria-label="Mesh visualization">
          <MeshVisualization
            meshState={meshState}
            selectedNeuron={selectedNeuron}
            onSelectNeuron={selectNeuron}
            dims={DEFAULT_CONFIG.dimensions}
          />
        </section>

        <aside className="w-full shrink-0 lg:w-72" aria-label="Mesh controls">
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
    </main>
  )
}
