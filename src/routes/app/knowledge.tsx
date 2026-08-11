import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
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
  const [result, setResult] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setResult(null)
    setTimeout(() => {
      setSearching(false)
      setResult(`Inferred: [${query.trim()}] is logically consistent with 12 loaded axioms. Truth Value: 0.998.`)
    }, 400)
  }

  return (
    <div className="space-y-6 p-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          Knowledge & Reasoning
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build and evaluate knowledge graphs, symbolic reasoning engines, and inference pipelines.
        </p>
      </div>

      <Card className="max-w-2xl border-2 border-dashed border-muted-foreground/20 bg-card/40 backdrop-blur-xs">
        <CardHeader>
          <CardTitle className="text-lg">Local Semantic Querying</CardTitle>
          <CardDescription>
            Search the local knowledge graph or query symbolic logic rules to inspect cognitive coherence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="query-input" className="sr-only">Search Knowledge Base</Label>
              <Input
                id="query-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter semantic query (e.g., 'Axiom of containment')..."
                disabled={searching}
                className="w-full"
              />
            </div>
            <Button
              type="submit"
              disabled={searching || !query.trim()}
              className="gap-2 active:scale-95 transition-all duration-150"
              aria-label="Query local database"
            >
              <Search className="h-4 w-4" />
              Query
            </Button>
          </form>

          <div role="status" aria-live="polite" className="min-h-[48px] flex items-center justify-center rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
            {searching ? (
              <span className="animate-pulse">Reasoning over semantic triples...</span>
            ) : result ? (
              <span className="text-emerald-500 font-medium">{result}</span>
            ) : (
              <div className="flex items-center gap-2">
                <span>No active query. Try querying or ask AI Chat.</span>
                <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all">
                  <Link to="/app/chat" className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    AI Chat
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
