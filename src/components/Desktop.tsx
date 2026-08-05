import { useState, useCallback } from "react";
import {
  Folder,
  Terminal,
  Globe,
  Mail,
  Calendar,
  Phone,
  Camera,
  Radio,
  FileText,
  Settings,
  Cpu,
  Code,
} from "lucide-react";
import { TwistedStripLogo } from "@/components/TwistedStripLogo";

/**
 * AppItem - Represents a launchable application
 */
export interface AppItem {
  id: string;
  name: string;
  command: string;
  args?: string[];
  icon: React.ReactNode;
  category:
    | "system"
    | "productivity"
    | "communication"
    | "development"
    | "multimedia";
  workspace?: number;
}

/**
 * Default applications registry
 * Supports launching .deb (Linux), .exe (Windows via wine), .apk (Android via adb)
 */
// eslint-disable-next-line react-refresh/only-export-components -- app registry data, not a component; belongs with the Desktop component it configures
export const DEFAULT_APPS: AppItem[] = [
  // System Apps
  {
    id: "file-manager",
    name: "File Manager",
    command: "nautilus",
    icon: <Folder className="w-8 h-8" />,
    category: "system",
    workspace: 0,
  },
  {
    id: "terminal",
    name: "Terminal",
    command: "gnome-terminal",
    icon: <Terminal className="w-8 h-8" />,
    category: "system",
    workspace: 0,
  },
  {
    id: "settings",
    name: "Settings",
    command: "gnome-control-center",
    icon: <Settings className="w-8 h-8" />,
    category: "system",
    workspace: 0,
  },

  // Productivity
  {
    id: "browser",
    name: "Web Browser",
    command: "xdg-open",
    args: ["https://google.com"],
    icon: <Globe className="w-8 h-8" />,
    category: "productivity",
    workspace: 1,
  },
  {
    id: "email",
    name: "Email",
    command: "xdg-open",
    args: ["mailto:"],
    icon: <Mail className="w-8 h-8" />,
    category: "productivity",
    workspace: 1,
  },
  {
    id: "calendar",
    name: "Calendar",
    command: "xdg-open",
    args: ["webcal://"],
    icon: <Calendar className="w-8 h-8" />,
    category: "productivity",
    workspace: 1,
  },

  // Communication
  {
    id: "phone",
    name: "Phone",
    command: "xdg-open",
    args: ["tel:"],
    icon: <Phone className="w-8 h-8" />,
    category: "communication",
    workspace: 2,
  },

  // Multimedia
  {
    id: "camera",
    name: "Camera",
    command: "cheese",
    icon: <Camera className="w-8 h-8" />,
    category: "multimedia",
    workspace: 2,
  },
  {
    id: "radio",
    name: "Radio",
    command: "shortwave",
    icon: <Radio className="w-8 h-8" />,
    category: "multimedia",
    workspace: 2,
  },

  // Development
  {
    id: "docs",
    name: "Documentation",
    command: "xdg-open",
    args: ["file:///workspace/README.md"],
    icon: <FileText className="w-8 h-8" />,
    category: "development",
    workspace: 3,
  },
  {
    id: "neuroclaw",
    name: "Neuroclaw Core",
    command: "xdg-open",
    args: ["http://localhost:3000"],
    icon: <Cpu className="w-8 h-8" />,
    category: "development",
    workspace: 3,
  },
  {
    id: "builder",
    name: "Extension Builder",
    command: "xdg-open",
    args: ["http://localhost:3000/builder"],
    icon: <Code className="w-8 h-8" />,
    category: "development",
    workspace: 3,
  },
];

