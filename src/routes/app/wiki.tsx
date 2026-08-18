import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Bot, BookOpen, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
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

type WikiSource = 'human' | 'bot'

interface WikiPageSummary {
  name: string
  title: string
  description: string
  source: WikiSource
}

function WikiPage() {
  const { page: requestedPage } = Route.useSearch()
  const [pages, setPages] = useState<WikiPageSummary[]>([])
  const [pagesLoading, setPagesLoading] = useState(true)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentTitle, setContentTitle] = useState<string>('')
  const [contentSource, setContentSource] = useState<WikiSource>('human')
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  // Set to the page's name while editing an existing bot-published page
  // (as opposed to creating a brand new one) -- publishWikiPage() already
  // overwrites a same-named file unconditionally, so "edit" and "publish"
  // are the same backend call; this only changes what the form shows and
  // keeps the name field locked so an edit can never accidentally become a
  // second page under a different name, orphaning the original.
  const [editingName, setEditingName] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)

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
      .then((data: { content: string; title: string; source: WikiSource }) => {
        if (cancelled) return
        setContent(data.content)
        setContentTitle(data.title || activeName)
        setContentSource(data.source ?? 'human')
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

  // Two visibly distinct groups, never interleaved: the curated wiki/*.md
  // pages (source: 'human') and pages published through POST /api/wiki
  // (source: 'bot' -- wiki/bot/*.md, written by WikiPlugin on the AI's own
  // behalf or by this page's own "New Page" form). See models && skills/
  // core/wiki-store.ts's module doc for why they're kept in separate
  // directories rather than one flat list.
  const curatedPages = useMemo(() => filteredPages.filter(p => p.source === 'human'), [filteredPages])
  const botPages = useMemo(() => filteredPages.filter(p => p.source === 'bot'), [filteredPages])

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
      // Always 'bot' -- publishWikiPage() (the function this endpoint and
      // WikiPlugin.publish() both call) only ever writes into wiki/bot/,
      // never the curated wiki/ directory, regardless of who submitted it.
      const summary: WikiPageSummary = { name: data.name, title: data.title, description: data.description, source: 'bot' }
      setPages(prev => [...prev.filter(p => p.name !== summary.name), summary])
      setActiveName(summary.name)
      setContent(data.content)
      setContentTitle(data.title)
      setContentSource('bot')
      setCreating(false)
      setEditingName(null)
      setNewName('')
      setNewTitle('')
      setNewContent('')
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish page')
    } finally {
      setPublishLoading(false)
    }
  }

  // Opens the same form pre-filled with the currently-viewed bot page's own
  // content -- "edit" is just "publish again with the same name", which
  // publishWikiPage() already treats as an overwrite (see models &&
  // skills/core/wiki-store.ts), so no separate PUT endpoint is needed.
  const startEditingPage = () => {
    if (!activeName || contentSource !== 'bot' || content == null) return
    setEditingName(activeName)
    setNewName(activeName)
    setNewTitle(contentTitle)
    setNewContent(content)
    setPublishError(null)
    setCreating(true)
  }

  // Same idea as startEditingPage(), but for a sidebar row that isn't
  // necessarily the page currently open in the content pane -- fetches its
  // content fresh (the `content`/`contentTitle` state only reflects
  // whichever page is active) rather than requiring "view it, then click
  // Edit" first.
  const startEditingNamedPage = async (name: string, fallbackTitle: string) => {
    setPublishError(null)
    try {
      const res = await fetch(`/api/wiki/${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error(`Page "${name}" not found`)
      const data: { content: string; title: string; source: WikiSource } = await res.json()
      setActiveName(name)
      setContent(data.content)
      setContentTitle(data.title || fallbackTitle)
      setContentSource(data.source ?? 'bot')
      setEditingName(name)
      setNewName(name)
      setNewTitle(data.title || fallbackTitle)
      setNewContent(data.content)
      setCreating(true)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to load page for editing')
    }
  }

  const cancelForm = () => {
    setCreating(false)
    setEditingName(null)
    setNewName('')
    setNewTitle('')
    setNewContent('')
    setPublishError(null)
  }

  // Cleanup for a page that got created under the wrong name (the case
  // that motivated adding this at all: before Edit locked the name field
  // and was reliably reachable, "editing" via New Page under a slightly
  // different name than the original just created a duplicate) -- there
  // was previously no way to remove it once that happened.
  const deletePage = async (name: string, title: string) => {
    if (!window.confirm(`Delete "${title || name}"? This can't be undone.`)) return
    setDeletingName(name)
    try {
      const res = await fetch(`/api/wiki/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete page')
      setPages(prev => prev.filter(p => p.name !== name))
      if (activeName === name) {
        setActiveName(null)
        setContent(null)
        setContentTitle('')
      }
      if (editingName === name) cancelForm()
    } catch (err) {
      // Deletion can be triggered from a sidebar row while the New
      // Page/Edit form isn't open at all, so publishError (only rendered
      // inside that form) isn't a reliable place to surface this -- an
      // alert is blunt, but guaranteed visible regardless of what's open.
      window.alert(err instanceof Error ? err.message : 'Failed to delete page')
    } finally {
      setDeletingName(null)
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
              if (creating) {
                cancelForm()
              } else {
                setEditingName(null)
                setNewName('')
                setNewTitle('')
                setNewContent('')
                setCreating(true)
                setPublishError(null)
              }
            }}
            className="mb-2 w-full gap-1.5 text-xs active:scale-95 transition-all duration-150"
            aria-label={creating ? 'Cancel' : 'Create a new wiki page'}
            aria-expanded={creating}
          >
            {creating ? <X size={13} /> : <Plus size={13} />}
            {creating ? 'Cancel' : 'New Page'}
          </Button>
          {creating && (
            <div className="mb-3 space-y-2 rounded-md border border-border p-2.5">
              <p className="text-[11px] font-medium text-foreground">
                {editingName ? `Editing "${editingName}"` : 'New bot-published page'}
              </p>
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
                  disabled={publishLoading || !!editingName}
                  title={editingName ? "Renaming isn't supported here -- publish under a new name instead if you need a different one." : undefined}
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
                aria-label={editingName ? 'Save changes to this wiki page' : 'Publish new wiki page'}
              >
                {publishLoading ? <Loader2 size={13} className="animate-spin" /> : editingName ? <Pencil size={13} /> : <Plus size={13} />}
                {publishLoading ? (editingName ? 'Saving...' : 'Publishing...') : editingName ? 'Save Changes' : 'Publish'}
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
            <nav className="max-h-[70vh] space-y-3 overflow-y-auto" aria-label="Wiki pages">
              <div className="space-y-0.5">
                <p
                  className="px-2 pb-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                  title="Curated pages -- read-only in the app, changed only through a real commit to wiki/"
                >
                  Wiki
                </p>
                {curatedPages.map(p => (
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
                {curatedPages.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No pages match "{query}".</p>
                )}
              </div>
              {/* Always shown, even with zero pages -- previously this whole
                  section was hidden until at least one bot page existed,
                  which meant a first-time user saw no indication "Bot Wiki"
                  (and therefore Edit, which only ever appears on a bot
                  page) was a feature at all, not just that it was empty. */}
              <div className="space-y-0.5 border-t border-border pt-2">
                <p
                  className="flex items-center gap-1 px-2 pb-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider"
                  title="Published from the app (by you, or by the AI) -- editable and deletable, hover a page for controls"
                >
                  <Bot size={11} />
                  Bot Wiki
                </p>
                {botPages.length === 0 && !query && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    No bot-published pages yet. Use "New Page" above to create one -- it'll show up here, editable.
                  </p>
                )}
                {botPages.length === 0 && query && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No pages match "{query}".</p>
                )}
                {botPages.map(p => (
                  <div
                    key={p.name}
                    className={`group flex items-center gap-0.5 rounded-md transition-colors ${
                      activeName === p.name ? 'bg-primary/10' : 'hover:bg-muted/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveName(p.name)}
                      aria-current={activeName === p.name ? 'page' : undefined}
                      className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        activeName === p.name ? 'text-primary font-medium' : 'text-muted-foreground group-hover:text-foreground'
                      }`}
                      title={p.description}
                    >
                      {p.title || p.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditingNamedPage(p.name, p.title)}
                      className="flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 active:scale-90 cursor-pointer"
                      aria-label={`Edit ${p.title || p.name}`}
                      title={`Edit ${p.title || p.name}`}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePage(p.name, p.title)}
                      disabled={deletingName === p.name}
                      className="mr-1 flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive group-hover:opacity-100 active:scale-90 cursor-pointer disabled:opacity-50"
                      aria-label={`Delete ${p.title || p.name}`}
                      title={`Delete ${p.title || p.name}`}
                    >
                      {deletingName === p.name ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    </button>
                  </div>
                ))}
              </div>
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
          <article aria-label={contentTitle}>
            {/* Every page explains why it can or can't be edited here --
                previously a curated page silently showed no Edit button
                with no explanation at all, which read as "the feature is
                broken" rather than "this page is protected by design". */}
            {contentSource === 'human' && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground w-fit">
                <BookOpen size={13} />
                Curated wiki page — not editable in the app; changes go through a real commit to wiki/
              </div>
            )}
            {contentSource === 'bot' && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary w-fit">
                <Bot size={13} />
                Bot-published — not part of the curated wiki
                <button
                  type="button"
                  onClick={startEditingPage}
                  className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                  aria-label={`Edit ${contentTitle}`}
                >
                  <Pencil size={11} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => activeName && deletePage(activeName, contentTitle)}
                  disabled={deletingName === activeName}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-primary hover:bg-destructive/10 hover:text-destructive active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer disabled:opacity-50"
                  aria-label={`Delete ${contentTitle}`}
                >
                  {deletingName === activeName ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  Delete
                </button>
              </div>
            )}
            {renderWikiMarkdown(content, { onWikiLink: resolveAndNavigate })}
          </article>
        )}
        {!contentLoading && !contentError && !content && !activeName && (
          <p className="text-sm text-muted-foreground">Select a page from the list.</p>
        )}
      </Card>
    </div>
  )
}
