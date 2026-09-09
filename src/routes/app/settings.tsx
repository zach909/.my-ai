/**
 * Settings -- one page for the app's on/off knobs that used to have nowhere
 * to live, plus Computer Access folded in from its own standalone page.
 *
 * Before this: setQuantumEnabled()/setPredictorMode() (NeuroclawLLM) and
 * remote-access password rotation (POST /api/auth/password) were all real,
 * tested backend capabilities with no UI at all -- setting or changing the
 * remote-access password required curl; the quantum interference stage and
 * the word/code predictor choice were permanently stuck at whatever
 * NeuroclawSystem's constructor happened to leave them. Computer Access
 * already had its own page (/app/access) -- kept alive as a route (existing
 * links/bookmarks still work) but no longer a separate sidebar entry, folded
 * in here as a section instead (AccessPanel, exported from access.tsx).
 *
 * "add quantum interference always on" -- the quantum interference toggle
 * below is gone; UnifiedBrain now runs that stage unconditionally (see
 * unified-brain.ts), so there is nothing left to turn on or off.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowUpRight, Atom, Blocks, KeyRound, Loader2, LogOut, ShieldOff, Settings as SettingsIcon, Sparkles, Store as StoreIcon, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { AccessPanel } from './access'

/**
 * Everything that isn't Chats or Pinned Chats lives under Settings now --
 * "move everything that is not chat to settings." Extension Builder,
 * Self-Improvement and Store are each substantial tools in their own right
 * (a drag-and-connect editor, a metrics dashboard, a whole catalogue/wiki/
 * upload workflow) -- reproducing their UI inline here would just be a
 * second, worse copy of each. This is the same link-card pattern the old
 * Dashboard page used, relocated rather than rebuilt: each one is still a
 * real, fully working page at its own URL, just reached from Settings
 * instead of its own top-level sidebar entry.
 */
const MODULE_LINKS = [
  { title: 'Extension Builder', description: 'Drag-and-connect neuron editor: build, train, and deploy extensions.', icon: Blocks, href: '/builder' as const },
  { title: 'Self-Improvement', description: 'Real progress from the autonomous self-improvement, skill-creation, and skill-drilling agents.', icon: TrendingUp, href: '/app/self-improvement' as const },
  { title: 'Store', description: 'Browse, download and publish skills, plugins, binaries and files, write wiki pages, and discuss any of it.', icon: StoreIcon, href: '/app/store' as const },
]

