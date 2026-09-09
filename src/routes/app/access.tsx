/**
 * Computer access — the switches that decide what the agent may do to this machine.
 *
 * The two access layers (GNOME graphical, and terminal/files) shipped with
 * grants and gates but nowhere to see or change them, which meant "turn it
 * off" was a code edit. This is the page that makes the off switch real.
 *
 * Two things it deliberately does. It shows a capability as *overridden by a
 * switch* rather than ungranted, because "you turned this off" and "you never
 * allowed this" need different responses from whoever is reading. And the
 * master switch is presented first and largest: in the moment someone wants
 * the agent to stop touching their computer, they should not be reading a
 * table of sixteen rows.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Loader2, MonitorCog, Power, RefreshCw, ShieldOff, TerminalSquare } from 'lucide-react'
import { toast } from 'sonner'

/**
 * "put the other things into the settings page" -- this page's content now
 * also renders as the Settings page's "Computer Access" section
 * (AccessPanel, below). The standalone route stays alive (existing links/
 * bookmarks keep working, and the sidebar no longer lists it separately --
 * see AppSidebarShell.tsx), just as a thin wrapper around the same panel.
 */
export const Route = createFileRoute('/app/access')({
  head: () => ({
    meta: [
      { title: 'Access · Corona' },
      { name: 'description', content: 'What the agent may do to this computer, and how to switch it off.' },
    ],
  }),
  component: AccessPage,
})

function AccessPage() {
  return <AccessPanel />
}

type SwitchName = 'all' | 'desktop' | 'workspace'

interface SwitchView {
  name: SwitchName
  label: string
  description: string
  on: boolean
  effective: boolean
}

interface CapabilityView {
  capability: string
  level: string | null
  minimum: string
  switch: Exclude<SwitchName, 'all'>
  effective: boolean
  blockedBySwitch: SwitchName | null
}

interface AccessView {
  switches: SwitchView[]
  capabilities: CapabilityView[]
}

interface ProbeView {
  display: string | null
  wayland: boolean
  tools: Record<string, boolean>
  usable: boolean
  summary: string
}

const SWITCH_ICON: Record<SwitchName, React.ReactNode> = {
  all: <Power className="h-5 w-5" />,
  desktop: <MonitorCog className="h-5 w-5" />,
  workspace: <TerminalSquare className="h-5 w-5" />,
}

export function AccessPanel() {
  const [view, setView] = useState<AccessView | null>(null)
  const [probe, setProbe] = useState<ProbeView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/access')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setView(await res.json())
      // The probe is best-effort: a machine with no desktop is a normal
      // answer here, not a failure of the page.
      try {
        const p = await fetch('/api/access/probe')
        if (p.ok) setProbe(await p.json())
      } catch { /* leave the desktop panel unfilled */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const flip = async (name: SwitchName, on: boolean) => {
    setBusy(name)
    try {
      const res = await fetch('/api/access/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, on }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not change it')
      setView(body)
      toast.success(on ? 'Turned on' : 'Turned off')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const setCapability = async (capability: string, level: string | null) => {
    setBusy(capability)
    try {
      const res = await fetch('/api/access/capability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, level }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not change it')
      setView(body)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const master = view?.switches.find(s => s.name === 'all')
  const halves = (view?.switches ?? []).filter(s => s.name !== 'all')

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <ShieldOff className="h-6 w-6 text-primary" />
          Computer access
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What the agent may do to this machine. Nothing here is granted by being possible —
          a capability is refused unless it is both granted below and switched on above.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the switches…
        </div>
      )}
      {error && (
        <Card className="border-destructive/40 p-4">
          <p className="text-sm text-destructive">Could not read access settings: {error}</p>
        </Card>
      )}

      {master && (
        <Card className={'p-4 ' + (master.on ? '' : 'border-destructive/50 bg-destructive/5')}>
          <div className="flex items-center gap-4">
            <div className={master.on ? 'text-primary' : 'text-destructive'}>{SWITCH_ICON.all}</div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{master.label}</p>
              <p className="text-sm text-muted-foreground">{master.description}</p>
            </div>
            <Button
              variant={master.on ? 'destructive' : 'default'}
              disabled={busy === 'all'}
              onClick={() => void flip('all', !master.on)}
            >
              {busy === 'all' ? 'Working…' : master.on ? 'Turn everything off' : 'Turn access back on'}
            </Button>
          </div>
          {!master.on && (
            <p className="mt-3 text-sm text-destructive">
              Access is off. Every capability below is refused, whatever it says it is granted at.
              The grants are kept, so turning this back on restores exactly what was here before.
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {halves.map(s => (
          <Card key={s.name} className="p-4">
            <div className="flex items-start gap-3">
              <div className={s.effective ? 'text-primary' : 'text-muted-foreground'}>{SWITCH_ICON[s.name]}</div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                {s.on && !s.effective && (
                  <p className="mt-1 text-xs text-destructive">Overridden — the master switch is off.</p>
                )}
              </div>
              <Button
                size="sm"
                variant={s.on ? 'outline' : 'default'}
                disabled={busy === s.name}
                onClick={() => void flip(s.name, !s.on)}
              >
                {s.on ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {probe && (
        <Card className="p-4">
          <p className="text-sm font-medium">This machine&rsquo;s desktop</p>
          <p className="mt-1 text-sm text-muted-foreground">{probe.summary}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(probe.tools).map(([tool, present]) => (
              <span
                key={tool}
                className={
                  'rounded border px-1.5 py-0.5 font-mono text-[11px] ' +
                  (present ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground line-through')
                }
              >
                {tool}
              </span>
            ))}
          </div>
        </Card>
      )}

      <div>
        <p className="mb-2 text-sm font-medium">Capabilities</p>
        <div className="space-y-1.5">
          {(view?.capabilities ?? []).map(c => (
            <Card key={c.capability} className="flex items-center gap-3 p-2.5">
              <span
                className={
                  'h-2 w-2 shrink-0 rounded-full ' + (c.effective ? 'bg-primary' : 'bg-muted-foreground/40')
                }
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">{c.capability}</p>
                <p className="text-[11px] text-muted-foreground">
                  {c.level ? `granted at "${c.level}"` : 'not granted'} · needs at least &ldquo;{c.minimum}&rdquo; ·{' '}
                  {c.switch} switch
                  {c.blockedBySwitch && (
                    <span className="text-destructive"> · off because the {c.blockedBySwitch} switch is off</span>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === c.capability}
                onClick={() => void setCapability(c.capability, c.level ? null : c.minimum)}
              >
                {c.level ? 'Revoke' : `Grant "${c.minimum}"`}
              </Button>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
    </div>
  )
}
