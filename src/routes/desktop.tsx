import { createFileRoute } from '@tanstack/react-router'
import { Desktop } from '@/components/Desktop'

/**
 * Desktop route (/desktop) — Application launcher desktop interface.
 * 
 * Provides a desktop-like environment with clickable app icons that launch
 * applications via the backend AppLauncher. Supports launching:
 * - System apps (file manager, terminal, settings)
 * - Productivity apps (browser, email, calendar)
 * - Communication apps (phone)
 * - Multimedia apps (camera, radio)
 * - Development tools (docs, Neuroclaw core, extension builder)
 * - Package files (.deb, .exe, .apk)
 */
export const Route = createFileRoute('/desktop')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Desktop · Neuroclaw' },
      {
        name: 'description',
        content: 'Application launcher desktop — click icons to launch apps like a traditional desktop environment.',
      },
    ],
  }),
  component: DesktopPage,
})

function DesktopPage() {
  return (
    <div className="w-dvw h-dvh overflow-hidden">
      <Desktop />
    </div>
  )
}
