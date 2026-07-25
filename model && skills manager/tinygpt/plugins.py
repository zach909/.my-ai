"""Plugins and skills registry — the single place the design notes' two kinds
of extension are distinguished and connected to the mesh.

  - A **plugin** connects to a *service* (a local capability: the file system,
    diagnostics, a screenshot tool, …). Plugins are local-only connectors by
    design: there are **no third-party API services** here. A plugin declares
    what local service it fronts, whether that service is actually available
    on this host, and a `dispatch()` that runs a real local handler where one
    exists (file system, diagnostics) or returns a clear "unavailable on this
    host" otherwise — it never phones out. `email` and `web` are the two
    deliberate exceptions that do reach the real network (SMTP/IMAP for mail,
    HTTP for web fetch/search) — called out explicitly in their own class
    docstrings rather than silently treated the same as the local-only ones.
  - A **skill** is a Mixture-of-Experts expert (`tinygpt/experts.py`) that plugs
    straight into the mesh's settle loop. `build_expert_moe()` turns the
    registered skills into a real `ExpertMoE`, and `attach_to_config()` wires
    that onto a `ModelConfig` so the mesh actually routes through them — "skills
    are MoE experts; all integrate naturally into the neural mesh".

The registry enumerates the complete Extensions list from the design notes so
plugins and skills are described in one authoritative place, in the canonical
Python core, instead of only in the TypeScript tree.
"""
from __future__ import annotations

import getpass
import http.client
import ipaddress
import json
import os
import platform
import re
import shutil
import socket
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional
from urllib.parse import quote, urlparse


class ExtensionType(str, Enum):
    PLUGIN = "plugin"   # connects to a (local) service
    SKILL = "skill"     # a MoE expert integrated into the mesh


@dataclass
class DispatchResult:
    ok: bool
    output: str = ""
    reason: str = ""


# ── plugins: local service connectors (no external APIs) ─────────────────────

class Plugin:
    """A connector to one local service. Subclasses implement `_run`; the base
    handles availability and the no-op fallback so an unavailable service fails
    cleanly instead of erroring."""

    def __init__(self, plugin_id: str, name: str, service: str,
                 capabilities: Optional[List[str]] = None):
        self.id = plugin_id
        self.name = name
        self.service = service
        self.capabilities = capabilities or [plugin_id]

    def available(self) -> bool:
        """Cheap local probe. Base plugins front hardware/OS services we can't
        assume exist in a headless container, so default to unavailable; the
        plugins with a genuine local implementation override this."""
        return False

    def dispatch(self, command: str = "", arg: str = "") -> DispatchResult:
        if not self.available():
            return DispatchResult(
                ok=False,
                reason=f"{self.name}: local service '{self.service}' not available "
                       f"on this host (connector present, no external API used).")
        try:
            return DispatchResult(ok=True, output=self._run(command, arg))
        except Exception as e:  # a plugin fault must never crash the core
            return DispatchResult(ok=False, reason=f"{self.name}: {e}")

    def _run(self, command: str, arg: str) -> str:
        raise NotImplementedError


class FileSystemPlugin(Plugin):
    """Real local file-system access (read-only): list a directory, read a file."""

    def __init__(self):
        super().__init__("file-system", "File System", "os.fs",
                         ["list_dir", "read_file"])

    def available(self) -> bool:
        return True

    def _run(self, command: str, arg: str) -> str:
        cmd = (command or "list_dir").strip()
        target = (arg or ".").strip()
        if cmd == "list_dir":
            entries = sorted(os.listdir(target))
            return "\n".join(entries[:200])
        if cmd == "read_file":
            with open(target, "r", encoding="utf-8", errors="replace") as f:
                return f.read(4096)
        return f"unknown file-system command {cmd!r} (use list_dir|read_file)"


class AppDiagnosticsPlugin(Plugin):
    """Real local diagnostics: platform / CPU / memory summary."""

    def __init__(self):
        super().__init__("app-diagnostics", "App Diagnostics", "os.diagnostics",
                         ["diagnostics"])

    def available(self) -> bool:
        return True

    def _run(self, command: str, arg: str) -> str:
        return (f"system={platform.system()} release={platform.release()} "
                f"machine={platform.machine()} python={platform.python_version()} "
                f"cpus={os.cpu_count()}")


