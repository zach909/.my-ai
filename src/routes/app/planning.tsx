import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Goal, Sparkles } from 'lucide-react'
import { Goal, Plus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Goal, Sparkles, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Goal, Sparkles, CheckCircle2, ChevronRight, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Goal, MessageSquare, Plus } from 'lucide-react'
import { Goal, Sparkles, Plus } from 'lucide-react'

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
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Planning</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define goal hierarchies, decompose complex tasks, and evaluate strategic planning capabilities.
        </p>
      </div>

      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 text-center max-w-2xl mx-auto mt-8 bg-card/50 backdrop-blur-xs">
        <div className="rounded-full bg-primary/10 p-4 mb-4 transition-transform hover:scale-110 duration-200">
          <Goal className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">No Active Planning Hierarchies</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-2 mb-6">
          To orchestrate high-level goal decomposition and task dependencies, you first need to design your agent's strategic layout.
        </p>
        <Button asChild className="gap-2 active:scale-95 transition-all duration-150">
          <Link to="/app/chat">
            <Sparkles className="h-4 w-4" />
            Discuss Strategy in AI Chat
          </Link>
        </Button>
      <div className="flex flex-col items-center justify-center min-h-[350px] p-8 border-2 border-dashed border-muted rounded-xl bg-muted/20 text-center animate-fade-in">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 transition-transform hover:scale-110 duration-200">
          <Goal className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          No goal hierarchies defined
        </h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm mb-6">
          To decompose complex objectives and configure multi-step plans for your ASI modules, you first need to construct and connect an extension.
        </p>
        <Button asChild className="active:scale-95 transition-all duration-150">
          <Link to="/builder" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Go to Extension Builder
          </Link>
        </Button>
      </div>
      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 text-center max-w-2xl mx-auto mt-8 bg-card/50 backdrop-blur-xs">
        <div className="rounded-full bg-primary/10 p-4 mb-4 transition-transform hover:scale-110 duration-300">
          <Goal className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">No Active Goals Outlined</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-2 mb-6 leading-relaxed">
          Your strategic roadmap is currently empty. Decompose high-level objectives into actionable agent sub-goals by starting a collaborative chat session.
        </p>

        <Button asChild className="gap-2 active:scale-95 transition-all duration-150">
          <Link to="/app/chat">
            <Sparkles className="h-4 w-4" />
            Decompose Goals in Chat
            <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
          </Link>
        </Button>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3 md:col-span-1">
          <h2 className="text-sm font-semibold text-foreground">Select Goal to Decompose</h2>
          <div className="space-y-2">
            {GOALS.map((g) => (
              <button
                key={g.id}
                onClick={() => handleDecompose(g.id)}
                disabled={planning}
                className={`w-full text-left p-3 rounded-xl border text-xs transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  selectedGoal === g.id
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border bg-card hover:bg-accent/50 text-muted-foreground'
                }`}
                aria-label={`Select and decompose goal: ${g.title}`}
              >
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Goal className="h-3.5 w-3.5 text-primary shrink-0" />
                  {g.title}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed">{g.desc}</p>
              </button>
            ))}
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
      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 text-center max-w-2xl mx-auto mt-8 bg-card/50 backdrop-blur-xs">
        <div className="rounded-full bg-primary/10 p-4 mb-4 transition-transform hover:scale-110 duration-200">
          <Goal className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">No Active Planning Hierarchies</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-2 mb-6">
          You haven't initialized any planning hierarchies or goal decompositions yet. Start by defining a task in the extension builder or consulting the AI Assistant.
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="sm" className="active:scale-95 transition-all duration-150">
            <Link to="/builder" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Go to Extension Builder
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all duration-150">
            <Link to="/app/chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Chat with Assistant
      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-10 text-center max-w-xl mx-auto mt-8 bg-card/50 backdrop-blur-xs">
        <div className="rounded-full bg-primary/10 p-4 mb-4">
          <Goal className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">No Active Plans</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-2 mb-6">
          To orchestrate complex goal hierarchies, first design an extension or configure your agent's chat context.
        </p>
        <div className="flex gap-3">
          <Button asChild size="sm" className="active:scale-95 transition-all duration-150">
            <Link to="/builder">
              <Plus className="mr-1.5 h-4 w-4" /> Extension Builder
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all duration-150">
            <Link to="/app/chat">
              <Sparkles className="mr-1.5 h-4 w-4" /> AI Chat
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
