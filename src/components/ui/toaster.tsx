import { useEffect, useState } from "react"
import { subscribeToasts, dismissToast, type ToastRecord, type ToastVariant } from "@/lib/toast"
import { cn } from "@/lib/utils"

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-l-emerald-500",
  error: "border-l-destructive",
  warning: "border-l-amber-500",
  info: "border-l-blue-500",
}

function VariantIcon({ variant }: { variant: ToastVariant }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  switch (variant) {
    case "success":
      return (
        <svg {...common} className="text-emerald-500 shrink-0">
          <polyline points="4 12 9 17 20 6" />
        </svg>
      )
    case "error":
      return (
        <svg {...common} className="text-destructive shrink-0">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      )
    case "warning":
      return (
        <svg {...common} className="text-amber-500 shrink-0">
          <path d="M12 3 L22 20 L2 20 Z" />
          <line x1="12" y1="9" x2="12" y2="14" />
          <circle cx="12" cy="17" r="0.5" fill="currentColor" />
        </svg>
      )
    case "info":
      return (
        <svg {...common} className="text-blue-500 shrink-0">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
        </svg>
      )
  }
}

/** Fixed bottom-right stack of toast notifications, replacing `sonner`'s
 * <Toaster />. Reads from the toast store in src/lib/toast.ts. */
function Toaster() {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  useEffect(() => subscribeToasts(setToasts), [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismissToast(t.id)}
          className={cn(
            "flex items-start gap-2.5 rounded-md border border-l-4 bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg cursor-pointer animate-in fade-in-0 slide-in-from-bottom-2",
            VARIANT_STYLES[t.variant],
          )}
        >
          <VariantIcon variant={t.variant} />
          <div className="flex flex-col gap-0.5">
            <div className="font-medium leading-none">{t.message}</div>
            {t.description && (
              <div className="text-xs text-muted-foreground">{t.description}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export { Toaster }