class ScreenshotPlugin(Plugin):
    """Connects to a local screenshot tool if one is installed. Reports the tool
    it would use; capture itself is a side effect left to the gated action layer
    so listing plugins never takes a screenshot."""

    _TOOLS = ("gnome-screenshot", "scrot", "spectacle", "screencapture")

    def __init__(self):
        super().__init__("screenshot", "Screenshot & Screen Recording",
                         "desktop.capture", ["screenshot", "screen-record"])

    def _tool(self) -> Optional[str]:
        for t in self._TOOLS:
            if shutil.which(t):
                return t
        return None

    def available(self) -> bool:
        return self._tool() is not None

    def _run(self, command: str, arg: str) -> str:
        return f"local capture tool available: {self._tool()}"


class AccountInfoPlugin(Plugin):
    """Real local account info: the logged-in user and this machine."""

    def __init__(self):
        super().__init__("account-info", "Account Info", "os.accounts", ["account-info"])

    def available(self) -> bool:
        return True

    def _run(self, command: str, arg: str) -> str:
        try:
            user = getpass.getuser()
        except Exception:
            user = os.environ.get("USER", "unknown")
        return f"user={user} host={socket.gethostname()} home={os.path.expanduser('~')}"


class DeviceConnectivityPlugin(Plugin):
    """Real local connectivity info: hostname and local addresses (no external
    calls — it does not reach out to the network, only reads local host data)."""

    def __init__(self):
        super().__init__("device-connectivity", "Device Connectivity",
                         "os.connectivity", ["device-connectivity"])

    def available(self) -> bool:
        return True

    def _run(self, command: str, arg: str) -> str:
        host = socket.gethostname()
        try:
            addr = socket.gethostbyname(host)
        except Exception:
            addr = "127.0.0.1"
        return f"host={host} address={addr}"


class _JsonStorePlugin(Plugin):
    """Base for plugins backed by a local JSON list (tasks, contacts, calendar,
    notifications). Commands: add <text> | list | clear. Entirely local; the
    store is a JSON file under the registry's data dir."""

    def __init__(self, plugin_id: str, name: str, service: str, data_dir: str,
                 kind: str):
        super().__init__(plugin_id, name, service, [plugin_id])
        self._path = os.path.join(data_dir, f"{plugin_id}.json")
        self._kind = kind

    def available(self) -> bool:
        return True

    def _load(self) -> list:
        if not os.path.exists(self._path):
            return []
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []

    def _save(self, items: list) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(items, f)

    def _run(self, command: str, arg: str) -> str:
        cmd = (command or "list").strip()
        items = self._load()
        if cmd == "add":
            if not arg.strip():
                return f"nothing to add to {self._kind}"
            items.append(arg.strip())
            self._save(items)
            return f"added to {self._kind}: {arg.strip()!r} ({len(items)} total)"
        if cmd == "clear":
            self._save([])
            return f"{self._kind} cleared"
        if cmd == "list":
            return "\n".join(f"{i+1}. {t}" for i, t in enumerate(items)) or f"({self._kind} empty)"
        return f"unknown {self._kind} command {cmd!r} (use add|list|clear)"


