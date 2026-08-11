import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Brain, Search, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Brain, Search, Sparkles, ArrowRight } from 'lucide-react'

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
  const [status, setStatus] = useState('Idle. Ready to query knowledge base.')
  const [loading, setLoading] = useState(false)

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setStatus(`Searching knowledge graphs for "${query}"...`)
    setTimeout(() => {
      setLoading(false)
      const q = query.toLowerCase().trim()
      if (q.includes('sandbox') || q.includes('containment') || q.includes('safety')) {
        setStatus(`Found 1 semantic rule for "${query}": Containment isolation constraint is strict and fully verified.`)
      } else if (q.includes('consensus') || q.includes('hive') || q.includes('coordination')) {
        setStatus(`Found 1 semantic rule for "${query}": Multi-agent consensus protocol requires 2/3 trust majority.`)
      } else {
        setStatus(`Query completed. No semantic rules found for "${query}". Try searching "containment" or "consensus".`)
      }
    }, 400)
  }

  return (
    <div className="space-y-6 p-4 animate-fade-in">
    <div className="space-y-6 p-4 animate-fade-in max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          Knowledge & Reasoning
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build, evaluate, and query knowledge graphs, symbolic reasoning engines, and inference pipelines.
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
      <Card className="border-2 border-dashed border-muted-foreground/20 bg-card/40 backdrop-blur-xs">
        <CardHeader>
          <CardTitle className="text-lg">ASI Knowledge Base</CardTitle>
          <CardDescription>
            Query local semantic rules or navigate to the AI Chat to construct complex multi-turn inferences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleQuery} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="semantic-query" className="text-sm font-medium">
                Semantic Rule Search
              </Label>
              <div className="flex gap-2">
                <Input
                  id="semantic-query"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. containment, consensus..."
                  disabled={loading}
                  className="flex-1 focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="gap-2 active:scale-95 transition-all duration-150"
                  aria-label="Search semantic rules"
                >
                  <Search className="h-4 w-4" />
                  Query
                </Button>
              </div>
            </div>
          </form>

          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-border bg-muted/30 p-4 min-h-[64px] flex items-center justify-center text-center text-xs text-muted-foreground transition-all duration-200"
          >
            {status}
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild className="gap-2 active:scale-95 transition-all duration-150">
              <Link to="/app/chat">
                <Sparkles className="h-4 w-4" />
                Ask AI Chat
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
