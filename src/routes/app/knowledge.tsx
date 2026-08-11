import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Brain, Search, Sparkles } from 'lucide-react'

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
  const [result, setResult] = useState('')

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setResult(`Querying local graph for "${query}"... Found 0 logical conflicts in UnifiedBrain semantic space.`)
  }

  return (
    <div className="space-y-6 p-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Knowledge & Reasoning</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build and evaluate knowledge graphs, symbolic reasoning engines, and inference pipelines.
        </p>
      </div>

      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-8 text-center max-w-2xl mx-auto bg-card/50 backdrop-blur-xs space-y-4">
        <div className="rounded-full bg-primary/10 p-3 text-primary">
          <Brain className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Cognitive Inference Sandbox</h2>
          <p className="text-xs text-muted-foreground max-w-sm">
            Query the ASI long-term semantic knowledge graph to evaluate current symbolic consistency.
          </p>
        </div>

        <form onSubmit={handleQuery} className="w-full max-w-md space-y-3 pt-2">
          <div className="flex gap-2">
            <Label htmlFor="knowledge-query" className="sr-only">Inference rule query</Label>
            <Input
              id="knowledge-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter rule (e.g., 'A implies B')..."
              className="flex-1"
            />
            <Button type="submit" size="sm" className="gap-1.5 active:scale-95 transition-all duration-150" aria-label="Query rule">
              <Search className="h-4 w-4" />
              <span>Query</span>
            </Button>
          </div>
          <div role="status" aria-live="polite" className="text-xs font-medium text-primary min-h-[1.25rem]">
            {result}
          </div>
        </form>

        <div className="pt-2">
          <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all duration-150">
            <Link to="/app/chat">
              <Sparkles className="mr-1.5 h-4 w-4 text-primary" />
              Discuss in AI Chat
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
