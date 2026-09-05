import { createFileRoute, Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Cpu, FlaskConical, Brain, MessageSquare, Blocks, ArrowUpRight, Bot } from 'lucide-react'

export const Route = createFileRoute('/app/')({
  head: () => ({
    meta: [
      { title: 'Dashboard · Corona' },
      { name: 'description', content: 'Corona — Prototype & Evaluate Superintelligence Modules.' },
    ],
  }),
  component: DashboardHome,
})

const MODULES = [
  { title: 'AI Chat', description: 'Talk to the AI assistant with agent-suggested follow-up prompts.', icon: MessageSquare, href: '/app/chat' },
  { title: 'Extension Builder', description: 'Drag-and-connect neuron editor: build, train, and deploy extensions.', icon: Blocks, href: '/builder' },
  // Experiments is now the Experiments tab of Self-Improvement, not its own route.
  { title: 'Experiments', description: 'Design and run ASI module experiments with structured protocols.', icon: FlaskConical, href: '/app/self-improvement' },
  // Knowledge & Reasoning is now a tab of the Extension Builder, not its own route.
  { title: 'Knowledge & Reasoning', description: 'Build knowledge graphs and inference engines for ASI cognition.', icon: Brain, href: '/builder' },
  { title: 'ASI Core', description: 'Monitor compute, memory, and core metrics across the platform.', icon: Cpu, href: '/app' },
  // Deep-links straight into the real wiki/Bots.md page (see /app/store's
  // validateSearch) instead of dropping the user on Home to go find it.
  { title: 'Automated Bots', description: 'Which bots (Bolt, Sentinel, Palette, Jules) work on this repo, and the concurrent-PR corruption bug their overlapping PRs cause.', icon: Bot, href: '/app/store', search: { page: 'Bots' } },
]

function DashboardHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Corona</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prototype, integrate, and evaluate the essential modules for building an Artificial Superintelligence.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {MODULES.map(({ title, description, icon: Icon, href, search }) => (
          <Link
            key={title}
            to={href}
            search={search}
            aria-label={`Open ${title}: ${description}`}
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] transition-all duration-150"
          >
            <Card className="relative h-full transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-md group-hover:border-primary/50 cursor-pointer overflow-hidden">
              <CardHeader className="flex flex-row items-center gap-3 pb-2 pr-10">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-primary/10 text-primary group-hover:bg-primary/20 transition-all duration-300 group-hover:scale-110">
                  <Icon className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-medium group-hover:text-primary transition-colors">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </CardContent>
              <div className="absolute top-4 right-4 text-muted-foreground/30 group-hover:text-primary/70 transition-all duration-200 transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                <ArrowUpRight className="h-4 w-4" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
