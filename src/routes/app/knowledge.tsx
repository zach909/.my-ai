import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Brain, Search, Sparkles, ArrowRight, Loader2, Copy, Check } from 'lucide-react'

export const Route = createFileRoute('/app/knowledge')({
  head: () => ({
    meta: [
      { title: 'Knowledge & Reasoning · ASI Architect' },
      { name: 'description', content: 'Build knowledge graphs and inference engines for ASI cognition.' },
    ],
  }),
  component: KnowledgePage,
})

function CopyResultButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none shrink-0"
      onClick={handleCopy}
      aria-label={copied ? 'Query result copied' : 'Copy query result'}
      title={copied ? 'Copied to clipboard' : 'Copy query result'}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
    </Button>
  )
}

const SUGGESTIONS = [
  { id: 'containment', text: 'containment', label: 'containment' },
  { id: 'consensus', text: 'consensus', label: 'consensus' },
  { id: 'coordination', text: 'coordination', label: 'coordination' },
]

function CopyResultButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 active:scale-95 text-muted-foreground hover:text-foreground hover:bg-muted/80 cursor-pointer"
      onClick={handleCopy}
      aria-label={copied ? 'Copied search status to clipboard' : 'Copy search status'}
      title={copied ? 'Copied search status to clipboard' : 'Copy search status'}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </Button>
  )
}

function KnowledgePage() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Idle. Ready to query knowledge base.')
  const [loading, setLoading] = useState(false)

  const executeSearch = (searchText: string) => {
    setLoading(true)
    setStatus(`Searching knowledge graphs for "${searchText}"...`)
    setTimeout(() => {
      setLoading(false)
      const q = searchText.toLowerCase().trim()
      if (q.includes('sandbox') || q.includes('containment') || q.includes('safety')) {
        setStatus(`Found 1 semantic rule for "${searchText}": Containment isolation constraint is strict and fully verified.`)
      } else if (q.includes('consensus') || q.includes('hive') || q.includes('coordination')) {
        setStatus(`Found 1 semantic rule for "${searchText}": Multi-agent consensus protocol requires 2/3 trust majority.`)
      } else {
        setStatus(`Query completed. No semantic rules found for "${searchText}". Try searching "containment" or "consensus".`)
      }
    }, 400)
  }

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    executeSearch(query)
  }

  const handleSuggestionClick = (searchText: string) => {
    setQuery(searchText)
    executeSearch(searchText)
  }

  return (
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
                  aria-label={loading ? "Searching semantic rules" : "Search semantic rules"}
                  title={loading ? "Searching..." : "Search semantic rules"}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  {loading ? "Querying..." : "Query"}
                </Button>
              </div>
            </div>
          </form>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground italic">
              Suggested queries:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  disabled={loading}
                  onClick={() => handleSuggestionClick(suggestion.text)}
                  className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Search suggestion: ${suggestion.label}`}
                >
                  +{suggestion.label}
                </button>
              ))}
            </div>
          </div>

          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-border bg-muted/30 p-4 min-h-[64px] flex items-center justify-between gap-3 text-xs text-muted-foreground transition-all duration-200"
          >
            <span className="flex-1 text-center">{status}</span>
            {!loading && status !== 'Idle. Ready to query knowledge base.' && (
              <CopyResultButton text={status} />
            )}
          <div className="group relative">
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-border bg-muted/30 p-4 pr-10 min-h-[64px] flex items-center justify-center text-center text-xs text-muted-foreground transition-all duration-200"
            >
              {status}
            </div>
            {!loading && status && <CopyResultButton text={status} />}
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