class EmailPlugin(Plugin):
    """Real email send/receive over the network: SMTP to send, IMAP to read the
    inbox. Uses only Python's own stdlib (smtplib, imaplib, email) -- no bundled
    mail-provider SDK, no third-party API service in front of it -- and reads
    the server + credentials from environment variables, the same pattern
    `MYAI_PASSPHRASE` already uses for local memory encryption.

    This is the "Email" extension the design notes list among the AI's
    connectable services; it was previously registered only as an
    always-unavailable stub (a bare `Plugin` instance in `_SERVICE_PLUGINS`,
    honest about there being no real implementation behind it, but never
    actually implemented). Unlike this registry's other plugins, sending mail
    is a genuine outbound network action, not a purely local one -- documented
    here rather than silently treated the same as the local-only plugins.
    """

    def __init__(self):
        super().__init__("email", "Email", "os.mail", ["send", "list", "unread"])

    def _smtp_config(self) -> Optional[tuple]:
        host = os.environ.get("MYAI_SMTP_HOST")
        user = os.environ.get("MYAI_SMTP_USER")
        password = os.environ.get("MYAI_SMTP_PASSWORD")
        if not (host and user and password):
            return None
        port = int(os.environ.get("MYAI_SMTP_PORT", "587"))
        return host, port, user, password

    def _imap_config(self) -> Optional[tuple]:
        host = os.environ.get("MYAI_IMAP_HOST")
        user = os.environ.get("MYAI_IMAP_USER") or os.environ.get("MYAI_SMTP_USER")
        password = os.environ.get("MYAI_IMAP_PASSWORD") or os.environ.get("MYAI_SMTP_PASSWORD")
        if not (host and user and password):
            return None
        port = int(os.environ.get("MYAI_IMAP_PORT", "993"))
        return host, port, user, password

    def available(self) -> bool:
        return self._smtp_config() is not None or self._imap_config() is not None

    def _run(self, command: str, arg: str) -> str:
        cmd = (command or "list").strip().lower()
        if cmd == "send":
            return self._send(arg)
        if cmd in ("list", "unread"):
            return self._fetch(unread_only=(cmd == "unread"))
        return f"unknown email command {cmd!r} (use send|list|unread)"

    def _send(self, arg: str) -> str:
        cfg = self._smtp_config()
        if cfg is None:
            return ("email send not configured -- set MYAI_SMTP_HOST, MYAI_SMTP_USER, "
                    "MYAI_SMTP_PASSWORD (optionally MYAI_SMTP_PORT, default 587)")
        parts = arg.split("|", 2)
        if len(parts) < 3 or not parts[0].strip():
            return "usage: plugin: email send <to>|<subject>|<body>"
        to, subject, body = (p.strip() for p in parts)
        host, port, user, password = cfg
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["From"] = user
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=10) as s:
                s.login(user, password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=10) as s:
                s.starttls()
                s.login(user, password)
                s.send_message(msg)
        return f"sent to {to}: {subject!r}"

    def _fetch(self, unread_only: bool) -> str:
        cfg = self._imap_config()
        if cfg is None:
            return ("email read not configured -- set MYAI_IMAP_HOST, MYAI_IMAP_USER "
                    "(or MYAI_SMTP_USER), MYAI_IMAP_PASSWORD (or MYAI_SMTP_PASSWORD)")
        host, port, user, password = cfg
        import imaplib
        import email as email_lib
        with imaplib.IMAP4_SSL(host, port, timeout=10) as m:
            m.login(user, password)
            m.select("INBOX")
            typ, data = m.search(None, "UNSEEN" if unread_only else "ALL")
            if typ != "OK":
                return f"IMAP search failed: {typ}"
            ids = data[0].split() if data and data[0] else []
            lines = []
            for msg_id in reversed(ids[-10:]):
                typ, msg_data = m.fetch(msg_id, "(RFC822.HEADER)")
                if typ != "OK" or not msg_data or not msg_data[0]:
                    continue
                header = email_lib.message_from_bytes(msg_data[0][1])
                lines.append(f"{header.get('From', '?')} -- {header.get('Subject', '(no subject)')}")
        if not lines:
            return "(no unread messages)" if unread_only else "(inbox empty)"
        return "\n".join(lines)


def _is_private_ip_literal(hostname: str) -> bool:
    """True only when `hostname` is *itself* a private/loopback/link-local/
    reserved/multicast IP literal (e.g. "127.0.0.1"). False for anything that
    doesn't even parse as an IP -- an ordinary DNS name like "example.com" is
    not caught here; it still gets checked after resolution by
    `_is_private_resolved_ip`. Deliberately NOT fail-closed: every ordinary
    hostname fails to parse as an IP, so fail-closed here would refuse all of
    them before DNS resolution ever ran."""
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return (ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified)


