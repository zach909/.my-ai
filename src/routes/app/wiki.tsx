import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { BookOpen, Loader2, Plus, Search, X } from 'lucide-react'
import { renderWikiMarkdown } from '@/lib/wiki-markdown'

interface WikiSearch {
  page?: string
}

export const Route = createFileRoute('/app/wiki')({
  // Lets a link elsewhere in the app (e.g. the Dashboard's "Automated Bots"
  // shortcut) deep-link straight to one page via /app/wiki?page=Bots instead
  // of landing on Home and making the user find it in the sidebar.
  validateSearch: (search: Record<string, unknown>): WikiSearch => ({
    page: typeof search.page === 'string' ? search.page : undefined,
  }),
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
  const { page: requestedPage } = Route.useSearch()
  const [pages, setPages] = useState<WikiPageSummary[]>([])
  const [pagesLoading, setPagesLoading] = useState(true)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentTitle, setContentTitle] = useState<string>('')
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

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
        const requested = requestedPage
          ? data.pages?.find(p => p.name === requestedPage || p.title.toLowerCase() === requestedPage.toLowerCase())
          : undefined
        const initial = requested ?? data.pages?.find(p => p.name === 'Home') ?? data.pages?.[0]
        if (initial) setActiveName(initial.name)
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

  // Publishes through the exact same POST /api/wiki that WikiPlugin's own
  // publish() action uses internally (see plugins/wiki.ts, models &&
  // skills/core/wiki-store.ts) -- a page created here looks identical to
  // one the AI creates itself as part of docs/SKILL_ACQUISITION_LOOP.md's
  // "push the wiki page" step, and both show up immediately in the list
  // below since GET /api/wiki always reads the real directory.
  const publishPage = async () => {
    const name = newName.trim()
    const title = newTitle.trim()
    const body = newContent.trim()
    if (!name || !title || !body) {
      setPublishError('Name, title, and content are all required.')
      return
    }
    setPublishLoading(true)
    setPublishError(null)
    try {
      const res = await fetch('/api/wiki', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, title, content: body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to publish page')
      const summary: WikiPageSummary = { name: data.name, title: data.title, description: data.description }
      setPages(prev => [...prev.filter(p => p.name !== summary.name), summary].sort((a, b) => a.title.localeCompare(b.title)))
      setActiveName(summary.name)
      setContent(data.content)
      setContentTitle(data.title)
      setCreating(false)
      setNewName('')
      setNewTitle('')
      setNewContent('')
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish page')
    } finally {
      setPublishLoading(false)
    }
  }

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
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search pages..."
              disabled={pagesLoading}
              className="h-8 pl-7 text-xs"
              aria-label="Search wiki pages"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating(v => !v)
              setPublishError(null)
            }}
            className="mb-2 w-full gap-1.5 text-xs active:scale-95 transition-all duration-150"
            aria-label={creating ? 'Cancel new wiki page' : 'Create a new wiki page'}
            aria-expanded={creating}
          >
            {creating ? <X size={13} /> : <Plus size={13} />}
            {creating ? 'Cancel' : 'New Page'}
          </Button>
          {creating && (
            <div className="mb-3 space-y-2 rounded-md border border-border p-2.5">
              <div className="space-y-1">
                <Label htmlFor="wiki-new-name" className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Page name (file stem)
                </Label>
                <Input
                  id="wiki-new-name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. My-New-Page"
                  className="h-7 text-xs"
                  disabled={publishLoading}
                  aria-label="New page name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wiki-new-title" className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Title
                </Label>
                <Input
                  id="wiki-new-title"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. My New Page"
                  className="h-7 text-xs"
                  disabled={publishLoading}
                  aria-label="New page title"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wiki-new-content" className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Content (Markdown)
                </Label>
                <textarea
                  id="wiki-new-content"
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  placeholder="Write the page in Markdown -- headings, lists, tables, and [[Other Page]] links are all supported."
                  disabled={publishLoading}
                  rows={6}
                  className="flex w-full min-w-0 rounded-md border border-input bg-transparent px-2 py-1.5 text-xs shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="New page content"
                />
              </div>
              {publishError && (
                <p role="alert" className="text-[11px] text-destructive">
                  {publishError}
                </p>
              )}
              <Button
                type="button"
                size="sm"
                onClick={publishPage}
                disabled={publishLoading}
                className="w-full gap-1.5 text-xs active:scale-95 transition-all duration-150"
                aria-label="Publish new wiki page"
              >
                {publishLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {publishLoading ? 'Publishing...' : 'Publish'}
              </Button>
            </div>
          )}
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
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
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
                <p className="px-2 py-3 text-xs text-muted-foreground">No pages match "{query}".</p>
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
