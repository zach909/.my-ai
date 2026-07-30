import { createFileRoute, Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Cpu, FlaskConical, Network, Brain, MessageSquare } from 'lucide-react'

export const Route = createFileRoute('/app/')({
  head: () => ({
    meta: [
      { title: 'Dashboard · ASI Architect' },
      { name: 'description', content: 'ASI Architect — Prototype & Evaluate Superintelligence Modules.' },
    ],
  }),
  component: DashboardHome,
})

const MODULES = [
  { title: 'AI Chat', description: 'Talk to the AI assistant with prompt clips, quick questions, and multiple-choice interactions.', icon: MessageSquare, href: '/app/chat' },
  { title: 'Experiments', description: 'Design and run ASI module experiments with structured protocols.', icon: FlaskConical, href: '/app/experiments' },
  { title: 'Architecture', description: 'Define and compose superintelligence subsystems and data flows.', icon: Network, href: '/app/architecture' },
  { title: 'Knowledge & Reasoning', description: 'Build knowledge graphs and inference engines for ASI cognition.', icon: Brain, href: '/app/knowledge' },
  { title: 'ASI Core', description: 'Monitor compute, memory, and core metrics across the platform.', icon: Cpu, href: '/app' },
]

function DashboardHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">ASI Architect</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prototype, integrate, and evaluate the essential modules for building an Artificial Superintelligence.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {MODULES.map(({ title, description, icon: Icon, href }) => (
          <Link
            key={title}
            to={href}
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] transition-transform duration-100"
          >
            <Card className="h-full transition-colors group-hover:border-primary/50 cursor-pointer">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-medium group-hover:text-primary transition-colors">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
