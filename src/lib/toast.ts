// A small, hand-written toast-notification store -- replaces the `sonner`
// package. `toast.success()/.error()/.info()/.warning()` can be called from
// anywhere (event handlers, effects, plain async functions), not just
// during React render, so state lives in a module-level store with a
// subscriber list (the same pattern sonner/react-hot-toast use internally)
// rather than React context.

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export interface ToastRecord {
  id: number
  variant: ToastVariant
  message: string
  description?: string
}

type Listener = (toasts: ToastRecord[]) => void

let nextId = 1
let toasts: ToastRecord[] = []
const listeners = new Set<Listener>()

const DURATION_MS = 4000

function emit() {
  for (const listener of listeners) listener(toasts)
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => listeners.delete(listener)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

function push(variant: ToastVariant, message: string, options?: { description?: string }) {
  const id = nextId++
  toasts = [...toasts, { id, variant, message, description: options?.description }]
  emit()
  setTimeout(() => dismissToast(id), DURATION_MS)
  return id
}

export const toast = {
  success: (message: string, options?: { description?: string }) => push('success', message, options),
  error: (message: string, options?: { description?: string }) => push('error', message, options),
  info: (message: string, options?: { description?: string }) => push('info', message, options),
  warning: (message: string, options?: { description?: string }) => push('warning', message, options),
}
