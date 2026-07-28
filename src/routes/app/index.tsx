import { createFileRoute, Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Cpu, FlaskConical, Network, Brain } from 'lucide-react'

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
          <Link key={title} to={href as any}>
            <Card className="h-full transition-colors hover:border-primary/50 cursor-pointer">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
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
