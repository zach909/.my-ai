import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { blink } from '@/blink/client'
import type { QbDatabasesRow, QbTablesRow } from '@/lib/db-types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Database, Plus, Rows3, Table2, X } from 'lucide-react'

const databasesTable = blink.db.table<QbDatabasesRow>('qb_databases')
const tablesTable = blink.db.table<QbTablesRow>('qb_tables')

export const Route = createFileRoute('/app/')({
  head: () => ({
    meta: [
      { title: 'Workspace · QuickBase' },
      { name: 'description', content: 'Build and organize your databases without code.' },
    ],
  }),
  component: DashboardHome,
})

function DashboardHome() {
  const [userId, setUserId] = useState<string | null>(null)
  const [databases, setDatabases] = useState<QbDatabasesRow[]>([])
  const [tables, setTables] = useState<QbTablesRow[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadWorkspace = async (id: string) => {
    const [nextDatabases, nextTables] = await Promise.all([
      databasesTable.list({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
      tablesTable.list({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
    ])
    setDatabases(nextDatabases)
    setTables(nextTables)
  }

  useEffect(() => {
    return blink.auth.onAuthStateChanged(async state => {
      if (state.user) {
        setUserId(state.user.id)
        await loadWorkspace(state.user.id)
      }
      if (!state.isLoading) setLoading(false)
    })
  }, [])

  const recentDatabases = useMemo(() => databases.slice(0, 4), [databases])

  const createDatabase = async () => {
    if (!userId || !name.trim()) return
    setSaving(true)
    try {
      await databasesTable.create({
        name: name.trim(),
        description: description.trim() || null,
        userId,
      })
      await loadWorkspace(userId)
      setName('')
      setDescription('')
      setShowCreate(false)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading your workspace…</div>

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">Workspace / Overview</p>
          <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Make data feel simple.</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">Design the structure first. Then bring your records to life.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="shadow-md transition-transform hover:-translate-y-0.5"><Plus /> New database</Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<Database />} label="Databases" value={databases.length} />
        <StatCard icon={<Table2 />} label="Tables" value={tables.length} />
        <StatCard icon={<Rows3 />} label="Records" value="—" />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="font-serif text-2xl">Your databases</h2><span className="font-mono text-xs text-muted-foreground">{databases.length} total</span></div>
        {recentDatabases.length === 0 ? (
          <Card className="border-dashed bg-transparent shadow-none"><CardContent className="flex flex-col items-center justify-center py-16 text-center"><Database className="mb-4 h-9 w-9 text-primary" /><h3 className="font-serif text-xl">Start with a blank canvas</h3><p className="mt-2 max-w-sm text-sm text-muted-foreground">Create your first database to organize projects, clients, inventory, or anything you care about.</p><Button variant="outline" onClick={() => setShowCreate(true)} className="mt-5">Create database</Button></CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {recentDatabases.map(database => <Card key={database.id} className="group transition-all hover:-translate-y-1 hover:shadow-lg"><CardHeader><div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Database className="h-5 w-5" /></div><span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Database</span></div><CardTitle className="pt-2 text-xl">{database.name}</CardTitle></CardHeader><CardContent><p className="line-clamp-2 text-sm text-muted-foreground">{database.description || 'A new space for your data.'}</p><div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Table2 className="h-3.5 w-3.5" /> {tables.filter(table => table.databaseId === database.id).length} tables</div></CardContent></Card>)}
          </div>
        )}
      </section>

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm"><Card className="w-full max-w-md shadow-xl"><CardHeader><div className="flex items-center justify-between"><CardTitle className="font-serif text-2xl">New database</CardTitle><Button variant="ghost" size="icon" onClick={() => setShowCreate(false)}><X /></Button></div><p className="text-sm text-muted-foreground">Give your workspace a clear starting point.</p></CardHeader><CardContent className="space-y-4"><div><label htmlFor="database-name" className="mb-1.5 block text-sm font-medium">Name</label><Input id="database-name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Client projects" /></div><div><label htmlFor="database-description" className="mb-1.5 block text-sm font-medium">Description <span className="text-muted-foreground">(optional)</span></label><Input id="database-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="What will you keep here?" /></div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={createDatabase} disabled={!name.trim() || saving}>{saving ? 'Creating…' : 'Create database'}</Button></div></CardContent></Card></div>}
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return <Card className="bg-card/70"><CardContent className="flex items-center gap-4 pt-6"><div className="rounded-lg bg-secondary p-2.5 text-primary">{icon}</div><div><p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div></CardContent></Card>
}
