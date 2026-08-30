/**
 * Guided tour: what each part of Corona is, and how the parts connect.
 *
 * The tour's job is to explain the thing that is not obvious from the nav —
 * that these are not twelve separate tools, but twelve views onto one neural
 * mesh. Every step therefore says what a module does AND what it does to the
 * mesh, because that relationship is the whole architecture.
 *
 * Deliberately not a spotlight-on-DOM-elements tour: those break the moment a
 * layout changes or a target is scrolled out of view, and they cannot explain
 * anything that is not currently on screen. This is a stepped explainer that
 * links to each module instead, so it stays correct as the UI moves.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { NeuroclawMark } from '@/components/NeuroclawMark'
import { markTourSeen } from '@/lib/tour-seen'


interface TourStep {
  title: string
  /** What the user can do here. */
  body: string
  /** What it does to the shared mesh — the part that ties the app together. */
  mesh?: string
  href?: string
  linkLabel?: string
}

const STEPS: TourStep[] = [
  {
    title: 'One brain, not twelve tools',
    body:
      'Everything in Corona runs on a single neural mesh called OneBrain. The pages in the sidebar are not separate programs — they are views onto that one mesh, and onto the agent built from it.',
    mesh:
      'Every neuron lives in one all-to-all NeuronMesh. Language neurons, plugin neurons and skill neurons are all wired into the same network, so activity in one genuinely propagates to the rest.',
  },
  {
    title: 'AI Chat',
    body:
      'Talk to the agent. It answers from what it has been taught, computes exact arithmetic directly, and falls back to its language model otherwise.',
    mesh:
      'A prompt is embedded into a vector, driven through the mesh, and settled to convergence. Teaching it a fact writes to long-term memory and folds the text into its language model, so it can use it later.',
    href: '/app/chat',
    linkLabel: 'Open AI Chat',
  },
  {
    title: 'Extension Builder',
    body:
      'Build skills by connecting neurons directly, or compile them from a description. Train, test and install them without leaving the app.',
    mesh:
      'A finished skill is registered as a real expert group: it gets its own neurons in the shared mesh, with dedicated input and output layers, and the router can then select it.',
    href: '/builder',
    linkLabel: 'Open Extension Builder',
  },
  {
    title: 'Architecture',
    body:
      'Inspect the live structure — how many neurons exist, how they are grouped into experts, and how the subsystems compose.',
    mesh:
      'This reads the running mesh rather than a diagram of one, so what you see is the network as it is right now.',
    href: '/app/architecture',
    linkLabel: 'Open Architecture',
  },
  {
    title: 'Knowledge & Reasoning',
    body:
      'Teach the agent facts and inspect what it knows. Reasoning is decomposed into sub-problems, attempted, then verified.',
    mesh:
      'Taught facts are stored with retrieval embeddings. A question close enough to a stored fact is answered from it directly, rather than being improvised.',
    href: '/app/knowledge',
    linkLabel: 'Open Knowledge & Reasoning',
  },
  {
    title: 'Experiments & Evaluation',
    body:
      'Run structured experiments against the agent and score the results, so a change can be judged rather than guessed at.',
    mesh:
      'Training genuinely moves weights: error falls on the training facts and, importantly, on held-out facts the agent never saw — which is the difference between learning and a lookup table.',
    href: '/app/experiments',
    linkLabel: 'Open Experiments',
  },
  {
    title: 'Self-Improvement & Planning',
    body:
      'The agent proposes changes to itself, plans multi-step work, and records what it tried and what failed.',
    mesh:
      'Proposals are gated: they are tested before they are installed, so a bad self-edit does not silently become part of the mesh.',
    href: '/app/self-improvement',
    linkLabel: 'Open Self-Improvement',
  },
  {
    title: 'Bot Wiki',
    body:
      'The shared knowledge base. Pages can be read and created freely, and every edit or delete snapshots a backup first, so nothing is unrecoverable.',
    mesh:
      'Deleting and restoring are privileged — public access can add knowledge but cannot destroy it.',
    href: '/app/store',
    linkLabel: 'Open Bot Wiki',
  },
  {
    title: 'It all runs on your machine',
    body:
      'The backend and this interface both run inside the app itself. Nothing is sent to an external service, and the connection between the window and its server is encrypted and restricted to this app.',
    mesh:
      'You can reopen this tour any time from the question-mark button beside the sidebar header.',
  },
]

export function AppTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const last = STEPS.length - 1

  const close = useCallback(() => {
    markTourSeen()
    onClose()
  }, [onClose])

  // Restart from the beginning each time it is opened, rather than resuming
  // mid-tour from a previous session with no context.
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') setStep(s => Math.min(s + 1, last))
      else if (e.key === 'ArrowLeft') setStep(s => Math.max(s - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, last])

  // Move focus into the dialog so keyboard and screen-reader users land here
  // rather than being left behind on the page underneath.
  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  if (!open) return null

  const s = STEPS[step]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <NeuroclawMark size={32} />
          <div className="min-w-0 flex-1">
            <h2 id="tour-title" className="text-base font-semibold leading-tight">
              {s.title}
            </h2>
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-foreground/90">{s.body}</p>

        {s.mesh && (
          <p className="mt-3 rounded-md border-l-2 border-primary/60 bg-muted/40 py-2 pl-3 pr-2 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">Under it: </span>
            {s.mesh}
          </p>
        )}

        {s.href && s.linkLabel && (
          <Link to={s.href} onClick={close} className="mt-4 inline-block text-sm text-primary hover:underline">
            {s.linkLabel} →
          </Link>
        )}

        {/* Progress */}
        <div className="mt-5 flex gap-1" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={
                'h-1 flex-1 rounded-full transition-colors ' +
                (i <= step ? 'bg-primary' : 'bg-muted')
              }
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            {step === last ? 'Close' : 'Skip tour'}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(s2 => Math.max(s2 - 1, 0))}
              disabled={step === 0}
            >
              Back
            </Button>
            {step === last ? (
              <Button size="sm" onClick={close}>
                Done
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep(s2 => Math.min(s2 + 1, last))}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
