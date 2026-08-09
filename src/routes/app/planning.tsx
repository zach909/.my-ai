import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

function PlanningPage() {
  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Planning</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define goal hierarchies, decompose complex tasks, and evaluate strategic planning capabilities.
        </p>
      </div>

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
