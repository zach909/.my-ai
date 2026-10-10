/**
 * Permission and sandbox enforcement for extensions (docs/EXTENSION_SYSTEM.md
 * Section 13: Security).
 *
 * Reuses the single `ExtensionPermission` vocabulary already defined in
 * plugin_manager/types.ts so plugins and extensions are governed by the same
 * grant model. Nothing here calls out to a network service: grants are
 * local, explicit, and auditable (every grant/revoke is timestamped and
 * attributed).
 */

import type { ExtensionPermission, PermissionGrant } from "./types.js";

export class PermissionDeniedError extends Error {
  constructor(extensionId: string, permission: ExtensionPermission) {
    super(`Extension "${extensionId}" is not granted permission "${permission}"`);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Permissions that MUST be explicitly granted by a human before an extension
 * requesting them can activate, even if it's self-authored by the system.
 * Everything else is auto-granted on install (least-surprise defaults for
 * inert capabilities like "coding" or "skill-maker").
 */
const SENSITIVE_PERMISSIONS: ReadonlySet<ExtensionPermission> = new Set([
  // Personal data, sensors, communications, and broad data access.
  "camera", "microphone", "voice-activation", "location", "contacts", "email",
  "phone-calls", "call-history", "messaging", "file-system", "browser",
  "account-info", "screenshots-screen-recording", "passkeys",
  // Linux access that can expose private data or alter the host/security boundary.
  "linux-file-read", "linux-file-write", "linux-file-execute",
  "linux-file-create-delete", "linux-file-metadata", "linux-chmod", "linux-chown",
  "linux-suid-sgid-sticky", "linux-acl-read", "linux-acl-write",
  "linux-extended-attributes", "linux-immutable-append-only", "linux-mount-unmount",
  "linux-removable-storage", "linux-user-group-read", "linux-user-group-admin",
  "linux-sudo-admin", "linux-root-access-request", "linux-polkit-elevation", "linux-privileged-helper-manage", "linux-process-inspect", "linux-process-control",
  "linux-service-control", "linux-package-management", "linux-kernel-modules",
  "linux-sysctl", "linux-hostname-time-power", "linux-boot-configuration",
  "linux-scheduled-jobs", "linux-environment-variables", "linux-system-logs",
  "linux-audit-logs", "linux-system-information", "linux-backup-restore",
  "linux-capabilities-admin", "linux-selinux-context-read", "linux-selinux-policy-admin",
  "linux-apparmor-status-read", "linux-apparmor-policy-admin",
  "linux-security-policy-admin", "linux-firewall-admin", "linux-network-config",
  "linux-dbus-control", "linux-device-access", "linux-container-control",
  "linux-namespace-control", "linux-credential-store", "linux-ssh-key-access",
  "linux-certificate-store", "linux-cryptographic-key-access",
  "linux-screen-capture", "linux-audio-device", "linux-input-monitoring",
  "linux-keyboard-mouse-control", "linux-clipboard", "linux-display-settings",
  "linux-printer-access", "linux-bluetooth", "linux-wifi",
  // Business-system permissions can expose or change commercially sensitive records.
  "lennox-admin-controls", "lennox-ordering", "lennox-inventory",
  "lennox-pricing-visibility", "lennox-warranty-returns",
]);

export class PermissionGuard {
  private grants = new Map<string, Map<ExtensionPermission, PermissionGrant>>();

  isSensitive(permission: ExtensionPermission): boolean {
    return SENSITIVE_PERMISSIONS.has(permission);
  }

  grant(extensionId: string, permission: ExtensionPermission, grantedBy = "user"): PermissionGrant {
    const g: PermissionGrant = { extensionId, permission, granted: true, grantedAt: Date.now(), grantedBy };
    this.forId(extensionId).set(permission, g);
    return g;
  }

  revoke(extensionId: string, permission: ExtensionPermission): void {
    this.forId(extensionId).delete(permission);
  }

  isGranted(extensionId: string, permission: ExtensionPermission): boolean {
    return this.forId(extensionId).get(permission)?.granted === true;
  }

  listGrants(extensionId: string): PermissionGrant[] {
    return Array.from(this.forId(extensionId).values());
  }

  /**
   * Auto-grant every requested permission that isn't sensitive; sensitive
   * ones are left ungranted (activation must fail loudly rather than
   * silently degrade -- see ExtensionManager.activate).
   */
  autoGrantNonSensitive(extensionId: string, permissions: ExtensionPermission[]): ExtensionPermission[] {
    const stillNeeded: ExtensionPermission[] = [];
    for (const p of permissions) {
      if (this.isSensitive(p)) {
        stillNeeded.push(p);
      } else {
        this.grant(extensionId, p, "auto-policy");
      }
    }
    return stillNeeded;
  }

  /** Throws PermissionDeniedError on the first ungranted permission. */
  assertAll(extensionId: string, permissions: ExtensionPermission[]): void {
    for (const p of permissions) {
      if (!this.isGranted(extensionId, p)) throw new PermissionDeniedError(extensionId, p);
    }
  }

  private forId(extensionId: string): Map<ExtensionPermission, PermissionGrant> {
    let m = this.grants.get(extensionId);
    if (!m) {
      m = new Map();
      this.grants.set(extensionId, m);
    }
    return m;
  }
}
