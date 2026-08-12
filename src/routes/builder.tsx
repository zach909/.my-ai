import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useBuilder, BuilderCanvas } from '@/features/builder'

/**
 * /builder — the Extension Builder visual editor (spec: "drag-and-connect
 * visual editor"). Runs the real ExtensionBuilder engine in-browser:
 * add/drag/connect neurons, drag labels onto them, search, simulate a single
 * neuron's output, add an API-capable output layer, import/export NeuroLang,
 * and Save (un-quantized, editable) vs Install (quantized for deployment).
 */
export const Route = createFileRoute('/builder')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Extension Builder · Neuroclaw' },
      {
        name: 'description',
        content: 'Drag-and-connect visual editor for building Neuroclaw extensions from neurons, NeuroLang, and API output layers.',
      },
    ],
  }),
  component: BuilderPage,
})

function BuilderPage() {
  const b = useBuilder()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnectSource] = useState<string | null>(null)
  const [neuronName, setNeuronName] = useState('')
  const [neuronValue, setNeuronValue] = useState(0.5)
  const [labelText, setLabelText] = useState('')
  const [query, setQuery] = useState('')
  const [simInput, setSimInput] = useState(1.0)
  const [simResult, setSimResult] = useState<string | null>(null)
  const [neuroLang, setNeuroLang] = useState('')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [codeToImport, setCodeToImport] = useState('')
  const [netSearchName, setNetSearchName] = useState('')
  const [netSearchCorpus, setNetSearchCorpus] = useState('')
  const [netSearchQuery, setNetSearchQuery] = useState('')
  const [netSearchResults, setNetSearchResults] = useState<Array<{ results: string[]; confidence: number }>>([])
  const [codeName, setCodeName] = useState('')
  const [scriptUserSays, setScriptUserSays] = useState('')
  const [scriptResponse, setScriptResponse] = useState('')
  const [training, setTraining] = useState(false)
  const [trainMethod, setTrainMethod] = useState<'delta' | 'random'>('delta')
  const [trainingPyTorch, setTrainingPyTorch] = useState(false)
  const [generatingSkills, setGeneratingSkills] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeTarget, setMergeTarget] = useState('')
  const [savedExtensions, setSavedExtensions] = useState<Array<{ file: string; name: string; neurons: number }>>([])

  const selected = b.neurons.find((n) => n.id === selectedId) ?? null

  const searchMatches = useMemo(
    () => new Set(query.trim() ? b.search(query).map((n) => n.id) : []),
    [b, query],
  )

  // Populates the "Merge with saved" dropdown -- fetched once on mount,
  // not on every render; a merge success also refreshes it since the
  // merged model itself may get saved next.
  useEffect(() => {
    fetch('/api/extension/list')
      .then((res) => res.json())
      .then((json) => { if (Array.isArray(json.extensions)) setSavedExtensions(json.extensions) })
      .catch(() => {}) // no server / no saved extensions yet -- the dropdown just stays empty
  }, [])

  const handleAddNeuron = () => {
    const name = neuronName.trim() || `neuron_${b.neurons.length + 1}`
    b.addNeuron(name, neuronValue, {
      x: 60 + (b.neurons.length % 5) * 170,
      y: 60 + Math.floor(b.neurons.length / 5) * 100,
    })
    setNeuronName('')
  }

  const handleNodeClick = (neuronId: string) => {
    if (!connectMode) {
      setSelectedId(neuronId)
      setSimResult(null)
      return
    }
    if (!connectSource) {
      setConnectSource(neuronId)
      return
    }
    if (connectSource !== neuronId) {
      b.connect(connectSource, neuronId)
      setStatusMsg(`Connected ${connectSource} → ${neuronId} (w=0.50)`)
    }
    setConnectSource(null)
  }

  // Engine-created nodes (NeuroLang import, API output layer) default to
  // (0,0); spread them below the placed graph so they never stack.
  const spreadUnplaced = () => {
    const project = b.engine.getProject(b.projectId)
    if (!project) return
    const nodes = Array.from(project.neurons.values())
    const unplaced = nodes.filter((n) => n.x === 0 && n.y === 0)
    if (unplaced.length === 0) return
    const maxY = Math.max(0, ...nodes.filter((n) => n.x !== 0 || n.y !== 0).map((n) => n.y))
    unplaced.forEach((n, i) =>
      b.moveNeuron(n.id, 60 + (i % 5) * 170, maxY + 110 + Math.floor(i / 5) * 100),
    )
  }

  // Persists the project to disk and, for any neuron with a real
  // @definishon, registers it into the live NeuroclawSystem's memory so a
  // later chat message can actually recall it (see ReasoningEngine's
  // "analogy" approach) — b.save()/b.install() below only ever produced an
  // in-browser JSON string with nowhere to go; this is what makes what you
  // build here show up in /app/chat instead of being thrown away.
  const registerWithSystem = async () => {
    try {
      const res = await fetch('/api/extension/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: b.projectName,
          neurons: b.neurons.map((n) => ({ name: n.name, value: n.value, definition: n.definition, scripts: n.scripts })),
        }),
      })
      if (!res.ok) return null
      return (await res.json()) as { remembered: number }
    } catch {
      return null
    }
  }

  // "Scripting": attach a (user says X -> should respond Y) training
  // example to the selected neuron. Not a canned reply -- handleTrain()
  // above genuinely trains the neuron's readout toward `response` when
  // driven by an embedding of `userSays`, the same mechanism a
  // @definishon uses.
  const handleAddScript = () => {
    if (!selected || !scriptUserSays.trim() || !scriptResponse.trim()) return
    b.addScript(selected.id, scriptUserSays, scriptResponse)
    setScriptUserSays('')
    setScriptResponse('')
  }

  // The real training sequence (spec: "connections then makes all
  // definishons true then does the scripting -- a loop till all is true...
  // NOT a script, a training sequence"): connections are already live as
  // soon as they're drawn; this step is what actually runs every
  // @definishon and every script (see handleAddScript below) through
  // HyperDimensionalEngine.trainDefinitions() until it converges or the
  // epoch budget runs out. Deliberately separate from Save/Install (not
  // run automatically by either) -- see extension-builder/builder.js's
  // installWithQuantization() doc comment for why an implicit trigger
  // caused real problems.
  const handleTrain = async () => {
    setTraining(true)
    try {
      const result = b.train(undefined, trainMethod)
      if (!result) {
        setStatusMsg('Train failed')
        return
      }
      const methodLabel = trainMethod === 'random' ? ' via random search' : ''
      setStatusMsg(
        result.converged
          ? `Trained${methodLabel}: converged in ${result.epochs} epoch(s) — ${result.trainedNeurons.length} neuron(s) now true: ${result.trainedNeurons.join(', ') || '(none had a @definishon or script)'}`
          : `Trained${methodLabel}: did not fully converge after ${result.epochs} epoch(s) — ${result.trainedNeurons.length}/${b.neurons.filter((n) => n.definition || n.scripts.length > 0).length} trainable neuron(s) true so far${result.conflicts.length ? `; ${result.conflicts.length} conflicting definition(s)` : ''}. Try Train again.`,
      )
    } finally {
      setTraining(false)
    }
  }

  // ALTERNATIVE backend to handleTrain() above: real torch.autograd/torch.optim
  // gradient descent, run server-side (see use-builder.ts's trainWithPyTorch()
  // and interface/web-server.ts's POST /api/extension/train-pytorch) against
  // the PyTorch copy vendored under extension-builder/PyTorch. Strictly
  // optional -- if this machine has no Python/torch, the request still comes
  // back {ok:false, error} instead of throwing, and the regular Train button
  // above is completely unaffected either way.
  const handleTrainPyTorch = async () => {
    setTrainingPyTorch(true)
    try {
      const result = await b.trainWithPyTorch()
      if (!result.ok) {
        setStatusMsg(`PyTorch training unavailable: ${result.error}`)
        return
      }
      setStatusMsg(
        result.converged
          ? `PyTorch trained: converged in ${result.epochs} epoch(s) (torch ${result.torchVersion ?? '?'}) — ${result.trainedNeurons.length} neuron(s) now true: ${result.trainedNeurons.join(', ') || '(none had a @definishon or script)'}`
          : `PyTorch trained: did not fully converge after ${result.epochs} epoch(s) — ${result.trainedNeurons.length} trainable neuron(s) true so far. Try again.`,
      )
    } finally {
      setTrainingPyTorch(false)
    }
  }

  // Execution-grounded training: the server actually RUNS real JS/Python/
  // Shell/NeuroLang snippets with randomized inputs and trains a neuron per
  // instantiation on the real result -- see use-builder.ts's
  // generateCodingSkills() and interface/web-server.ts's POST
  // /api/extension/generate-coding-skills. ADDS to the current canvas
  // (doesn't replace anything), same as any other "generate" action here.
  const handleGenerateCodingSkills = async () => {
    setGeneratingSkills(true)
    try {
      const result = await b.generateCodingSkills()
      if (!result.ok) {
        setStatusMsg(`Coding skills generation unavailable: ${result.error}`)
        return
      }
      setStatusMsg(`Generated ${result.addedCount} execution-grounded coding neuron(s) — ${result.trainedCount} converged`)
    } finally {
      setGeneratingSkills(false)
    }
  }

  // Real weight averaging ("model soup") with a previously saved
  // extension -- see use-builder.ts's mergeWithSaved() and
  // interface/web-server.ts's POST /api/extension/merge-with-saved.
  // REPLACES the current canvas's neurons with the merged, fine-tuned
  // result (averaging is a whole-model operation, not incremental).
  const handleMergeWithSaved = async () => {
    if (!mergeTarget) {
      setStatusMsg('Pick a saved extension to merge with first')
      return
    }
    setMerging(true)
    try {
      const result = await b.mergeWithSaved(mergeTarget)
      if (!result.ok) {
        setStatusMsg(`Merge unavailable: ${result.error}`)
        return
      }
      setStatusMsg(`Merged with "${mergeTarget}" — ${result.totalCount} total neuron(s), ${result.overlapCount} genuinely weight-averaged`)
    } finally {
      setMerging(false)
    }
  }

  const handleSave = async () => {
    const saved = b.save()
    if (!saved) {
      setStatusMsg('Save failed')
      return
    }
    const reg = await registerWithSystem()
    setStatusMsg(
      `Saved un-quantized (${saved.length.toLocaleString()} bytes, editable)`
      + (reg ? ` — ${reg.remembered} definition(s) now recallable in chat` : ''),
    )
  }

  const handleInstall = async () => {
    const out = await b.install(8)
    if (!out) {
      setStatusMsg('Install failed')
      return
    }
    const reg = await registerWithSystem()
    setStatusMsg(
      `Installed with 8-bit quantization (${out.length.toLocaleString()} bytes deployed)`
      + (reg ? ` — ${reg.remembered} definition(s) now recallable in chat` : ''),
    )
  }

  const handleParse = async () => {
    const res = await b.parseNeuroLang(neuroLang)
    if (res.success) spreadUnplaced()
    setStatusMsg(res.success ? 'NeuroLang parsed — neurons added to the canvas' : `NeuroLang errors: ${res.errors.join('; ')}`)
  }

  const handleApiLayer = () => {
    const ok = b.addApiOutputLayer({
      endpoints: [{ path: '/api/predict', method: 'POST' }],
      port: 8088,
      host: '127.0.0.1',
      authRequired: true,
    })
    if (ok) spreadUnplaced()
    setStatusMsg(ok ? 'API output layer added (POST /api/predict)' : 'Output layer failed')
  }

  const handleCodeToNet = () => {
    if (!codeToImport.trim() || !codeName.trim()) {
      setStatusMsg('Code-to-Net: provide code and a name')
      return
    }
    const neuron = b.engine.addCodeNet(b.projectId, codeName.trim(), codeToImport, {
      x: 60 + (b.neurons.length % 5) * 170,
      y: 60 + Math.floor(b.neurons.length / 5) * 100,
    })
    if (neuron) {
      setStatusMsg(`Code-to-Net: "${codeName}" converted to neural network`)
      setCodeToImport('')
      setCodeName('')
    } else {
      setStatusMsg('Code-to-Net: failed to create neuron')
    }
  }

  const handleAddNetSearchNeuron = () => {
    if (!netSearchName.trim() || !netSearchCorpus.trim()) {
      setStatusMsg('Net Search: provide a name and corpus text')
      return
    }
    const neuron = b.addNetSearchNeuron(netSearchName.trim(), netSearchCorpus, {
      x: 60 + (b.neurons.length % 5) * 170,
      y: 60 + Math.floor(b.neurons.length / 5) * 100,
    })
    setStatusMsg(neuron ? `Net Search: "${netSearchName}" corpus neuron added` : 'Net Search: failed to add neuron')
    if (neuron) {
      setNetSearchName('')
      setNetSearchCorpus('')
    }
  }

  const handleSearchCorpus = () => {
    if (!netSearchQuery.trim()) return
    const results = b.netSearch(netSearchQuery.trim())
    setNetSearchResults(results)
    setStatusMsg(results.length > 0 ? `Net Search: found matches in ${results.length} corpus neuron(s)` : 'Net Search: no corpus matches')
  }

  const handleGenerateNetwork = () => {
    if (!netSearchQuery.trim()) {
      setStatusMsg('Net Search: enter a query first')
      return
    }
    const out = b.netSearchGenerate(netSearchQuery.trim())
    if (out) spreadUnplaced()
    setStatusMsg(
      out
        ? `Net Search: generated "${out.neuron.name}" from ${out.matches.length} match(es)`
        : 'Net Search: no matches to generate from'
    )
  }

  const handleTrainNetSearch = () => {
    const trained = b.trainNetSearch(5)
    setStatusMsg(trained ? 'Net Search: trained corpus neuron(s)' : 'Net Search: nothing to train (add a corpus neuron first)')
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Extension Builder</h1>
          <p className="text-xs text-muted-foreground">
            {b.stats.neuronCount} neurons · {b.stats.connectionCount} connections · {b.stats.labelCount} labels
          </p>
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            ← Mesh dashboard
          </Link>
        </nav>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3 xl:flex-row">
        {/* left: toolbar */}
        <aside className="w-full shrink-0 space-y-3 xl:w-64">
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Add neuron
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="neuron-name-input" className="sr-only">Neuron Name</Label>
              <Input
                id="neuron-name-input"
                value={neuronName}
                onChange={(e) => setNeuronName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNeuron()}
                placeholder="name (e.g. greeting_in)"
                className="h-8 text-xs"
              />
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  vale {neuronValue.toFixed(2)}
                </span>
                <Label htmlFor="neuron-vale-input" className="sr-only">Vale value range</Label>
                <input
                  id="neuron-vale-input"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={neuronValue}
                  onChange={(e) => setNeuronValue(parseFloat(e.target.value))}
                  className="h-1 flex-1 accent-primary"
                />
              </div>
              <Button size="sm" className="h-7 w-full text-xs" onClick={handleAddNeuron}>
                Add to canvas
              </Button>
              <Button
                size="sm"
                variant={connectMode ? 'default' : 'outline'}
                className="h-7 w-full text-xs"
                onClick={() => {
                  setConnectMode((m) => !m)
                  setConnectSource(null)
                }}
              >
                {connectMode
                  ? connectSource
                    ? 'Pick target…'
                    : 'Pick source…'
                  : 'Connect mode'}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Labels — drag onto a neuron
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="label-text-input" className="sr-only">New label text</Label>
              <Input
                id="label-text-input"
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                placeholder="label text"
                className="h-8 text-xs"
              />
              {labelText.trim() ? (
                <div className="space-y-1.5">
                  <span
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/neuroclaw-label', labelText.trim())}
                    className="inline-block cursor-grab rounded bg-primary/15 px-2 py-1 text-xs text-primary active:cursor-grabbing border border-primary/20 hover:bg-primary/20 transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                    tabIndex={0}
                    aria-label={`Draggable label: ${labelText.trim()}`}
                  >
                    ⠿ {labelText.trim()}
                  </span>
                  <p className="text-[10px] text-muted-foreground italic">
                    Drag this chip onto a neuron node on the canvas.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground italic">
                    Type a label, or select a preset below:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {['sensor', 'actuator', 'hidden', 'output'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setLabelText(preset)}
                        className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none cursor-pointer"
                        aria-label={`Select preset label: ${preset}`}
                      >
                        +{preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Search neurons
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="search-query-input" className="sr-only">Search query</Label>
              <Input
                id="search-query-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="name / definition / type"
                className="h-8 text-xs"
              />
              {query.trim() && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {searchMatches.size} match{searchMatches.size === 1 ? '' : 'es'} highlighted
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Code-to-Net
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="code-name-input" className="sr-only">Code network name</Label>
              <Input
                id="code-name-input"
                value={codeName}
                onChange={(e) => setCodeName(e.target.value)}
                placeholder="name (e.g. math_ops)"
                className="h-8 text-xs"
              />
              <Label htmlFor="code-import-textarea" className="sr-only">Code to convert</Label>
              <textarea
                id="code-import-textarea"
                value={codeToImport}
                onChange={(e) => setCodeToImport(e.target.value)}
                placeholder="Paste code here (Python, JS, etc.) — converts to neural network"
                className="h-24 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={handleCodeToNet}>
                Convert code to neural net
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Net Search
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="netsearch-name-input" className="sr-only">Corpus neuron name</Label>
              <Input
                id="netsearch-name-input"
                value={netSearchName}
                onChange={(e) => setNetSearchName(e.target.value)}
                placeholder="corpus name (e.g. faq_docs)"
                className="h-8 text-xs"
              />
              <Label htmlFor="netsearch-corpus-textarea" className="sr-only">Corpus text</Label>
              <textarea
                id="netsearch-corpus-textarea"
                value={netSearchCorpus}
                onChange={(e) => setNetSearchCorpus(e.target.value)}
                placeholder="Paste searchable text, one fact/line per row"
                className="h-16 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={handleAddNetSearchNeuron}>
                Add corpus neuron
              </Button>
              <div className="border-t border-border pt-2">
                <Label htmlFor="netsearch-query-input" className="sr-only">Net Search query</Label>
                <Input
                  id="netsearch-query-input"
                  value={netSearchQuery}
                  onChange={(e) => setNetSearchQuery(e.target.value)}
                  placeholder="search query"
                  className="h-8 text-xs"
                />
                <div className="mt-1.5 flex gap-1.5">
                  <Button size="sm" variant="secondary" className="h-7 flex-1 text-xs" onClick={handleSearchCorpus}>
                    Search corpus
                  </Button>
                  <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleGenerateNetwork}>
                    Generate network
                  </Button>
                </div>
                <Button size="sm" variant="outline" className="mt-1.5 h-7 w-full text-xs" onClick={handleTrainNetSearch}>
                  Train corpus neuron(s)
                </Button>
                {netSearchResults.length > 0 && (
                  <div className="mt-2 space-y-1 rounded bg-muted px-2 py-1.5 text-[11px]">
                    {netSearchResults.map((r, i) => (
                      <div key={i}>
                        <span className="text-muted-foreground">conf {r.confidence.toFixed(2)}:</span>{' '}
                        {r.results.join(' · ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Deploy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={handleApiLayer} disabled={training}>
                Add API output layer
              </Button>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Method:</span>
                <select
                  value={trainMethod}
                  onChange={(e) => setTrainMethod(e.target.value as 'delta' | 'random')}
                  className="h-6 flex-1 rounded-md border border-input bg-transparent px-1.5 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Training method"
                  title="delta: the analytic tanh-derivative gradient, computed directly (fewer epochs). random: each weight/bias is randomly nudged, keeping the nudge only if it genuinely improved the result -- a real, different algorithm, not gradient descent, so it typically needs more epochs to converge."
                >
                  <option value="delta">delta rule (gradient)</option>
                  <option value="random">random search</option>
                </select>
              </div>
              <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={handleTrain} disabled={training}>
                {training ? `Training${trainMethod === 'random' ? ' (random search)' : ''}…` : `Train${trainMethod === 'random' ? ' (random search)' : ''}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full text-xs"
                onClick={handleTrainPyTorch}
                disabled={trainingPyTorch}
                title="Optional: trains via a real PyTorch subprocess instead of the built-in JS engine. Falls back cleanly if this server has no Python/torch installed."
              >
                {trainingPyTorch ? 'Training (PyTorch)…' : 'Train (PyTorch)'}
              </Button>
              {b.lastTraining && (
                <p className={`text-[11px] ${b.lastTraining.converged ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                  {b.lastTraining.converged ? '✓ converged' : '⋯ not yet converged'} — {b.lastTraining.trainedNeurons.length} true
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full text-xs"
                onClick={handleGenerateCodingSkills}
                disabled={generatingSkills}
                title="Actually runs real JS/Python/Shell/NeuroLang code with randomized inputs and trains a neuron per instantiation on the real executed result -- adds to this canvas, doesn't replace anything."
              >
                {generatingSkills ? 'Generating…' : 'Generate Coding Skills (execution-grounded)'}
              </Button>
              <div className="flex gap-1.5">
                <select
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                  className="h-7 flex-1 rounded-md border border-input bg-transparent px-1.5 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Saved extension to merge with"
                >
                  <option value="">Merge with…</option>
                  {savedExtensions.map((e) => (
                    <option key={e.file} value={e.file}>{e.name} ({e.neurons})</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={handleMergeWithSaved}
                  disabled={merging || !mergeTarget}
                  title="Real weight averaging: trains both sides fresh, averages every matching neuron's connections, then fine-tunes the merged result. Replaces this canvas's neurons with the merge."
                >
                  {merging ? 'Merging…' : 'Merge'}
                </Button>
              </div>
              <Button size="sm" variant="secondary" className="h-7 w-full text-xs" onClick={handleSave} disabled={training}>
                Save (no quantization)
              </Button>
              <Button size="sm" className="h-7 w-full text-xs" onClick={handleInstall} disabled={training}>
                Install (quantize 8-bit)
              </Button>
            </CardContent>
          </Card>
        </aside>

        {/* center: canvas */}
        <section className="min-h-[480px] flex-1" aria-label="Extension canvas">
          <BuilderCanvas
            neurons={b.neurons}
            connections={b.connections}
            labels={b.labels}
            selectedId={selectedId}
            connectSource={connectSource}
            connectMode={connectMode}
            searchMatches={searchMatches}
            onSelect={setSelectedId}
            onNodeClick={handleNodeClick}
            onMove={b.moveNeuron}
            onDropLabel={(id, label) => {
              b.dragLabel(id, label)
              setStatusMsg(`Label "${label}" attached`)
            }}
            onDeleteConnection={(id) => b.disconnect(id)}
          />
          {statusMsg && (
            <p className="mt-2 text-xs text-muted-foreground" role="status">
              {statusMsg}
            </p>
          )}
        </section>

        {/* right: inspector + NeuroLang */}
        <aside className="w-full shrink-0 space-y-3 xl:w-72">
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Neuron inspector
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {!selected ? (
                <p className="text-muted-foreground">Click a neuron to inspect and simulate it.</p>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-mono">{selected.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span className="font-mono">{selected.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Vale</span>
                    <span className="font-mono">{selected.value.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-border pt-2">
                    <span className="mb-1 block text-muted-foreground">
                      Simulate this neuron alone receiving input
                    </span>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="simulation-input" className="sr-only">Simulation input value</Label>
                      <Input
                        id="simulation-input"
                        type="number"
                        step={0.1}
                        value={simInput}
                        onChange={(e) => setSimInput(parseFloat(e.target.value) || 0)}
                        className="h-7 w-20 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 flex-1 text-xs"
                        onClick={() => setSimResult(b.simulate(selected.id, simInput))}
                      >
                        Simulate
                      </Button>
                    </div>
                    {simResult && (
                      <p className="mt-1.5 rounded bg-muted px-2 py-1 font-mono text-[11px]">{simResult}</p>
                    )}
                  </div>
                  <div className="border-t border-border pt-2">
                    <span className="mb-1 block text-muted-foreground">
                      Scripting — train a response ({selected.scripts.length} example{selected.scripts.length !== 1 ? 's' : ''})
                    </span>
                    {selected.scripts.map((s, i) => (
                      <div key={i} className="mb-1 flex items-start justify-between gap-1 rounded bg-muted px-2 py-1 text-[11px]">
                        <span className="min-w-0 flex-1">
                          <span className="text-muted-foreground">user says </span>“{s.userSays}”
                          <span className="text-muted-foreground"> → </span>“{s.response}”
                        </span>
                        <button
                          onClick={() => b.removeScript(selected.id, i)}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove script "${s.userSays}"`}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <Label htmlFor="script-user-says" className="sr-only">User says</Label>
                    <Input
                      id="script-user-says"
                      value={scriptUserSays}
                      onChange={(e) => setScriptUserSays(e.target.value)}
                      placeholder="user says…"
                      className="mb-1 h-7 text-xs"
                    />
                    <Label htmlFor="script-response" className="sr-only">Trained response</Label>
                    <Input
                      id="script-response"
                      value={scriptResponse}
                      onChange={(e) => setScriptResponse(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddScript()}
                      placeholder="…respond with"
                      className="mb-1 h-7 text-xs"
                    />
                    <Button size="sm" variant="secondary" className="h-7 w-full text-xs" onClick={handleAddScript}>
                      Add script
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 w-full text-xs"
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete the neuron "${selected.name}"?`)) {
                        b.deleteNeuron(selected.id)
                        setSelectedId(null)
                      }
                    }}
                  >
                    Delete neuron
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                NeuroLang
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="neurolang-input" className="sr-only">NeuroLang DSL source code</Label>
              <textarea
                id="neurolang-input"
                value={neuroLang}
                onChange={(e) => setNeuroLang(e.target.value)}
                placeholder={'name="example"\n"example"@vale="0.8"\n"example"@definition="greets the user"'}
                className="h-32 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" className="h-7 flex-1 text-xs" onClick={handleParse}>
                  Import to canvas
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 text-xs"
                  onClick={() => setNeuroLang(b.exportNeuroLang())}
                >
                  Export canvas
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  )
}