/**
 * Custom hook for app launching via IPC
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook, not a component; belongs with the Desktop component that uses it
export function useAppLauncher() {
  const [launchingApps, setLaunchingApps] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const launchApp = useCallback(async (app: AppItem) => {
    setLaunchingApps((prev) => new Set(prev).add(app.id));
    setError(null);

    try {
      // Call the backend launcher API
      const response = await fetch("/api/apps/launch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: app.command,
          args: app.args,
          name: app.name,
          workspace: app.workspace,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to launch application");
      }

      const result = await response.json();
      console.log(`Launched ${app.name}:`, result);

      // Remove from launching state after short delay
      setTimeout(() => {
        setLaunchingApps((prev) => {
          const next = new Set(prev);
          next.delete(app.id);
          return next;
        });
      }, 1000);

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      setLaunchingApps((prev) => {
        const next = new Set(prev);
        next.delete(app.id);
        return next;
      });
      throw err;
    }
  }, []);

  const launchCustom = useCallback(
    async (
      command: string,
      args?: string[],
      name?: string,
      workspace?: number,
    ) => {
      return launchApp({
        id: `custom-${Date.now()}`,
        name: name || command,
        command,
        args,
        icon: <Terminal className="w-8 h-8" />,
        category: "system",
        workspace,
      });
    },
    [launchApp],
  );

  /**
   * Launch different package types
   */
  const launchPackage = useCallback(
    async (packagePath: string, type?: "deb" | "exe" | "apk") => {
      let command: string;
      let args: string[] = [];

      if (!type) {
        // Auto-detect from extension
        if (packagePath.endsWith(".deb")) type = "deb";
        else if (packagePath.endsWith(".exe")) type = "exe";
        else if (packagePath.endsWith(".apk")) type = "apk";
      }

      switch (type) {
        case "deb":
          command = "sudo";
          args = ["apt", "install", packagePath];
          break;
        case "exe":
          command = "wine";
          args = [packagePath];
          break;
        case "apk":
          command = "adb";
          args = ["install", packagePath];
          break;
        default:
          // Try to run as executable
          command = packagePath;
      }

      return launchCustom(command, args, packagePath.split("/").pop());
    },
    [launchCustom],
  );

  return {
    launchApp,
    launchCustom,
    launchPackage,
    launchingApps,
    error,
    clearError: () => setError(null),
  };
}

/**
 * DesktopIcon - Individual app icon component
 */
interface DesktopIconProps {
  app: AppItem;
  isLaunching: boolean;
  onClick: (app: AppItem) => void;
}

function DesktopIcon({ app, isLaunching, onClick }: DesktopIconProps) {
  return (
    <button
      key={app.id}
      onClick={() => onClick(app)}
      disabled={isLaunching}
      aria-label={`Launch ${app.name}`}
      aria-busy={isLaunching}
      className={`
        group flex flex-col items-center justify-center
        w-24 h-24 p-2 rounded-lg
        hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500
        active:scale-95 transition-all duration-150
        ${isLaunching ? "opacity-50 cursor-wait" : "cursor-pointer"}
      `}
      title={app.name}
    >
      <div
        className={`
        relative flex items-center justify-center
        w-14 h-14 rounded-xl
        bg-gradient-to-br from-white/20 to-white/5
        backdrop-blur-sm border border-white/10
        shadow-lg group-hover:shadow-xl group-hover:scale-105
        transition-all duration-200
        ${isLaunching ? "animate-pulse" : ""}
      `}
      >
        <span className="text-white drop-shadow-lg">{app.icon}</span>
        {isLaunching && (
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 rounded-full animate-ping" />
        )}
      </div>
      <span className="mt-2 text-xs font-medium text-white text-center drop-shadow-md line-clamp-2">
        {app.name}
      </span>
    </button>
  );
}

/**
 * Desktop - Main desktop component with app grid
 */
interface DesktopProps {
  apps?: AppItem[];
  onAppLaunch?: (app: AppItem) => void;
}

