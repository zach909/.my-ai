import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Blocks,
  Bot,
  Check,
  Download,
  FlaskConical,
  Link2,
  Link2Off,
  Loader2,
  Paperclip,
  Puzzle,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/app/skill-uploads')({
  head: () => ({
    meta: [
      { title: 'Skill Uploads · ASI Architect' },
      { name: 'description', content: 'Upload a plugin, source skill, binary skill, improvement algorithm, RSI test, and extra files as one package.' },
    ],
  }),
  component: SkillUploadsPage,
})

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

function SkillUploadsPage() {
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
    <div className="space-y-6 p-4 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <Upload className="h-6 w-6 text-primary" />
          Skill Uploads
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a plugin, a source skill, a binary skill, its improvement algorithm, an RSI test, and any extra
          files as one named package. Plugin and skill files can be installed straight into the running app; the
          rest are yours to download.
        </p>
      </div>

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
                          title={`View "${pkg.wikiPage}" in the Wiki`}
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
                      <p className="text-[11px] text-muted-foreground">
                        No bot wiki pages to link yet -- publish one from the{' '}
                        <Link to="/app/wiki" className="text-primary hover:underline">
                          Wiki
                        </Link>{' '}
                        page.
                      </p>
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