function ModulesSection() {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2">
      {MODULE_LINKS.map(({ title, description, icon: Icon, href }) => (
        <Link
          key={title}
          to={href}
          aria-label={`Open ${title}: ${description}`}
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] transition-all duration-150"
        >
          <Card className="relative h-full transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-md group-hover:border-primary/50 cursor-pointer overflow-hidden">
            <CardHeader className="flex flex-row items-center gap-3 pb-2 pr-10">
              <div className="flex items-center justify-center h-8 w-8 rounded-md bg-primary/10 text-primary group-hover:bg-primary/20 transition-all duration-300 group-hover:scale-110">
                <Icon className="h-4 w-4" />
              </div>
              <CardTitle className="text-sm font-medium group-hover:text-primary transition-colors">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            </CardContent>
            <div className="absolute top-4 right-4 text-muted-foreground/30 group-hover:text-primary/70 transition-all duration-200 transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}

export const Route = createFileRoute('/app/settings')({
  head: () => ({
    meta: [
      { title: 'Settings · Corona' },
      { name: 'description', content: 'Remote access, brain behavior, and computer access, all in one place.' },
    ],
  }),
  component: SettingsPage,
})

type SettingsTab = 'remote-access' | 'brain' | 'access' | 'modules'

const SETTINGS_TABS: { key: SettingsTab; label: string; icon: typeof KeyRound }[] = [
  { key: 'remote-access', label: 'Remote Access', icon: KeyRound },
  { key: 'brain', label: 'Brain Behavior', icon: Sparkles },
  { key: 'access', label: 'Computer Access', icon: ShieldOff },
  { key: 'modules', label: 'Modules', icon: Blocks },
]

function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('remote-access')

  return (
    <div className="flex h-full flex-col gap-4 p-4 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <SettingsIcon className="h-6 w-6 text-primary" />
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Remote access, brain behavior, and computer access -- everything that changes how
          this instance behaves, in one place.
        </p>
        <div className="mt-3 flex gap-1 border-b border-border">
          {SETTINGS_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                tab === key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              aria-current={tab === key ? 'page' : undefined}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'remote-access' && <RemoteAccessSection />}
        {tab === 'brain' && <BrainBehaviorSection />}
        {tab === 'access' && <AccessPanel />}
        {tab === 'modules' && <ModulesSection />}
      </div>
    </div>
  )
}

interface AuthStatus {
  passwordSet: boolean
  loggedIn: boolean
  onThisMachine: boolean
  needsSetupCode: boolean
  minPasswordLength: number
}

function RemoteAccessSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/status')
      if (res.ok) setStatus(await res.json())
    } catch {
      // Non-critical -- the form below still works without a status readout.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async () => {
    if (next.length < (status?.minPasswordLength ?? 8)) {
      toast.error(`Password must be at least ${status?.minPasswordLength ?? 8} characters.`)
      return
    }
    if (next !== confirm) {
      toast.error("Passwords don't match.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: next, current: current || undefined }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not set the password.')
      toast.success(status?.passwordSet ? 'Password changed.' : 'Password set -- remote access is now protected.')
      setCurrent(''); setNext(''); setConfirm('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      await load()
      toast.success('Logged out on this device.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <KeyRound className="h-5 w-5 text-primary" />
        Remote Access
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        The password that guards this instance from anywhere other than the machine it runs on.
      </p>
      <Card className="p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading status…
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm">
              {status?.passwordSet ? (
                <span className="text-primary">A password is set.</span>
              ) : (
                <span className="text-destructive">No password is set yet -- anyone who can reach this instance remotely can use it.</span>
              )}
              {status?.loggedIn && ' You are logged in on this device.'}
            </p>
            <div className="grid gap-3 sm:max-w-sm">
              {status?.passwordSet && (
                <div>
                  <Label htmlFor="current-password" className="mb-1 block text-xs text-muted-foreground">
                    Current password (skip if you're on this machine and already logged in)
                  </Label>
                  <Input id="current-password" type="password" value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} />
                </div>
              )}
              <div>
                <Label htmlFor="new-password" className="mb-1 block text-xs text-muted-foreground">
                  {status?.passwordSet ? 'New password' : 'Set a password'}
                </Label>
                <Input id="new-password" type="password" value={next} onChange={e => setNext(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label htmlFor="confirm-password" className="mb-1 block text-xs text-muted-foreground">Confirm</Label>
                <Input id="confirm-password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy || !next} onClick={() => void submit()}>
                  {busy ? 'Working…' : status?.passwordSet ? 'Change password' : 'Set password'}
                </Button>
                {status?.loggedIn && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => void logout()}>
                    <LogOut className="h-3.5 w-3.5" />
                    Log out
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </section>
  )
}

interface BrainSettings {
  quantumEnabled: boolean
  predictorMode: 'word' | 'code'
}

function BrainBehaviorSection() {
  const [settings, setSettings] = useState<BrainSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/brain')
      if (res.ok) setSettings(await res.json())
    } catch {
      // Non-critical -- the toggles below just start disabled until a retry.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const update = async (patch: Partial<BrainSettings>) => {
    setBusy(true)
    try {
      const res = await fetch('/api/settings/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not change it.')
      setSettings(body)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <Sparkles className="h-5 w-5 text-primary" />
        Brain Behavior
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        How the one shared neural mesh (OneBrain) processes each turn.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading current behavior…
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="flex items-start gap-3 p-4">
            <Atom className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Quantum interference</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                An extra stage after the mesh settles: simulated quantum interference/consensus
                shifts the collapsed value. Always on -- there is no off switch.
              </p>
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                Always on
              </span>
            </div>
          </Card>
          <Card className="p-4">
            <p className="font-medium">Predictor</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Which trained predictor generate() samples from -- prose or code.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant={settings?.predictorMode === 'word' ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => void update({ predictorMode: 'word' })}
              >
                Word
              </Button>
              <Button
                size="sm"
                variant={settings?.predictorMode === 'code' ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => void update({ predictorMode: 'code' })}
              >
                Code
              </Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  )
}
