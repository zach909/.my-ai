/**
 * The Store — the single front door for everything published.
 *
 * Replaces the separate Bot Wiki and Skill Uploads entries in the nav, because
 * both are things people publish and the store is where published things live.
 * The older combined page is still reachable from here rather than deleted:
 * it holds the bot wiki's own editor and the upload packages, and removing a
 * working page to tidy a nav entry would lose real functionality.
 *
 * Everything shown here comes from `store/` in the repository, so the
 * catalogue is the same for anyone who clones or pulls — no account, no server
 * anyone has to keep running.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StoreItemMark } from '@/components/StoreItemMark'
import { Download, Upload, RefreshCw, FileText, ArrowLeft, BookOpen, Loader2 } from 'lucide-react'

export const Route = createFileRoute('/app/store')({
  head: () => ({
    meta: [
      { title: 'Store · ASI Architect' },
      {
        name: 'description',
        content:
          'Browse, download and publish skills, plugins, binaries, source and files — shared through the repository itself.',
      },
    ],
  }),
  component: StorePage,
})

interface StoreFileInfo {
  filename: string
  bytes: number
  sha256: string
}

interface StoreItem {
  kind: string
  name: string
  title: string
  description: string
  author: string
  publishedAt: string
  updatedAt: string
  files: StoreFileInfo[]
  totalBytes: number
}

interface Catalog {
  kinds: string[]
  labels: Record<string, string>
  catalog: Record<string, StoreItem[]>
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function StorePage() {
  const [data, setData] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<StoreItem | null>(null)
  const [section, setSection] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/store')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const kinds = data?.kinds ?? []
  const shown = kinds.filter(k => section === 'all' || k === section)
  const total = kinds.reduce((n, k) => n + (data?.catalog[k]?.length ?? 0), 0)

  if (selected) {
    return <ItemDetail item={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Store</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Skills, plugins and tools, binary skills, source and files — published into the
            repository itself. Anyone who clones or pulls gets the whole catalogue. Nothing
            installs on its own; you download or install what you choose.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button asChild size="sm" className="gap-2">
            <Link to="/app/wiki">
              <Upload className="h-4 w-4" />
              Publish / Wiki
            </Link>
          </Button>
        </div>
      </div>

      {/* Section filter */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSection('all')}
          className={
            'rounded-full border px-3 py-1 text-xs transition-colors ' +
            (section === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent')
          }
        >
          Everything ({total})
        </button>
        {kinds.map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setSection(k)}
            className={
              'rounded-full border px-3 py-1 text-xs transition-colors ' +
              (section === k ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent')
            }
          >
            {data?.labels[k] ?? k} ({data?.catalog[k]?.length ?? 0})
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the catalogue…
        </div>
      )}

      {error && (
        <Card className="p-4 border-destructive/40">
          <p className="text-sm text-destructive">Could not read the store: {error}</p>
        </Card>
      )}

      {!loading && !error && total === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing published yet. Anything added to <code className="text-xs">store/</code> and pushed
            appears here for everyone who pulls.
          </p>
        </Card>
      )}

      {shown.map(kind => {
        const items = data?.catalog[kind] ?? []
        if (items.length === 0) return null
        return (
          <section key={kind} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {data?.labels[kind] ?? kind}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map(item => (
                <button
                  key={`${item.kind}/${item.name}`}
                  type="button"
                  onClick={() => setSelected(item)}
                  className="text-left"
                >
                  <Card className="p-4 h-full flex gap-3 hover:border-primary/60 transition-colors active:scale-[0.99]">
                    <div className="shrink-0">
                      <StoreItemMark name={item.name} kind={item.kind} size={56} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm leading-tight truncate">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        by {item.author}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                        {item.description || 'No description.'}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        {item.files.length} file{item.files.length === 1 ? '' : 's'} ·{' '}
                        {formatBytes(item.totalBytes)}
                      </p>
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          </section>
        )
      })}

      <Card className="p-4 flex items-start gap-3">
        <BookOpen className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          The bot wiki and skill-upload packages live on the{' '}
          <Link to="/app/wiki" className="text-primary hover:underline">
            Wiki &amp; Uploads
          </Link>{' '}
          page. This Store is the catalogue everyone shares; that page is where you write and
          package things.
        </p>
      </Card>
    </div>
  )
}

function ItemDetail({ item, onBack }: { item: StoreItem; onBack: () => void }) {
  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 -ml-2">
        <ArrowLeft className="h-4 w-4" />
        Back to the store
      </Button>

      <div className="flex gap-4 items-start">
        <StoreItemMark name={item.name} kind={item.kind} size={96} />
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{item.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {item.kind}/{item.name} · by {item.author}
          </p>
          {item.updatedAt && (
            <p className="text-xs text-muted-foreground mt-0.5">
              updated {new Date(item.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {item.description && (
        <Card className="p-4">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{item.description}</p>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </h2>
        <div className="space-y-2">
          {item.files.map(f => (
            <Card key={f.filename} className="p-3 flex items-center gap-3">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{f.filename}</p>
                {/* The digest is shown because it is what tells you whether the
                    copy you pulled is the copy you looked at. */}
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {formatBytes(f.bytes)} · {f.sha256.slice(0, 16)}…
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="gap-2 shrink-0">
                <a
                  href={`/api/store/${item.kind}/${item.name}/file/${f.filename}`}
                  download={f.filename}
                >
                  <Download className="h-4 w-4" />
                  Download
                </a>
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <Card className="p-4">
        <p className="text-xs text-muted-foreground">
          Downloading never runs anything. Read what you downloaded before you install it — that
          is the whole reason publishing here is open and installing is not automatic.
        </p>
      </Card>
    </div>
  )
}
