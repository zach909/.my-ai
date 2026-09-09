import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { NeuroclawMark } from '@/components/NeuroclawMark'
import { AppTour } from '@/components/AppTour'
import { hasSeenTour } from '@/lib/tour-seen'
import { useAgentRunning } from '@/hooks/useAgentRunning'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  PanelLeft,
  HelpCircle,
  MessageSquare,
  Pin,
  Folder,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const SIDEBAR_KEY = 'sidebar_collapsed'

interface NavItemDef {
  href: string
  icon: ReactNode
  label: string
}

// "remove the dashboard page ... move everything that is not chat to
// settings, under where that would go would be your chats and pinned
// chats" -- Dashboard is gone (its route now just forwards into Chats, see
// app/index.tsx), and Extension Builder, Self-Improvement, Store, and
// Access are no longer top-level entries: they're all still real, fully
// working pages, just reached from Settings' new "Modules" tab now (Access
// was already a Settings tab too -- see settings.tsx). What's left is
// chat-first: Chats and Pinned Chats where Dashboard used to sit, then
// Chat History, then Settings for everything else.
const NAV_ITEMS: NavItemDef[] = [
  { href: '/app/chat', icon: <MessageSquare className="h-4 w-4" />, label: 'Chats' },
  { href: '/app/pinned-chats', icon: <Pin className="h-4 w-4" />, label: 'Pinned Chats' },
  // Chat History and Memory are tabs of this one entry -- both are views
  // over what has been said or remembered. The route is still
  // /app/chat-groups (unchanged, so old links/bookmarks keep working), but
  // there's no "Chat Groups" hive-discussion tab here any more -- one AI
  // directing another is a chat plugin now (plugins/hive.ts), not a page.
  { href: '/app/chat-groups', icon: <Folder className="h-4 w-4" />, label: 'Chat History' },
  // Last: remote-access password, brain behavior (quantum/predictor mode),
  // Computer Access, and now Extension Builder / Self-Improvement / Store
  // as link cards under the Modules tab -- see settings.tsx's own doc
  // comment for what used to have no UI at all.
  { href: '/app/settings', icon: <Settings className="h-4 w-4" />, label: 'Settings' },
]

function NavItem({ item, collapsed }: { item: NavItemDef; collapsed: boolean }) {
  const link = (
    <Link
      to={item.href}
      activeOptions={{ exact: true }}
      activeProps={{
        className: 'bg-accent text-foreground font-semibold shadow-xs',
      }}
      inactiveProps={{
        className: 'text-muted-foreground hover:bg-accent hover:text-foreground',
      }}
      aria-label={item.label}
      className={cn(
        'flex items-center gap-2.5 rounded-md text-sm transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.97]',
        collapsed ? 'justify-center w-8 h-8 mx-auto' : 'px-3 py-2 w-full'
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

export function AppSidebarShell() {
  const [tourOpen, setTourOpen] = useState(false)
  // Drives the mark's wave: it breathes from circle to star while the agent works.
  const agentRunning = useAgentRunning()

  // Open the tour once on a first visit, so a new user is shown around instead
  // of having to discover the button. Reading localStorage is deferred to an
  // effect because it does not exist during server-side prerendering.
  useEffect(() => {
    if (!hasSeenTour()) setTourOpen(true)
  }, [])

  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_KEY) === 'true') setCollapsed(true)
  }, [])

  const toggle = useCallback(() => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem(SIDEBAR_KEY, String(next))
      return next
    })
  }, [])

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'flex flex-col h-full bg-background border-r border-border overflow-hidden',
          'transition-[width] duration-200 ease-linear shrink-0',
          collapsed ? 'w-[3rem]' : 'w-[15rem]'
        )}
      >
        {/* ── Header ────────────────────────────────────── */}
        <div
          className={cn(
            'flex items-center gap-2 shrink-0 border-b border-border h-[52px] px-3',
            collapsed && 'justify-center px-2'
          )}
        >
          {!collapsed && (
            <>
              <NeuroclawMark size={28} active={agentRunning} />
              <span className="flex-1 font-semibold text-sm truncate">Corona</span>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => setTourOpen(true)}
                aria-label="Take the tour"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Take the tour</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={toggle}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <PanelLeft
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    collapsed && 'rotate-180'
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ── Nav ────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-0.5">
          {!collapsed && (
            <p className="px-3 pt-1 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Modules
            </p>
          )}
          {NAV_ITEMS.map(item => (
            <NavItem key={item.href} item={item} collapsed={collapsed} />
          ))}
        </div>

      </div>

      <AppTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </TooltipProvider>
  )
}
