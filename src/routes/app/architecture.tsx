import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Network, Plus, Trash2, CheckCircle2, X } from 'lucide-react'

export const Route = createFileRoute('/app/architecture')({
  head: () => ({
    meta: [
      { title: 'Architecture · ASI Architect' },
      { name: 'description', content: 'Define and compose superintelligence subsystems and data flows.' },
    ],
  }),
  component: ArchitecturePage,
})

function ArchitecturePage() {
  const [systems, setSystems] = useState<string[]>([])
  const [status, setStatus] = useState('No subsystems provisioned. Build your topology.')

  const addSystem = (name: string) => {
    if (systems.includes(name)) return
    const next = [...systems, name]
    setSystems(next)
    setStatus(`${name} integrated into topology. Current systems: ${next.join(', ')}.`)
  }

  const removeSystem = (name: string) => {
    const next = systems.filter((s) => s !== name)
    setSystems(next)
    if (next.length === 0) {
      setStatus(`Removed ${name}. Topology is now empty.`)
    } else {
      setStatus(`Removed ${name} from topology. Remaining systems: ${next.join(', ')}.`)
    }
  }

  const clearAll = () => {
    setSystems([])
    setStatus('Topology cleared.')
  }

  return (
    <div className="space-y-6 p-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Architecture</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define and compose superintelligence subsystems, data flows, and integration topology.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="p-4 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Available Subsystems</h2>
          <div className="flex flex-col gap-2">
            {['Cognitive Core', 'Knowledge Vault', 'Safety Sandbox'].map((sys) => {
              const isAdded = systems.includes(sys)
              return (
                <Button
                  key={sys}
                  variant="outline"
                  size="sm"
                  onClick={() => addSystem(sys)}
                  disabled={isAdded}
                  className="justify-between active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                  aria-label={isAdded ? `${sys} already integrated` : `Integrate ${sys} Subsystem`}
                  title={isAdded ? `${sys} is already integrated` : `Integrate ${sys}`}
                >
                  <span>{sys}</span>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )
            })}
          </div>
        </Card>

        <Card className="md:col-span-2 p-5 min-h-[220px] flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Network className="h-4 w-4 text-primary" />
              Integration Topology
            </h2>
            <div role="status" aria-live="polite" className="sr-only">
              {status}
            </div>
            {systems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <p className="text-xs text-muted-foreground">Empty topology. Add subsystems to begin mapping the data flow.</p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {systems.map((sys, idx) => (
                  <div key={sys} className="flex items-center gap-2">
                    {idx > 0 && <span className="text-xs text-primary font-bold animate-pulse" aria-hidden="true">➔</span>}
                    <div className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span>{sys}</span>
                      <button
                        type="button"
                        onClick={() => removeSystem(sys)}
                        className="ml-1 rounded-sm p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95 transition-all duration-150 cursor-pointer"
                        aria-label={`Remove ${sys} from topology`}
                        title={`Remove ${sys}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {systems.length > 0 && (
            <div className="flex justify-end pt-4 border-t border-border mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="gap-1.5 text-xs text-destructive hover:text-destructive active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label="Clear entire topology"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Topology
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