def _is_private_resolved_ip(ip_str: str) -> bool:
    """True for a private/loopback/link-local/reserved/multicast *resolved*
    address, and for anything that fails to parse as an IP at all (fail
    closed) -- unlike the hostname check above, this only ever runs on
    `socket.gethostbyname`'s return value, which should always be a real IP;
    if it somehow isn't, treat that as unsafe rather than let it through."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified)


class WebPlugin(Plugin):
    """Real web access: fetch a URL's content, or run a text search over the
    public web. Alongside `email`, this is the other deliberate exception to
    this registry's local-only design (see the module docstring) -- reaches
    the real network over plain HTTP(S), stdlib only (`http.client`,
    `urllib.parse`), no third-party search/scraping API in front of it.

    Mirrors `models && skills/plugins/browser.ts`'s `BrowserPlugin.fetchUrl`
    SSRF protections: reject non-http(s) schemes, reject hostnames that are
    themselves a private/loopback/link-local literal, resolve DNS once and
    connect directly to the *resolved* IP (rejecting it too if private) --
    closing the DNS-rebinding TOCTOU window a hostname-only check would leave
    open, the same reasoning the TypeScript version documents for pinning its
    request to the resolved address instead of trusting the hostname twice.
    """

    def __init__(self):
        super().__init__("web", "Web", "net.web", ["fetch", "search"])

    def available(self) -> bool:
        return True

    def _run(self, command: str, arg: str) -> str:
        cmd = (command or "fetch").strip().lower()
        if cmd == "fetch":
            return self._fetch(arg.strip())
        if cmd == "search":
            return self._search(arg.strip())
        return f"unknown web command {cmd!r} (use fetch|search)"

    def _fetch_raw(self, url: str, max_bytes: int = 65536) -> str:
        """Fetch `url`'s body as text, or raise ValueError with a clear,
        user-facing reason if it's refused or fails."""
        parsed = urlparse(url if "://" in url else f"https://{url}")
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"unsupported scheme {parsed.scheme!r} (http/https only)")
        hostname = parsed.hostname or ""
        if not hostname or hostname.lower() == "localhost":
            raise ValueError(f"access to private/local host {hostname!r} is forbidden")
        if _is_private_ip_literal(hostname):
            raise ValueError(f"access to private/local address {hostname!r} is forbidden")
        try:
            resolved_ip = socket.gethostbyname(hostname)
        except OSError as e:
            raise ValueError(f"DNS resolution failed for {hostname!r}: {e}")
        if _is_private_resolved_ip(resolved_ip):
            raise ValueError(f"access to private/local address {resolved_ip!r} is forbidden")

        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        path = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
        conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(resolved_ip, port, timeout=10)
        try:
            conn.request("GET", path, headers={"Host": hostname, "User-Agent": "Mozilla/5.0 (Neuroclaw)"})
            resp = conn.getresponse()
            return resp.read(max_bytes).decode("utf-8", errors="replace")
        finally:
            conn.close()

    def _fetch(self, url: str) -> str:
        if not url:
            return "usage: plugin: web fetch <url>"
        try:
            body = self._fetch_raw(url)
        except ValueError as e:
            return f"refused: {e}"
        except OSError as e:
            return f"fetch failed: {e}"
        title_match = re.search(r"<title[^>]*>(.*?)</title>", body, re.IGNORECASE | re.DOTALL)
        title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else url
        return f"Fetched {url} ({len(body)} bytes) -- {title[:120]}"

    def _search(self, query: str) -> str:
        if not query:
            return "usage: plugin: web search <query>"
        try:
            html = self._fetch_raw(f"https://html.duckduckgo.com/html/?q={quote(query)}")
        except (ValueError, OSError) as e:
            return f"web search failed: {e}"
        matches = re.findall(
            r'class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', html, re.DOTALL)
        if not matches:
            return f"(no results for {query!r})"
        lines = []
        for href, raw_title in matches[:5]:
            title = re.sub(r"<[^>]*>", "", raw_title)
            title = re.sub(r"\s+", " ", title).strip()
            lines.append(f"{title or '(untitled)'} -- {href}")
        return "\n".join(lines)


class ChromeAppsPlugin(Plugin):
    """Chrome applications connector: detects a locally-installed Chrome/Chromium
    and reports the launch command for a local app (it does not open a network
    connection — launching is left to the gated action layer)."""

    _BINARIES = ("google-chrome", "google-chrome-stable", "chromium",
                 "chromium-browser", "chrome")

    def __init__(self):
        super().__init__("browser", "Browser / Chrome Apps", "os.chrome",
                         ["browser", "chrome-apps"])

    def _binary(self) -> Optional[str]:
        for b in self._BINARIES:
            if shutil.which(b):
                return b
        # common macOS location
        mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        return mac if os.path.exists(mac) else None

    def available(self) -> bool:
        return self._binary() is not None

    def _run(self, command: str, arg: str) -> str:
        app = (arg or "").strip()
        flag = f"--app={app}" if app else "--new-window"
        return f"chrome available: {self._binary()} (would launch {flag})"


