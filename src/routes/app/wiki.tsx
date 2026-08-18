import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { BookOpen, Loader2, Search, X } from 'lucide-react'
import { renderWikiMarkdown } from '@/lib/wiki-markdown'

export const Route = createFileRoute('/app/wiki')({
  head: () => ({
    meta: [
      { title: 'Wiki · ASI Architect' },
      { name: 'description', content: 'Browse the project wiki — architecture, subsystem specs, and design notes — without leaving the app.' },
    ],
  }),
  component: WikiPage,
})

interface WikiPageSummary {
  name: string
  title: string
  description: string
}

function WikiPage() {
  const [pages, setPages] = useState<WikiPageSummary[]>([])
  const [pagesLoading, setPagesLoading] = useState(true)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentTitle, setContentTitle] = useState<string>('')
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Real list of every wiki/*.md page, fetched from GET /api/wiki -- see
  // interface/web-server.ts. Not a hardcoded catalog: adding a new page
  // under wiki/ shows up here on next load with no code change.
  useEffect(() => {
    let cancelled = false
    setPagesLoading(true)
    fetch('/api/wiki')
      .then(res => res.json())
      .then((data: { pages: WikiPageSummary[] }) => {
        if (cancelled) return
        setPages(data.pages ?? [])
        setPagesError(null)
        const home = data.pages?.find(p => p.name === 'Home') ?? data.pages?.[0]
        if (home) setActiveName(home.name)
      })
      .catch((err: unknown) => {
        if (!cancelled) setPagesError(err instanceof Error ? err.message : 'Failed to load wiki index')
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeName) return
    let cancelled = false
    setContentLoading(true)
    setContentError(null)
    fetch(`/api/wiki/${encodeURIComponent(activeName)}`)
      .then(res => {
        if (!res.ok) throw new Error(`Page "${activeName}" not found`)
        return res.json()
      })
      .then((data: { content: string; title: string }) => {
        if (cancelled) return
        setContent(data.content)
        setContentTitle(data.title || activeName)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setContentError(err instanceof Error ? err.message : 'Failed to load page')
          setContent(null)
        }
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeName])

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pages
    return pages.filter(
      p => p.title.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    )
  }, [pages, query])

  // A [[Page]] link inside rendered content may reference a page by its
  // display title rather than its file stem (wiki/*.md's own convention --
  // e.g. [[Elastic Value Budget|Elastic-Value-Budget]] links by title with
  // the stem as the piped target, but plain [[Home]] links by stem
  // directly) -- resolve either form against the real index before
  // navigating, and fail visibly rather than silently do nothing.
  const resolveAndNavigate = (target: string) => {
    const bySlug = pages.find(p => p.name === target)
    if (bySlug) {
      setActiveName(bySlug.name)
      return
    }
    const byTitle = pages.find(p => p.title.toLowerCase() === target.toLowerCase())
    if (byTitle) {
      setActiveName(byTitle.name)
      return
    }
    setContentError(`Wiki link target "${target}" doesn't match any page`)
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 animate-fade-in md:grid-cols-[260px_1fr]">
      <div>
        <div className="mb-3">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <BookOpen className="h-6 w-6 text-primary" />
            Wiki
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Architecture, subsystem specs, and design notes — the same content as the project's GitHub wiki.
          </p>
        </div>
        <Card className="p-3">
          <div className="relative mb-2">
            <Label htmlFor="wiki-search-input" className="sr-only">
              Search wiki pages
            </Label>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="wiki-search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search pages..."
              disabled={pagesLoading}
              className="h-8 pl-7 pr-7 text-xs focus-visible:ring-2 focus-visible:ring-ring"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search filter"
                title="Clear search filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm p-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div role="status" aria-live="polite" className="sr-only">
            {!pagesLoading && !pagesError && `${filteredPages.length} wiki ${filteredPages.length === 1 ? 'page' : 'pages'} found.`}
          </div>
          {pagesLoading && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading wiki index...
            </div>
          )}
          {pagesError && (
            <p role="alert" className="px-2 py-3 text-xs text-destructive">
              {pagesError}
            </p>
          )}
          {!pagesLoading && !pagesError && (
            <nav className="max-h-[70vh] space-y-0.5 overflow-y-auto" aria-label="Wiki pages">
              {filteredPages.map(p => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setActiveName(p.name)}
                  aria-current={activeName === p.name ? 'page' : undefined}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    activeName === p.name
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                  title={p.description}
                >
                  {p.title || p.name}
                </button>
              ))}
              {filteredPages.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground space-y-1">
                  <p>No pages match "{query}".</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuery('')}
                    aria-label="Clear search query filter"
                    className="h-6 px-2 text-[11px] active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Clear Search Filter
                  </Button>
                </div>
              )}
            </nav>
          )}
        </Card>
      </div>

      <Card className="min-h-0 overflow-y-auto p-6">
        {contentLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading {activeName}...
          </div>
        )}
        {contentError && (
          <p role="alert" className="text-sm text-destructive">
            {contentError}
          </p>
        )}
        {!contentLoading && !contentError && content && (
          <article aria-label={contentTitle}>{renderWikiMarkdown(content, { onWikiLink: resolveAndNavigate })}</article>
        )}
        {!contentLoading && !contentError && !content && !activeName && (
          <p className="text-sm text-muted-foreground">Select a page from the list.</p>
        )}
      </Card>
    </div>
  )
}
