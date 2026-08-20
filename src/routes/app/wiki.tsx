/**
 * Wiki & Skills — one page, two tabs sharing real cross-links: browsing
 * wiki/*.md and wiki/bot/*.md (see models && skills/core/wiki-store.ts),
 * and managing Skill Uploads packages (models && skills/core/
 * skill-upload-store.ts) that can point at a bot wiki page as their
 * documentation. They used to be two separate nav entries/routes
 * (/app/wiki and /app/skill-uploads); combined here because the two
 * already reference each other (a skill package's Bot Wiki row links
 * straight into the Wiki tab, and this page's own Chat buttons send you to
 * /app/shared-chat) and a single page makes that round trip one click
 * instead of a sidebar hop each way.
 *
 * Every bot-published page also gets its own inline "Files & Install"
 * panel (WikiPageFilesPanel below) right on the page -- the plugin,
 * source/binary skill, algorithm, RSI test, and extra-files uploads, plus
 * the real Install Skill/Install Plugin actions, scoped to a skill package
 * named after the page itself. That's the same package the Skill Uploads
 * tab's "link a bot wiki page" picker points at (skill-upload-store.ts's
 * `wikiPage` field) -- uploading here self-links automatically, so a
 * package created this way needs no separate manual linking step, while
 * the Skill Uploads tab still exists for packages that don't share a name
 * with any wiki page.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Blocks,
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FlaskConical,
  Link2,
  Link2Off,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { renderWikiMarkdown } from '@/lib/wiki-markdown'

interface WikiSearch {
  page?: string
  tab?: 'wiki' | 'skills'
}

export const Route = createFileRoute('/app/wiki')({
  // Lets a link elsewhere in the app (e.g. the Dashboard's "Automated Bots"
  // shortcut, or a Skill Uploads package's own Bot Wiki link) deep-link
  // straight to one page or tab via /app/wiki?page=Bots or
  // /app/wiki?tab=skills instead of landing on the Wiki tab every time.
  validateSearch: (search: Record<string, unknown>): WikiSearch => ({
    page: typeof search.page === 'string' ? search.page : undefined,
    tab: search.tab === 'skills' ? 'skills' : undefined,
  }),
  head: () => ({
    meta: [
      { title: 'Wiki & Skills · ASI Architect' },
      { name: 'description', content: 'Browse the project wiki and manage Skill Uploads packages without leaving the app.' },
    ],
  }),
  component: WikiAndSkillsPage,
})

function WikiAndSkillsPage() {
  const { tab: requestedTab } = Route.useSearch()
  const [tab, setTab] = useState<'wiki' | 'skills'>(requestedTab ?? 'wiki')

  return (
    <div className="flex h-full flex-col gap-4 p-4 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <BookOpen className="h-6 w-6 text-primary" />
          Wiki & Skills
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Architecture notes and design docs, plus the plugin/skill/algorithm/RSI-test packages that implement
          them — a skill package can link to a bot wiki page as its documentation.
        </p>
        <div className="mt-3 flex gap-1 border-b border-border">
          <button
            type="button"
            onClick={() => setTab('wiki')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              tab === 'wiki' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            aria-current={tab === 'wiki' ? 'page' : undefined}
          >
            <BookOpen size={14} />
            Wiki
          </button>
          <button
            type="button"
            onClick={() => setTab('skills')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              tab === 'skills' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            aria-current={tab === 'skills' ? 'page' : undefined}
          >
            <Upload size={14} />
            Skill Uploads
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'wiki' ? <WikiPanel /> : <SkillUploadsPanel />}
      </div>
    </div>
  )
}

type WikiSource = 'human' | 'bot'

interface WikiPageSummary {
  name: string
  title: string
  description: string
  source: WikiSource
}

function WikiPanel() {
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
    <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
      <div>
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
                    <Link
                      to="/app/shared-chat"
                      search={{ topic: p.title || p.name }}
                      className="mr-1 flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 active:scale-90 cursor-pointer"
                      aria-label={`Discuss ${p.title || p.name} in Shared Chat`}
                      title={`Discuss ${p.title || p.name} in Shared Chat`}
                    >
                      <MessageSquare size={11} />
                    </Link>
                  </div>
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
                    <Link
                      to="/app/shared-chat"
                      search={{ topic: p.title || p.name }}
                      className="flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 active:scale-90 cursor-pointer"
                      aria-label={`Discuss ${p.title || p.name} in Shared Chat`}
                      title={`Discuss ${p.title || p.name} in Shared Chat`}
                    >
                      <MessageSquare size={11} />
                    </Link>
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
                {activeName && (
                  <Link
                    to="/app/shared-chat"
                    search={{ topic: contentTitle }}
                    className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                    aria-label={`Discuss ${contentTitle} in Shared Chat`}
                  >
                    <MessageSquare size={11} />
                    Chat
                  </Link>
                )}
              </div>
            )}
            {contentSource === 'bot' && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary w-fit">
                <Bot size={13} />
                Bot-published — not part of the curated wiki
                {activeName && (
                  <Link
                    to="/app/shared-chat"
                    search={{ topic: contentTitle }}
                    className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                    aria-label={`Discuss ${contentTitle} in Shared Chat`}
                  >
                    <MessageSquare size={11} />
                    Chat
                  </Link>
                )}
                <button
                  type="button"
                  onClick={startEditingPage}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
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
            {contentSource === 'bot' && activeName && <WikiPageFilesPanel pageName={activeName} />}
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

// Order matters for display; matches models && skills/core/skill-upload-store.ts's SKILL_UPLOAD_SLOTS.
// `installable` marks the two slots with a real "Install" action wired to
// interface/web-server.ts's install-skill/install-plugin routes -- every
// other slot only ever offers Download, per the user's own distinction:
// "if you see it, you can click it and it'll install" (plugin/skill) vs.
// "with the other files it'll just download" (algorithm/RSI test).
const SLOTS = [
  { key: 'plugin', label: 'Plugin', icon: Puzzle, hint: 'The plugin/extension source that wires this skill into the running app.', installable: true },
  { key: 'sourceSkill', label: 'Source Skill', icon: Blocks, hint: 'The exact, editable, un-quantized skill definition.', installable: true },
  { key: 'binarySkill', label: 'Binary Skill', icon: Sparkles, hint: 'The quantized, deployment-ready form of the skill.', installable: true },
  { key: 'algorithm', label: 'Improvement Algorithm', icon: RefreshCw, hint: 'The training/improvement recipe that produced the binary skill from the source one.', installable: false },
  { key: 'rsiTest', label: 'RSI Test', icon: FlaskConical, hint: "A test that checks this skill actually leaves the system better after recursive self-improvement, not just different.", installable: false },
] as const

type SlotKey = (typeof SLOTS)[number]['key']

interface ManifestEntry {
  filename: string
  uploadedAt: number
  bytes: number
}

interface SkillPackage {
  name: string
  slots: Partial<Record<SlotKey, ManifestEntry>>
  extraFiles: ManifestEntry[]
  wikiPage?: string
}

interface BotWikiPageSummary {
  name: string
  title: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Fetches a file's real content from the API and hands it to the browser as a normal download -- no server-side temp file, no extra route just for this. */