export function Desktop({ apps = DEFAULT_APPS, onAppLaunch }: DesktopProps) {
  const { launchApp, launchingApps, error, clearError } = useAppLauncher();
  // The twisted-strip logo isn't an OS process useAppLauncher can spawn --
  // it's an in-app 3D viewer, so its icon opens a modal directly instead of
  // going through launchApp()/POST /api/apps/launch like the rest.
  const [logoViewerOpen, setLogoViewerOpen] = useState(false);

  const handleAppClick = async (app: AppItem) => {
    try {
      await launchApp(app);
      onAppLaunch?.(app);
    } catch (err) {
      console.error("Failed to launch app:", err);
    }
  };

  // Group apps by category
  const groupedApps = apps.reduce(
    (acc, app) => {
      if (!acc[app.category]) {
        acc[app.category] = [];
      }
      acc[app.category].push(app);
      return acc;
    },
    {} as Record<string, AppItem[]>,
  );

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Desktop Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900">
        {/* Animated mesh pattern overlay */}
        <div className="absolute inset-0 opacity-20">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="grid"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
      </div>

      {/* Error Toast */}
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50" role="alert" aria-live="assertive">
          <div className="bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <span>{error}</span>
            <button
              onClick={clearError}
              aria-label="Close error notification"
              title="Close error notification"
              className="hover:bg-red-600 rounded p-1 active:scale-90 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* App Grid Container */}
      <div className="relative z-10 w-full h-full p-8 overflow-auto">
        <div className="max-w-7xl mx-auto">
          {/* Main Apps Section */}
          <section className="mb-8">
            <h2 className="text-white/60 text-sm font-medium mb-4 uppercase tracking-wider">
              Applications
            </h2>
            <div className="flex flex-wrap gap-4">
              {apps.map((app) => (
                <DesktopIcon
                  key={app.id}
                  app={app}
                  isLaunching={launchingApps.has(app.id)}
                  onClick={handleAppClick}
                />
              ))}
              <button
                onClick={() => setLogoViewerOpen(true)}
                className="group flex flex-col items-center justify-center w-24 h-24 p-2 rounded-lg hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 active:scale-95 transition-all duration-150 cursor-pointer"
                title="Twisted Strip"
                aria-label="Open Twisted Strip interactive 3D viewer"
              >
                <div className="relative flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-sm border border-white/10 shadow-lg group-hover:shadow-xl group-hover:scale-105 transition-all duration-200 overflow-hidden">
                  <div className="pointer-events-none">
                    <TwistedStripLogo size={56} />
                  </div>
                </div>
                <span className="mt-2 text-xs font-medium text-white text-center drop-shadow-md line-clamp-2">
                  Twisted Strip
                </span>
              </button>
            </div>
          </section>

          {/* Category Sections (optional, for organization) */}
          {Object.entries(groupedApps)
            .filter(([_, apps]) => apps.length > 0)
            .map(
              ([category, categoryApps]) =>
                category === "system" && (
                  <section key={category} className="mb-8">
                    <h2 className="text-white/60 text-sm font-medium mb-4 uppercase tracking-wider">
                      {category}
                    </h2>
                    <div className="flex flex-wrap gap-4">
                      {categoryApps.map((app) => (
                        <DesktopIcon
                          key={app.id}
                          app={app}
                          isLaunching={launchingApps.has(app.id)}
                          onClick={handleAppClick}
                        />
                      ))}
                    </div>
                  </section>
                ),
            )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <div className="bg-black/30 backdrop-blur-md border-t border-white/10 px-4 py-2">
          <div className="flex items-center justify-between text-white/60 text-xs">
            <span>Ready</span>
            <div className="flex items-center gap-4">
              <span>{apps.length} apps available</span>
              <span>{launchingApps.size} launching...</span>
            </div>
          </div>
        </div>
      </div>

      {/* Twisted Strip viewer -- opened by clicking its desktop icon */}
      {logoViewerOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setLogoViewerOpen(false)}
        >
          <div
            className="relative rounded-2xl border border-white/10 bg-black/40 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLogoViewerOpen(false)}
              className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-90 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              aria-label="Close 3D viewer"
              title="Close 3D viewer"
            >
              ×
            </button>
            <TwistedStripLogo size={420} />
            <p className="mt-2 text-center text-xs text-white/50">
              Drag to rotate · scroll to zoom
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
