import * as React from "react"

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size, children, ...rest }: IconProps) {
  return (
    <svg
      width={size ?? 24}
      height={size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function Activity(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="3 12 8 12 11 5 14 19 17 12 21 12" />
    </Svg>
  )
}

export function AlertTriangle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 L2 20 L22 20 Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <line x1="12" y1="17.5" x2="12" y2="17.5" />
    </Svg>
  )
}

export function ArrowLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 5 5 12 12 19" />
    </Svg>
  )
}

export function ArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </Svg>
  )
}

export function ArrowUpRight(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </Svg>
  )
}

export function Atom(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="1.5" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(120 12 12)" />
    </Svg>
  )
}

export function Blocks(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  )
}

export function BookOpen(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 6 L3 5 L3 18 L12 20 Z" />
      <path d="M12 6 L21 5 L21 18 L12 20 Z" />
    </Svg>
  )
}

export function Bot(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
      <line x1="12" y1="8" x2="12" y2="4" />
      <circle cx="12" cy="3" r="1" />
    </Svg>
  )
}

export function Brain(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="12" r="6" />
      <circle cx="16" cy="12" r="6" />
      <line x1="12" y1="6" x2="12" y2="18" />
    </Svg>
  )
}

export function Calendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="16" y1="2" x2="16" y2="6" />
    </Svg>
  )
}

export function Camera(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="4" width="6" height="3" />
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <circle cx="12" cy="13.5" r="3.5" />
    </Svg>
  )
}

export function Check(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="4 12 9 17 20 6" />
    </Svg>
  )
}

export function CheckCircle2(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12 11 15 16 9" />
    </Svg>
  )
}

export function ChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  )
}

export function ChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="9 6 15 12 9 18" />
    </Svg>
  )
}

export function ChevronUp(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="6 15 12 9 18 15" />
    </Svg>
  )
}

export function Code(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="9 6 3 12 9 18" />
      <polyline points="15 6 21 12 15 18" />
    </Svg>
  )
}

export function Copy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <rect x="8" y="8" width="13" height="13" rx="2" />
    </Svg>
  )
}

export function Cpu(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" />
      <line x1="9" y1="1" x2="9" y2="6" />
      <line x1="15" y1="18" x2="15" y2="23" />
      <line x1="18" y1="9" x2="23" y2="9" />
      <line x1="1" y1="15" x2="6" y2="15" />
    </Svg>
  )
}

export function Download(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="12" y1="3" x2="12" y2="15" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </Svg>
  )
}

export function EyeOff(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="12" rx="9" ry="5" />
      <circle cx="12" cy="12" r="2" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </Svg>
  )
}

export function FileText(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3 L14 3 L19 8 L19 21 L6 21 Z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </Svg>
  )
}

export function FlaskConical(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="10" y1="2" x2="14" y2="2" />
      <line x1="10" y1="2" x2="10" y2="9" />
      <line x1="14" y1="2" x2="14" y2="9" />
      <path d="M10 9 L4 20 A2 2 0 0 0 6 23 L18 23 A2 2 0 0 0 20 20 L14 9 Z" />
      <line x1="6" y1="17" x2="18" y2="17" />
    </Svg>
  )
}

export function Folder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6 A2 2 0 0 1 5 4 L9 4 L11 6 L19 6 A2 2 0 0 1 21 8 L21 17 A2 2 0 0 1 19 19 L5 19 A2 2 0 0 1 3 17 Z" />
    </Svg>
  )
}

export function Gauge(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="13" r="8" />
      <line x1="12" y1="13" x2="16" y2="9" />
      <circle cx="12" cy="13" r="1" />
    </Svg>
  )
}

export function Globe(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </Svg>
  )
}

export function Goal(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="6" y1="21" x2="6" y2="3" />
      <rect x="6" y="4" width="9" height="6" />
    </Svg>
  )
}

export function GraduationCap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 9 L12 4 L22 9 L12 14 Z" />
      <line x1="22" y1="9" x2="22" y2="15" />
      <line x1="6" y1="11" x2="6" y2="16" />
      <path d="M6 16 A6 3 0 0 0 18 16" />
    </Svg>
  )
}

export function HardDriveDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
      <line x1="12" y1="2" x2="12" y2="10" />
      <polyline points="8 7 12 11 16 7" />
    </Svg>
  )
}

export function HelpCircle(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9 A2.5 2.5 0 1 1 12.5 11.5 L11.5 13.5" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </Svg>
  )
}

export function History(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="13" r="8" />
      <line x1="12" y1="13" x2="12" y2="9" />
      <line x1="12" y1="13" x2="15" y2="13" />
      <polyline points="3 3 3 8 8 8" />
    </Svg>
  )
}

export function KeyRound(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5" />
      <line x1="11.5" y1="11.5" x2="20" y2="20" />
      <line x1="16" y1="16" x2="18" y2="14" />
      <line x1="18" y1="18" x2="20" y2="16" />
    </Svg>
  )
}

export function Link2(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="9" width="10" height="6" rx="3" transform="rotate(45 7 12)" />
      <rect x="12" y="9" width="10" height="6" rx="3" transform="rotate(45 17 12)" />
    </Svg>
  )
}

export function Link2Off(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="9" width="10" height="6" rx="3" transform="rotate(45 7 12)" />
      <rect x="12" y="9" width="10" height="6" rx="3" transform="rotate(45 17 12)" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </Svg>
  )
}

export function Loader2(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 A9 9 0 1 1 5.6 5.6" />
    </Svg>
  )
}

