/**
 * "It should be workable just by running the USB and also then it should
 * also have the option to install it onto the operating system." A kiosk
 * browser (live-usb/config/includes.chroot/etc/skel/.config/openbox/
 * autostart) has no window chrome, and the live desktop under it shows
 * nothing but that one fullscreen window -- there is no icon anywhere to
 * click "Install" on. This is the install option, living inside the app
 * itself instead, since that's the only place a live-USB user can actually
 * reach it.
 *
 * Invisible on every normal install/dev machine: GET /api/system/live-usb
 * only ever answers true when NEUROCLAW_LIVE_USB=1, which only
 * live-usb/config/includes.chroot/etc/systemd/system/neuroclaw.service
 * sets.
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { HardDriveDownload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function LiveUsbInstallButton({ collapsed }: { collapsed: boolean }) {
  const [visible, setVisible] = useState(false)
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/system/live-usb')
      .then((res) => (res.ok ? res.json() : { liveUsb: false }))
      .then((body) => { if (!cancelled) setVisible(body.liveUsb === true) })
      .catch(() => { /* not running from a live USB, or the check itself failed -- either way, stay hidden */ })
    return () => { cancelled = true }
  }, [])

  if (!visible) return null

  const install = async () => {
    setLaunching(true)
    try {
      const res = await fetch('/api/system/install', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not start the installer')
      toast.success('Installer starting…')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the installer')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className={cn('shrink-0 border-t border-border', collapsed ? 'p-1.5' : 'p-2')}>
      <Button
        onClick={install}
        disabled={launching}
        variant="outline"
        size={collapsed ? 'icon' : 'sm'}
        aria-label="Install NeuroClaw on this computer"
        title="Install NeuroClaw on this computer"
        className="w-full justify-center gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
      >
        {launching ? <Loader2 size={14} className="animate-spin" /> : <HardDriveDownload size={14} />}
        {!collapsed && (launching ? 'Starting…' : 'Install NeuroClaw')}
      </Button>
    </div>
  )
}
