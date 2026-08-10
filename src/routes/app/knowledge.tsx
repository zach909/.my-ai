import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Brain, Sparkles, MessageSquare } from 'lucide-react'

export const Route = createFileRoute('/app/knowledge')({
  head: () => ({
    meta: [
      { title: 'Knowledge & Reasoning · ASI Architect' },
      { name: 'description', content: 'Build knowledge graphs and inference engines for ASI cognition.' },
    ],
  }),
  component: KnowledgePage,
})

function KnowledgePage() {
  const [query, setQuery] = useState('')
  const [res, setRes] = useState<string | null>(null)

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim().toLowerCase()
    if (!q) return
    setRes(q.includes('containment')
      ? 'CONTAINMENT: Sandbox isolation is enforced at layer 3.'
      : q.includes('trust')
      ? 'TRUST: Hive consensus validation score is 0.95.'
      : `No matches found for "${query}". Try "containment" or "trust".`
    )
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Knowledge & Reasoning</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build and evaluate knowledge graphs, symbolic reasoning engines, and inference pipelines.
        </p>
      </div>

      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-8 text-center max-w-xl mx-auto bg-card/50">
        <div className="rounded-full bg-primary/10 p-3 mb-3 hover:scale-105 transition-all">
          <Brain className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-sm font-semibold">Cognitive Knowledge Base</h3>
        <p className="text-xs text-muted-foreground max-w-xs mt-1 mb-4">
          Query the ASI semantic graph or ask the AI assistant to synthesize reasoning rules.
        </p>

        <form onSubmit={handleQuery} className="flex gap-2 w-full max-w-md mx-auto mb-4">
          <Label htmlFor="knowledge-query" className="sr-only">Query Knowledge Base</Label>
          <Input id="knowledge-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search (e.g. containment, trust)..." className="flex-1 text-xs h-9" />
          <Button type="submit" size="sm" className="active:scale-95 transition-all" aria-label="Query database">Query</Button>
        </form>

        {res && (
          <div role="status" aria-live="polite" className="w-full max-w-md p-3 mb-4 rounded-lg bg-accent/50 text-xs text-foreground text-left flex items-start gap-2 border border-border">
            <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p className="leading-relaxed">{res}</p>
          </div>
        )}

        <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all">
          <Link to="/app/chat" className="flex items-center gap-1.5"><MessageSquare size={13} />Ask AI Chat</Link>
        </Button>
      </Card>
    </div>
  )
}