async function downloadFile(url: string, fallbackName: string) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) {
    window.alert(data.error || 'Failed to download file')
    return
  }
  const blob = new Blob([data.content as string], { type: 'text/plain' })
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = data.filename || fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

/**
 * Inline "Files & Install" panel shown on every bot-published wiki page --
 * uploads and installs a skill package named after the page itself
 * (`pageName`), so a page can carry its own plugin/skill/algorithm/RSI
 * test/extra files with no separate trip to the Skill Uploads tab. A
 * successful upload also self-links the package's wikiPage back to this
 * same page (POST /api/skill-uploads/:name/wiki), so it shows up linked
 * in the Skill Uploads tab automatically -- see this file's module doc
 * comment.
 */
function WikiPageFilesPanel({ pageName }: { pageName: string }) {
  const [pkg, setPkg] = useState<SkillPackage | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [files, setFiles] = useState<Partial<Record<SlotKey, File>>>({})
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [installingKey, setInstallingKey] = useState<'skill' | 'plugin' | null>(null)

  const load = () => {
    setLoading(true)
    fetch(`/api/skill-uploads/${encodeURIComponent(pageName)}`)
      .then(res => (res.ok ? res.json() : { name: pageName, slots: {}, extraFiles: [] }))
      .then((data: SkillPackage) => setPkg(data))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    setFiles({})
    setExtraFiles([])
    setExpanded(false)
    // pageName only -- reload whenever the panel is attached to a
    // different page, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageName])

  const chosenCount = Object.values(files).filter(Boolean).length + extraFiles.length

  const upload = async () => {
    if (chosenCount === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const slotEntries = Object.entries(files).filter(([, f]) => f) as [SlotKey, File][]
      if (slotEntries.length > 0) {
        const body: Record<string, unknown> = { name: pageName }
        for (const [slot, file] of slotEntries) body[slot] = { filename: file.name, content: await file.text() }
        const res = await fetch('/api/skill-uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to upload')
      }
      if (extraFiles.length > 0) {
        const body = { files: await Promise.all(extraFiles.map(async f => ({ filename: f.name, content: await f.text() }))) }
        const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pageName)}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to upload extra files')
      }
      // Self-link, best-effort -- the package now exists (the calls above
      // succeeded), so this only fails if the wiki page itself vanished in
      // the meantime, which isn't worth blocking the upload over.
      await fetch(`/api/skill-uploads/${encodeURIComponent(pageName)}/wiki`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wikiPage: pageName }),
      }).catch(() => {})
      setFiles({})
      setExtraFiles([])
      load()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload')
    } finally {
      setUploading(false)
    }
  }

  const deleteExtraFile = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}"?`)) return
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pageName)}/files/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete file')
      load()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete file')
    }
  }

  const installSkill = async () => {
    setInstallingKey('skill')
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pageName)}/install-skill`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to install skill')
      window.alert(`Installed "${pageName}": ${data.neuronCount} neuron(s), ${data.remembered} remembered into live memory.`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to install skill')
    } finally {
      setInstallingKey(null)
    }
  }

  const installPlugin = async () => {
    if (!window.confirm(`Install "${pageName}"'s plugin file? This runs its code directly in the live server process.`)) return
    setInstallingKey('plugin')
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pageName)}/install-plugin`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to install plugin')
      window.alert(`Installed and activated "${data.pluginId}" from ${data.installedFrom}.`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to install plugin')
    } finally {
      setInstallingKey(null)
    }
  }

  if (loading || !pkg) return null

  const fileCount = Object.keys(pkg.slots).length + pkg.extraFiles.length
  const hasSkillFile = !!(pkg.slots.binarySkill || pkg.slots.sourceSkill)
  const hasPluginFile = !!pkg.slots.plugin

  return (
    <Card className="mb-4 p-3">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center justify-between text-left cursor-pointer"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Puzzle className="h-3.5 w-3.5 text-primary" />
          Files & Install
          {fileCount > 0 && (
            <span className="font-normal text-muted-foreground">
              ({fileCount} file{fileCount !== 1 ? 's' : ''})
            </span>
          )}
        </span>
        {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Attach this page's plugin, source/binary skill, improvement algorithm, RSI test, or any extra files --
            stored as the "{pageName}" skill package (same one the Skill Uploads tab shows) and kept linked back to
            this page automatically.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SLOTS.map(slot => {
              const Icon = slot.icon
              const entry = pkg.slots[slot.key]
              const chosen = files[slot.key]
              return (
                <div key={slot.key} className="space-y-1 rounded-md border border-border p-2">
                  <Label className="flex items-center gap-1.5 text-[11px] font-medium text-foreground" title={slot.hint}>
                    <Icon className="h-3 w-3 text-primary" />
                    {slot.label}
                  </Label>
                  {entry && (
                    <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                      <span className="truncate" title={entry.filename}>
                        {entry.filename} ({formatBytes(entry.bytes)})
                      </span>
                      <button
                        type="button"
                        onClick={() => downloadFile(`/api/skill-uploads/${encodeURIComponent(pageName)}/${slot.key}`, entry.filename)}
                        className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground active:scale-90 transition-all cursor-pointer"
                        aria-label={`Download ${entry.filename}`}
                        title="Download"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <input
                    type="file"
                    disabled={uploading}
                    onChange={e => setFiles(prev => ({ ...prev, [slot.key]: e.target.files?.[0] }))}
                    className="block w-full text-[10px] text-muted-foreground file:mr-1.5 file:rounded file:border-0 file:bg-primary/10 file:px-1.5 file:py-0.5 file:text-[10px] file:font-medium file:text-primary hover:file:bg-primary/20 cursor-pointer disabled:opacity-50"
                    aria-label={`${slot.label} file for ${pageName}`}
                  />
                  {chosen && (
                    <p className="flex items-center gap-1 text-[10px] text-primary">
                      <Check className="h-2.5 w-2.5" />
                      {chosen.name}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="space-y-1 rounded-md border border-dashed border-border p-2">
            <Label className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Paperclip className="h-3 w-3 text-primary" />
              Extra Files
            </Label>
            {pkg.extraFiles.length > 0 && (
              <div className="space-y-1">
                {pkg.extraFiles.map(f => (
                  <div key={f.filename} className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                    <span className="truncate" title={f.filename}>
                      {f.filename} ({formatBytes(f.bytes)})
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => downloadFile(`/api/skill-uploads/${encodeURIComponent(pageName)}/files/${encodeURIComponent(f.filename)}`, f.filename)}
                        className="rounded p-0.5 hover:bg-muted hover:text-foreground active:scale-90 transition-all cursor-pointer"
                        aria-label={`Download ${f.filename}`}
                        title="Download"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteExtraFile(f.filename)}
                        className="rounded p-0.5 hover:bg-destructive/10 hover:text-destructive active:scale-90 transition-all cursor-pointer"
                        aria-label={`Delete ${f.filename}`}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <input
              type="file"
              multiple
              disabled={uploading}
              onChange={e => setExtraFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-[10px] text-muted-foreground file:mr-1.5 file:rounded file:border-0 file:bg-primary/10 file:px-1.5 file:py-0.5 file:text-[10px] file:font-medium file:text-primary hover:file:bg-primary/20 cursor-pointer disabled:opacity-50"
              aria-label={`Extra files for ${pageName}`}
            />
            {extraFiles.length > 0 && (
              <p className="flex items-center gap-1 text-[10px] text-primary">
                <Check className="h-2.5 w-2.5" />
                {extraFiles.length} file{extraFiles.length !== 1 ? 's' : ''} chosen
              </p>
            )}
          </div>

          {uploadError && (
            <p role="alert" className="text-[11px] text-destructive">
              {uploadError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={upload}
              disabled={uploading || chosenCount === 0}
              className="h-6 gap-1 px-2 text-[11px] active:scale-95 transition-all"
              aria-label={`Upload files for ${pageName}`}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Upload{chosenCount > 0 ? ` (${chosenCount})` : ''}
            </Button>
            {hasSkillFile && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={installSkill}
                disabled={installingKey === 'skill'}
                className="h-6 gap-1 px-2 text-[11px] active:scale-95 transition-all"
                aria-label={`Install ${pageName} skill`}
              >
                {installingKey === 'skill' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Install Skill
              </Button>
            )}
            {hasPluginFile && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={installPlugin}
                disabled={installingKey === 'plugin'}
                className="h-6 gap-1 px-2 text-[11px] active:scale-95 transition-all"
                aria-label={`Install ${pageName} plugin`}
                title="Runs this plugin's code directly in the live server process"
              >
                {installingKey === 'plugin' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Install Plugin
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

function SkillUploadsPanel() {
  const [packages, setPackages] = useState<SkillPackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [packagesError, setPackagesError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [files, setFiles] = useState<Partial<Record<SlotKey, File>>>({})
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const [installingKey, setInstallingKey] = useState<string | null>(null)
  const [botWikiPages, setBotWikiPages] = useState<BotWikiPageSummary[]>([])
  const [wikiChoice, setWikiChoice] = useState<Record<string, string>>({})
  const [linkingWikiName, setLinkingWikiName] = useState<string | null>(null)

  const loadPackages = () => {
    setPackagesLoading(true)
    fetch('/api/skill-uploads')
      .then(res => res.json())
      .then((data: { packages: SkillPackage[] }) => {
        setPackages(data.packages ?? [])
        setPackagesError(null)
      })
      .catch((err: unknown) => setPackagesError(err instanceof Error ? err.message : 'Failed to load skill packages'))
      .finally(() => setPackagesLoading(false))
  }

  useEffect(() => {
    loadPackages()
    // Only the bot-published half of the wiki can be linked here (see the
    // /api/skill-uploads/:name/wiki route's own reasoning) -- the curated
    // pages are filtered out client-side too so the picker doesn't even
    // offer one it would just reject.
    fetch('/api/wiki')
      .then(res => res.json())
      .then((data: { pages: Array<{ name: string; title: string; source: 'human' | 'bot' }> }) => {
        setBotWikiPages((data.pages ?? []).filter(p => p.source === 'bot').map(p => ({ name: p.name, title: p.title || p.name })))
      })
      .catch(() => {
        // Non-critical: the picker just shows as empty, same as "no bot
        // pages published yet" -- worth neither a toast nor blocking load.
      })
  }, [])

  const filledSlotCount = Object.values(files).filter(Boolean).length
  const filledCount = filledSlotCount + extraFiles.length

  const upload = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setUploadError('Give this skill package a name.')
      return
    }
    if (filledCount === 0) {
      setUploadError('Choose at least one file to upload.')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      if (filledSlotCount > 0) {
        const body: Record<string, unknown> = { name: trimmedName }
        for (const slot of SLOTS) {
          const file = files[slot.key]
          if (!file) continue
          body[slot.key] = { filename: file.name, content: await file.text() }
        }
        const res = await fetch('/api/skill-uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to upload')
      }
      if (extraFiles.length > 0) {
        const body = {
          files: await Promise.all(extraFiles.map(async f => ({ filename: f.name, content: await f.text() }))),
        }
        const res = await fetch(`/api/skill-uploads/${encodeURIComponent(trimmedName)}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to upload extra files')
      }
      setFiles({})
      setExtraFiles([])
      loadPackages()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload')
    } finally {
      setUploading(false)
    }
  }

  const deletePackage = async (pkgName: string) => {
    if (!window.confirm(`Delete the whole "${pkgName}" skill package (all uploaded files)? This can't be undone.`)) return
    setDeletingName(pkgName)
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pkgName)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setPackages(prev => prev.filter(p => p.name !== pkgName))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete package')
    } finally {
      setDeletingName(null)
    }
  }

  const deleteExtraFile = async (pkgName: string, filename: string) => {
    if (!window.confirm(`Delete "${filename}" from "${pkgName}"?`)) return
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pkgName)}/files/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete file')
      setPackages(prev =>
        prev.map(p => (p.name === pkgName ? { ...p, extraFiles: p.extraFiles.filter(f => f.filename !== filename) } : p)),
      )
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete file')
    }
  }

  // Real installs -- see interface/web-server.ts's install-skill/
  // install-plugin routes. install-skill wires the skill's neuron data into
  // live memory (no code execution); install-plugin genuinely runs the
  // uploaded plugin file (a real dynamic import()), so its own errors are
  // surfaced verbatim rather than summarized -- a rejection here usually
  // means the specific reason (not .js/.mjs, no onActivate, ...) matters.
  const installSkill = async (pkgName: string) => {
    setInstallingKey(`${pkgName}:skill`)
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pkgName)}/install-skill`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to install skill')
      window.alert(`Installed "${pkgName}": ${data.neuronCount} neuron(s), ${data.remembered} remembered into live memory.`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to install skill')
    } finally {
      setInstallingKey(null)
    }
  }

  const installPlugin = async (pkgName: string) => {
    if (!window.confirm(`Install "${pkgName}"'s plugin file? This runs its code directly in the live server process.`)) return
    setInstallingKey(`${pkgName}:plugin`)
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pkgName)}/install-plugin`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to install plugin')
      window.alert(`Installed and activated "${data.pluginId}" from ${data.installedFrom}.`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to install plugin')
    } finally {
      setInstallingKey(null)
    }
  }

  const linkWiki = async (pkgName: string) => {
    const wikiPage = wikiChoice[pkgName]
    if (!wikiPage) return
    setLinkingWikiName(pkgName)
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pkgName)}/wiki`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wikiPage }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to link wiki page')
      setPackages(prev => prev.map(p => (p.name === pkgName ? { ...p, wikiPage: data.wikiPage } : p)))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to link wiki page')
    } finally {
      setLinkingWikiName(null)
    }
  }

  const unlinkWiki = async (pkgName: string) => {
    setLinkingWikiName(pkgName)
    try {
      const res = await fetch(`/api/skill-uploads/${encodeURIComponent(pkgName)}/wiki`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to unlink wiki page')
      setPackages(prev => prev.map(p => (p.name === pkgName ? { ...p, wikiPage: undefined } : p)))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to unlink wiki page')
    } finally {
      setLinkingWikiName(null)
    }
  }

  return (
    <div className="h-full space-y-6 overflow-y-auto pr-1">
      <Card className="p-4 space-y-4">
        <div className="space-y-1.5 max-w-sm">
          <Label htmlFor="skill-package-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Skill package name
          </Label>
          <Input
            id="skill-package-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. sentiment-analysis"
            disabled={uploading}
            aria-label="Skill package name"
          />
          <p className="text-[11px] text-muted-foreground">
            Reuse an existing package's name to add or replace files in it — files not chosen here are left untouched.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SLOTS.map(slot => {
            const Icon = slot.icon
            const chosen = files[slot.key]
            return (
              <div key={slot.key} className="space-y-1.5 rounded-lg border border-border p-3">
                <Label
                  htmlFor={`skill-file-${slot.key}`}
                  className="flex items-center gap-1.5 text-xs font-medium text-foreground"
                  title={slot.hint}
                >
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  {slot.label}
                </Label>
                <input
                  id={`skill-file-${slot.key}`}
                  type="file"
                  disabled={uploading}
                  onChange={e => setFiles(prev => ({ ...prev, [slot.key]: e.target.files?.[0] }))}
                  className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20 cursor-pointer disabled:opacity-50"
                  aria-label={`${slot.label} file`}
                />
                {chosen && (
                  <p className="flex items-center gap-1 text-[11px] text-primary">
                    <Check className="h-3 w-3" />
                    {chosen.name}
                  </p>
                )}
              </div>
            )
          })}

          <div className="space-y-1.5 rounded-lg border border-dashed border-border p-3">
            <Label
              htmlFor="skill-file-extra"
              className="flex items-center gap-1.5 text-xs font-medium text-foreground"
              title="Anything that doesn't fit the slots above -- reference data, a README, sample input, ... Pick as many as you like."
            >
              <Paperclip className="h-3.5 w-3.5 text-primary" />
              Extra Files
            </Label>
            <input
              id="skill-file-extra"
              type="file"
              multiple
              disabled={uploading}
              onChange={e => setExtraFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20 cursor-pointer disabled:opacity-50"
              aria-label="Extra files"
            />
            {extraFiles.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] text-primary">
                <Check className="h-3 w-3" />
                {extraFiles.length} file{extraFiles.length !== 1 ? 's' : ''} chosen
              </p>
            )}
          </div>
        </div>

        {uploadError && (
          <p role="alert" className="text-xs text-destructive">
            {uploadError}
          </p>
        )}

        <Button
          onClick={upload}
          disabled={uploading}
          className="gap-2 active:scale-95 transition-all duration-150"
          aria-label="Upload skill package files"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading...' : `Upload${filledCount > 0 ? ` (${filledCount})` : ''}`}
        </Button>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Existing packages</h2>
        {packagesLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        )}
        {packagesError && (
          <p role="alert" className="text-sm text-destructive">
            {packagesError}
          </p>
        )}
        {!packagesLoading && !packagesError && packages.length === 0 && (
          <p className="text-sm text-muted-foreground">No skill packages uploaded yet.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map(pkg => {
            const hasSkillFile = !!(pkg.slots.binarySkill || pkg.slots.sourceSkill)
            const hasPluginFile = !!pkg.slots.plugin
            return (
              <Card key={pkg.name} className="p-3">
                <CardHeader className="flex flex-row items-center justify-between p-0 pb-2">
                  <CardTitle className="text-sm font-medium">{pkg.name}</CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deletePackage(pkg.name)}
                    disabled={deletingName === pkg.name}
                    className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-90"
                    aria-label={`Delete ${pkg.name} package`}
                    title={`Delete ${pkg.name} package`}
                  >
                    {deletingName === pkg.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-1 p-0">
                  {SLOTS.map(slot => {
                    const entry = pkg.slots[slot.key]
                    return (
                      <div key={slot.key} className="flex items-center justify-between gap-1.5 text-[11px]">
                        <span className={entry ? 'text-foreground' : 'text-muted-foreground'}>{slot.label}</span>
                        {entry ? (
                          <span className="flex items-center gap-1 shrink-0">
                            <span className="text-muted-foreground truncate max-w-[7rem]" title={entry.filename}>
                              {entry.filename} ({formatBytes(entry.bytes)})
                            </span>
                            <button
                              type="button"
                              onClick={() => downloadFile(`/api/skill-uploads/${encodeURIComponent(pkg.name)}/${slot.key}`, entry.filename)}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-90 transition-all cursor-pointer"
                              aria-label={`Download ${entry.filename}`}
                              title="Download"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">missing</span>
                        )}
                      </div>
                    )
                  })}
                  {pkg.extraFiles.length > 0 && (
                    <div className="space-y-1 border-t border-border pt-1.5 mt-1.5">
                      {pkg.extraFiles.map(f => (
                        <div key={f.filename} className="flex items-center justify-between gap-1.5 text-[11px]">
                          <span className="flex items-center gap-1 min-w-0 text-muted-foreground">
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate" title={f.filename}>
                              {f.filename} ({formatBytes(f.bytes)})
                            </span>
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => downloadFile(`/api/skill-uploads/${encodeURIComponent(pkg.name)}/files/${encodeURIComponent(f.filename)}`, f.filename)}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-90 transition-all cursor-pointer"
                              aria-label={`Download ${f.filename}`}
                              title="Download"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteExtraFile(pkg.name, f.filename)}
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-90 transition-all cursor-pointer"
                              aria-label={`Delete ${f.filename}`}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-border pt-1.5 mt-1.5">
                    {pkg.wikiPage ? (
                      <div className="flex items-center justify-between gap-1.5 text-[11px]">
                        <Link
                          to="/app/wiki"
                          search={{ page: pkg.wikiPage }}
                          className="flex items-center gap-1 min-w-0 text-primary hover:underline"
                          title={`View "${pkg.wikiPage}" in the Wiki tab`}
                        >
                          <Bot className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {botWikiPages.find(w => w.name === pkg.wikiPage)?.title || pkg.wikiPage}
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => unlinkWiki(pkg.name)}
                          disabled={linkingWikiName === pkg.name}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-90 transition-all cursor-pointer"
                          aria-label={`Unlink wiki page from ${pkg.name}`}
                          title="Unlink wiki page"
                        >
                          {linkingWikiName === pkg.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />}
                        </button>
                      </div>
                    ) : botWikiPages.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={wikiChoice[pkg.name] ?? ''}
                          onChange={e => setWikiChoice(prev => ({ ...prev, [pkg.name]: e.target.value }))}
                          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-1.5 py-1 text-[11px] text-foreground"
                          aria-label={`Link a bot wiki page to ${pkg.name}`}
                        >
                          <option value="">Link a bot wiki page...</option>
                          {botWikiPages.map(w => (
                            <option key={w.name} value={w.name}>
                              {w.title}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => linkWiki(pkg.name)}
                          disabled={!wikiChoice[pkg.name] || linkingWikiName === pkg.name}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-90 transition-all cursor-pointer disabled:opacity-40"
                          aria-label={`Link wiki page to ${pkg.name}`}
                          title="Link"
                        >
                          {linkingWikiName === pkg.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                        </button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">No bot wiki pages to link yet -- publish one from the Wiki tab.</p>
                    )}
                  </div>

                  {(hasSkillFile || hasPluginFile) && (
                    <div className="flex flex-wrap gap-1.5 border-t border-border pt-2 mt-2">
                      {hasSkillFile && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => installSkill(pkg.name)}
                          disabled={installingKey === `${pkg.name}:skill`}
                          className="h-6 gap-1 px-2 text-[11px] active:scale-95 transition-all"
                          aria-label={`Install ${pkg.name} skill`}
                        >
                          {installingKey === `${pkg.name}:skill` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                          Install Skill
                        </Button>
                      )}
                      {hasPluginFile && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => installPlugin(pkg.name)}
                          disabled={installingKey === `${pkg.name}:plugin`}
                          className="h-6 gap-1 px-2 text-[11px] active:scale-95 transition-all"
                          aria-label={`Install ${pkg.name} plugin`}
                          title="Runs this plugin's code directly in the live server process"
                        >
                          {installingKey === `${pkg.name}:plugin` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                          Install Plugin
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