export function LogOut(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3 L5 3 A2 2 0 0 0 3 5 L3 19 A2 2 0 0 0 5 21 L9 21" />
      <line x1="21" y1="12" x2="9" y2="12" />
      <polyline points="16 7 21 12 16 17" />
    </Svg>
  )
}

export function Mail(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="2 6 12 13 22 6" />
    </Svg>
  )
}

export function Menu(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </Svg>
  )
}

export function MessageSquare(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4 L20 4 L20 16 L10 16 L6 20 L6 16 L4 16 Z" />
    </Svg>
  )
}

export function Mic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10 A7 7 0 0 0 19 10" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </Svg>
  )
}

export function MonitorCog(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <circle cx="12" cy="10" r="2" />
      <line x1="12" y1="7" x2="12" y2="8.5" />
    </Svg>
  )
}

export function Package(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 L21 8 L21 16 L12 21 L3 16 L3 8 Z" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="3" y1="8" x2="12" y2="12" />
      <line x1="21" y1="8" x2="12" y2="12" />
    </Svg>
  )
}

export function PanelLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </Svg>
  )
}

export function Paperclip(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 12 V6 A4 4 0 0 1 16 6 V15 A2 2 0 0 1 12 15 V8" />
    </Svg>
  )
}

export function Pause(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </Svg>
  )
}

export function Pencil(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20 L8 19 L20 7 A2.5 2.5 0 0 0 17 4 L5 16 Z" />
      <line x1="15" y1="5" x2="19" y2="9" />
    </Svg>
  )
}

export function Phone(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <line x1="10" y1="5" x2="14" y2="5" />
      <circle cx="12" cy="18" r="1" />
    </Svg>
  )
}

export function Pin(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="9" r="5" />
      <line x1="12" y1="14" x2="12" y2="22" />
    </Svg>
  )
}

export function Play(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4 L20 12 L6 20 Z" />
    </Svg>
  )
}

export function Plus(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </Svg>
  )
}

export function Power(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="12" y1="2" x2="12" y2="10" />
      <path d="M6 6 A8 8 0 1 0 18 6" />
    </Svg>
  )
}

export function Puzzle(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="16" cy="4" r="2" />
      <circle cx="4" cy="16" r="2" />
    </Svg>
  )
}

export function Radio(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="2" />
      <path d="M8 8 A6 6 0 0 0 8 16" />
      <path d="M16 8 A6 6 0 0 1 16 16" />
      <path d="M5 5 A11 11 0 0 0 5 19" />
      <path d="M19 5 A11 11 0 0 1 19 19" />
    </Svg>
  )
}

export function RefreshCw(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12 A9 9 0 1 1 14.3 5.3" />
      <polyline points="21 3 21 8 16 8" />
    </Svg>
  )
}

export function Rocket(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2 L16 10 L14 20 L10 20 L8 10 Z" />
      <circle cx="12" cy="10" r="2" />
      <line x1="9" y1="18" x2="7" y2="21" />
      <line x1="15" y1="18" x2="17" y2="21" />
    </Svg>
  )
}

export function RotateCcw(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12 A9 9 0 1 0 9.7 5.3" />
      <polyline points="3 3 3 8 8 8" />
    </Svg>
  )
}

export function Search(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </Svg>
  )
}

export function Send(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <path d="M22 2 L15 22 L11 13 L2 9 Z" />
    </Svg>
  )
}

export function Settings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </Svg>
  )
}

export function ShieldOff(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2 L19 5 L19 11 L12 20 L5 11 L5 5 Z" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </Svg>
  )
}

export function Sparkles(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2 L13.5 7.5 L19 9 L13.5 10.5 L12 16 L10.5 10.5 L5 9 L10.5 7.5 Z" />
      <line x1="19" y1="15" x2="19" y2="19" />
      <line x1="17" y1="17" x2="21" y2="17" />
    </Svg>
  )
}

export function Square(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </Svg>
  )
}

export function Store(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="3 9 5 3 19 3 21 9" />
      <line x1="3" y1="9" x2="3" y2="21" />
      <line x1="21" y1="9" x2="21" y2="21" />
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="9" y1="21" x2="9" y2="14" />
    </Svg>
  )
}

export function Target(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </Svg>
  )
}

export function Terminal(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <polyline points="6 8 10 12 6 16" />
      <line x1="12" y1="16" x2="17" y2="16" />
    </Svg>
  )
}

export function TerminalSquare(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="12" y1="15" x2="16" y2="15" />
    </Svg>
  )
}

export function Trash2(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="3" y1="7" x2="21" y2="7" />
      <path d="M9 7 V4 A1 1 0 0 1 10 3 L14 3 A1 1 0 0 1 15 4 V7" />
      <rect x="5" y="7" width="14" height="14" rx="1" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  )
}

export function TrendingUp(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="3 17 9 11 13 15 21 6" />
      <polyline points="15 6 21 6 21 12" />
    </Svg>
  )
}

export function Upload(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="12" y1="15" x2="12" y2="3" />
      <polyline points="7 8 12 3 17 8" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </Svg>
  )
}

export function Users(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20 A6 6 0 0 1 15 20" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M14 20 A5 5 0 0 1 22 20" />
    </Svg>
  )
}

export function Wrench(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="3" />
      <line x1="9.5" y1="9.5" x2="18" y2="18" />
      <line x1="15" y1="18" x2="18" y2="15" />
    </Svg>
  )
}

export function X(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Svg>
  )
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Svg>
  )
}

export function Zap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 2 L4 14 L10 14 L9 22 L20 10 L14 10 Z" />
    </Svg>
  )
}
