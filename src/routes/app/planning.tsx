import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Goal, MessageSquare, Plus } from 'lucide-react'

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
    <div className="space-y-6 p-4 animate-fade-in">
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
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
