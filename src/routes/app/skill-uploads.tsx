import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Blocks, Check, FlaskConical, Loader2, Puzzle, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react'

export const Route = createFileRoute('/app/skill-uploads')({
  head: () => ({
    meta: [
      { title: 'Skill Uploads · ASI Architect' },
      { name: 'description', content: 'Upload a plugin, source skill, binary skill, improvement algorithm, and RSI test as one package.' },
    ],
  }),
  component: SkillUploadsPage,
})

// Order matters for display; matches models && skills/core/skill-upload-store.ts's SKILL_UPLOAD_SLOTS.
const SLOTS = [
  { key: 'plugin', label: 'Plugin', icon: Puzzle, hint: 'The plugin/extension source that wires this skill into the running app.' },
  { key: 'sourceSkill', label: 'Source Skill', icon: Blocks, hint: 'The exact, editable, un-quantized skill definition.' },
  { key: 'binarySkill', label: 'Binary Skill', icon: Sparkles, hint: 'The quantized, deployment-ready form of the skill.' },
  { key: 'algorithm', label: 'Improvement Algorithm', icon: RefreshCw, hint: 'The training/improvement recipe that produced the binary skill from the source one.' },
  { key: 'rsiTest', label: 'RSI Test', icon: FlaskConical, hint: "A test that checks this skill actually leaves the system better after recursive self-improvement, not just different." },
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
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function SkillUploadsPage() {
  const [packages, setPackages] = useState<SkillPackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [packagesError, setPackagesError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [files, setFiles] = useState<Partial<Record<SlotKey, File>>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)

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
  }, [])

  const filledCount = Object.values(files).filter(Boolean).length

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
      setFiles({})
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

  return (
    <div className="space-y-6 p-4 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <Upload className="h-6 w-6 text-primary" />
          Skill Uploads
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a plugin, a source skill, a binary skill, its improvement algorithm, and an RSI test as one named
          package — each slot is independent, so a package can start with just one file and gain the rest later
          under the same name.
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
          {packages.map(pkg => (
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
                    <div key={slot.key} className="flex items-center justify-between text-[11px]">
                      <span className={entry ? 'text-foreground' : 'text-muted-foreground'}>{slot.label}</span>
                      {entry ? (
                        <span className="text-muted-foreground truncate max-w-[9rem]" title={entry.filename}>
                          {entry.filename} ({formatBytes(entry.bytes)})
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">missing</span>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
