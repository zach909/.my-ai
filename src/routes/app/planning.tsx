import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Goal, Sparkles, CheckCircle2, ChevronRight, MessageSquare, Loader2 } from 'lucide-react'

export const Route = createFileRoute('/app/planning')({
  head: () => ({
    meta: [
      { title: 'Planning · ASI Architect' },
      { name: 'description', content: 'Define goal hierarchies, task decomposition, and strategic planning for ASI agents.' },
    ],
  }),
  component: PlanningPage,
})

const GOALS = [
  { id: 'g1', title: 'Verify containment constraints', desc: 'Assess sandbox network isolation.' },
  { id: 'g2', title: 'Multi-agent coordination protocol', desc: 'Synthesize consensus guidelines.' },
]

function PlanningPage() {
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<string[] | null>(null)

  const handleDecompose = (id: string) => {
    setSelectedGoal(id)
    setPlanning(true)
    setPlan(null)
    setTimeout(() => {
      setPlanning(false)
      setPlan([
        'Decompose target objectives into isolated subprocesses',
        'Verify subtask inputs & validation bounds',
        'Establish recursive compliance check loops',
      ])
    }, 600)
  }

  return (
    <div className="space-y-6 p-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Planning</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define goal hierarchies, decompose complex tasks, and evaluate strategic planning capabilities.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3 md:col-span-1">
          <h2 className="text-sm font-semibold text-foreground">Select Goal to Decompose</h2>
          <div className="space-y-2">
            {GOALS.map((g) => {
              const isSelected = selectedGoal === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => handleDecompose(g.id)}
                  disabled={planning}
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? 'Selected' : 'Select and decompose'} goal: ${g.title}`}
                  className={`group relative w-full text-left p-3 rounded-xl border text-xs transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isSelected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-card hover:bg-accent/50 text-muted-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-foreground flex items-center gap-1.5 min-w-0">
                      <Goal className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate">{g.title}</span>
                    </div>
                    <ChevronRight
                      size={14}
                      className={`text-primary shrink-0 transition-all duration-150 ${
                        isSelected
                          ? 'opacity-100 translate-x-0'
                          : 'opacity-0 -translate-x-1 group-hover:opacity-60 group-hover:translate-x-0 group-focus:opacity-60 group-focus:translate-x-0'
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-1 pr-4 text-[11px] leading-relaxed">{g.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-2">
          {!selectedGoal ? (
            <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-8 text-center h-full min-h-[220px] bg-card/50">
              <div className="rounded-full bg-primary/10 p-3 mb-3">
                <Goal className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-sm font-semibold">No Goal Selected</h3>
              <p className="text-xs text-muted-foreground max-w-xs mt-1 mb-4">
                Select a strategic goal from the list to simulate planning and auto-decompose objectives, or prompt the chat assistant.
              </p>
              <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all duration-150">
                <Link to="/app/chat" className="flex items-center gap-1.5">
                  <MessageSquare size={13} />
                  Ask AI Chat
                </Link>
              </Button>
            </Card>
          ) : (
            <Card className="p-5 h-full space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Planning Hierarchy
              </h3>
              {planning ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-2" role="status">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground animate-pulse">Decomposing objective...</span>
                </div>
              ) : (
                plan && (
                  <div className="space-y-3" role="log" aria-live="polite">
                    <p className="text-xs text-emerald-500 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" /> Goal decomposed successfully:
                    </p>
                    <ol className="space-y-2 pl-1">
                      {plan.map((step, i) => (
                        <li key={i} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
                          <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