# Every extension from the design notes, each tagged plugin vs skill. Plugins
# front local services; skills are MoE experts (built lazily via SKILL_FACTORIES).
# Zero-arg plugin classes (data-dir-backed ones are built in the registry).
_PLUGIN_CLASSES: Dict[str, Callable[[], Plugin]] = {
    "file-system": FileSystemPlugin,
    "app-diagnostics": AppDiagnosticsPlugin,
    "screenshot": ScreenshotPlugin,
    "account-info": AccountInfoPlugin,
    "device-connectivity": DeviceConnectivityPlugin,
    "browser": ChromeAppsPlugin,
    "email": EmailPlugin,
    "web": WebPlugin,
}

# id -> (display name, service, kind) for the local JSON-store plugins.
_STORE_PLUGINS = {
    "tasks": ("Tasks", "os.tasks", "tasks"),
    "contacts": ("Contacts", "os.contacts", "contacts"),
    "calendar": ("Calendar", "os.calendar", "calendar"),
    "notifications": ("Notifications", "os.notifications", "notifications"),
    "messaging": ("Messaging", "os.messaging", "messages"),
}

# Service connectors that front hardware/OS services we don't assume in a
# headless host: (id, display name, service). They register as plugins with the
# honest default-unavailable behaviour above (real connectors, no external API,
# but the underlying hardware/service isn't present to talk to here).
_SERVICE_PLUGINS: List = [
    ("location", "Location", "os.location"),
    ("camera", "Camera", "hw.camera"),
    ("microphone", "Microphone", "hw.microphone"),
    ("voice-activation", "Voice Activation", "hw.microphone"),
    ("phone-calls", "Phone Calls", "os.telephony"),
    ("call-history", "Call History", "os.telephony"),
    ("radio", "Radio", "hw.radio"),
    ("passkeys", "Passkeys", "os.keystore"),
]

# Skills = MoE experts. Each maps to an expert factory (in_dim/out_dim supplied
# by attach_to_config so they match the mesh's input width).
SKILL_IDS = ["coding", "net-search", "plugin-builder", "skill-builder", "self-healing"]
_SKILL_NAMES = {
    "coding": "Coding Skill",
    "net-search": "Net Search Skill",
    "plugin-builder": "Plugin Builder Skill",
    "skill-builder": "Skill Builder Skill",
    "self-healing": "Self-Healing Skill",
}


def _skill_expert(skill_id: str, in_dim: int, out_dim: int):
    """Build the MoE expert that realises a skill (imported lazily so the plugin
    side of the registry works without torch). Each expert is named for its
    skill so usage tracking keeps them distinct even when several share an
    expert class."""
    from .experts import CodeNetExpert, SearchExpert
    if skill_id in ("coding", "plugin-builder", "skill-builder", "self-healing"):
        expert = CodeNetExpert(in_dim=in_dim, out_dim=out_dim)
    else:
        expert = SearchExpert(vocab_dim=in_dim, out_dim=out_dim)
    expert.name = skill_id
    return expert


@dataclass
class Extension:
    id: str
    name: str
    type: ExtensionType
    service: Optional[str] = None          # plugins only
    plugin: Optional[Plugin] = None        # instantiated plugin


