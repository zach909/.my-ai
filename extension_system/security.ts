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
  "camera",
  "microphone",
  "location",
  "contacts",
  "email",
  "phone-calls",
  "call-history",
  "messaging",
  "file-system",
  "browser",
  "account-info",
  "screenshots-screen-recording",
  "passkeys",
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