class PluginSkillRegistry:
    """One registry that distinguishes plugins from skills and connects skills to
    the mesh MoE."""

    def __init__(self, data_dir: Optional[str] = None):
        # local data store for the file-backed plugins (tasks/contacts/…). Created
        # at runtime; not a committed path.
        self.data_dir = data_dir or os.path.join(os.getcwd(), ".myai_runtime")
        self.extensions: Dict[str, Extension] = {}
        for pid, factory in _PLUGIN_CLASSES.items():
            p = factory()
            self.extensions[pid] = Extension(pid, p.name, ExtensionType.PLUGIN,
                                             p.service, p)
        for pid, (name, service, kind) in _STORE_PLUGINS.items():
            p = _JsonStorePlugin(pid, name, service, self.data_dir, kind)
            self.extensions[pid] = Extension(pid, name, ExtensionType.PLUGIN, service, p)
        for pid, name, service in _SERVICE_PLUGINS:
            if pid in self.extensions:
                continue
            p = Plugin(pid, name, service)
            self.extensions[pid] = Extension(pid, name, ExtensionType.PLUGIN, service, p)
        for sid in SKILL_IDS:
            self.extensions[sid] = Extension(sid, _SKILL_NAMES[sid], ExtensionType.SKILL)

    # ---- listing -----------------------------------------------------------
    def plugins(self) -> List[Extension]:
        return [e for e in self.extensions.values() if e.type is ExtensionType.PLUGIN]

    def skills(self) -> List[Extension]:
        return [e for e in self.extensions.values() if e.type is ExtensionType.SKILL]

    def get(self, ext_id: str) -> Optional[Extension]:
        return self.extensions.get(ext_id)

    def register_skill(self, skill_id: str, name: Optional[str] = None) -> Extension:
        """Register a new skill (e.g. the coding extension the AI creates after
        learning to code). Idempotent."""
        ext = Extension(skill_id, name or skill_id.replace("-", " ").title(),
                        ExtensionType.SKILL)
        self.extensions[skill_id] = ext
        return ext

    # ---- plugins: local dispatch ------------------------------------------
    def dispatch(self, plugin_id: str, command: str = "", arg: str = "") -> DispatchResult:
        ext = self.extensions.get(plugin_id)
        if ext is None or ext.type is not ExtensionType.PLUGIN or ext.plugin is None:
            return DispatchResult(ok=False, reason=f"no plugin {plugin_id!r}")
        return ext.plugin.dispatch(command, arg)

    # ---- skills: integrate into the mesh MoE ------------------------------
    def build_expert_moe(self, in_dim: int, out_dim: int = 16, top_k: int = 2):
        """Construct an ExpertMoE from the registered skills so they become real
        mesh experts. Returns None if there are no skills."""
        from .experts import ExpertMoE
        skills = self.skills()
        if not skills:
            return None
        experts = [_skill_expert(s.id, in_dim, out_dim) for s in skills]
        return ExpertMoE(experts, top_k=min(top_k, len(experts)))

    def attach_to_config(self, cfg, out_dim: int = 16, top_k: int = 2):
        """Wire the skills onto a ModelConfig as its expert MoE. The mesh input
        width is n_input * (n_dims - 1) content dims — matched here so the
        experts line up with what the mesh feeds them."""
        in_dim = cfg.mesh_input * (cfg.mesh_dims - 1)
        cfg.expert_moe = self.build_expert_moe(in_dim, out_dim=out_dim, top_k=top_k)
        return cfg.expert_moe

    def summary(self) -> Dict[str, List[str]]:
        return {
            "plugins": [f"{e.name} -> {e.service}"
                        + ("" if e.plugin and e.plugin.available() else " (unavailable)")
                        for e in self.plugins()],
            "skills": [e.name for e in self.skills()],
        }


def build_plugin(registry: PluginSkillRegistry, plugin_id: str, service: str,
                 name: Optional[str] = None, kind: Optional[str] = None) -> Extension:
    """Plugin Builder skill: "creates and configures new plugins" (design
    notes, Extensions). Builds a new local, JSON-store-backed connector (the
    same real mechanism tasks/contacts/calendar/notifications/messaging use —
    add/list/clear against a local file, no external API) and registers it
    into `registry` immediately, so it shows up in `plugins()` /
    `dispatch()` right away. Idempotent: calling again with the same
    `plugin_id` replaces the prior registration."""
    display_name = name or plugin_id.replace("-", " ").title()
    p = _JsonStorePlugin(plugin_id, display_name, service, registry.data_dir,
                        kind or plugin_id)
    ext = Extension(plugin_id, display_name, ExtensionType.PLUGIN, service, p)
    registry.extensions[plugin_id] = ext
    return ext


def default_registry(data_dir: Optional[str] = None) -> PluginSkillRegistry:
    """The full extension set from the design notes."""
    return PluginSkillRegistry(data_dir=data_dir)
