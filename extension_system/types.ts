/**
 * Extension System -- core data structures (docs/EXTENSION_SYSTEM.md).
 *
 * An "extension" here is a superset of `plugin_manager`'s PluginDefinition:
 * where a plugin is executable code wired into the message-dispatch loop, an
 * Extension is any versioned, dependency-aware, permissioned, storable unit
 * of durable state the system produces on its own -- a memory snapshot, a
 * reasoning/logic artifact, a reusable skill, or a runnable plugin. Reuses
 * `ExtensionPermission` from plugin_manager/types.ts so a single permission
 * vocabulary covers both plugins and extensions.
 */

import type { ExtensionPermission } from "../plugin_manager/types.js";

export type { ExtensionPermission } from "../plugin_manager/types.js";

/** What kind of durable artifact this extension packages. */
export type ExtensionKind = "memory" | "logic" | "skill" | "plugin" | "composite";

/** Lifecycle states an installed extension version can be in. */
export type ExtensionState =
  | "installed"   // stored, validated, not yet activated
  | "active"      // activated and reachable by the runtime
  | "inactive"    // deactivated but still installed (can be reactivated)
  | "disabled"    // administratively blocked from activation (bad health/security)
  | "removed";    // tombstoned; content retained for audit until GC

/** A dependency on another extension, by id and semver range (see semver.ts). */
export interface DependencySpec {
  id: string;
  /** e.g. "^1.2.0", "~1.2.0", ">=1.0.0", "1.2.3", or "*". */
  range: string;
  /** If true, missing/unsatisfied dependency blocks activation; if false, it's a soft hint. */
  required: boolean;
}

/** How the extension's payload bytes are encoded on disk. */
export interface StorageEncoding {
  /** "raw" | "gzip" -- byte-level compression, mirrors ZipIOSystem's gzip use. */
  compression: "raw" | "gzip";
  /** Present when the payload is a quantized numeric model (BackgroundQuantizer). */
  quantization?: {
    bits: number;
    method: "symmetric" | "asymmetric" | "mixed";
  };
  /** SHA-256 hex digest of the *decoded* (pre-compression) payload, for integrity checks. */
  contentHash: string;
  /** Byte length of the stored (encoded) payload. */
  storedBytes: number;
  /** Byte length of the original (decoded) payload. */
  originalBytes: number;
}

/** Where an auto-created extension's content came from -- an audit trail, not a guess. */
export interface Provenance {
  autoCreated: boolean;
  /** e.g. "skill-maker", "plugin-maker", "long-term-memory:consolidate", "user-request". */
  createdBy: string;
  /** Freeform references (matches SkillMakerExtension's "sources" convention). */
  sources: string[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  /** Semver "MAJOR.MINOR.PATCH". */
  version: string;
  kind: ExtensionKind;
  description: string;
  author: string;
  permissions: ExtensionPermission[];
  dependencies: DependencySpec[];
  /** Only meaningful for kind "plugin": module path the loader instantiates. */
  entrypoint?: string;
  capabilities: string[];
  provenance: Provenance;
  createdAt: number;
  updatedAt: number;
}

/** A stored, versioned instance of an extension: manifest + encoded payload location. */
export interface ExtensionRecord {
  manifest: ExtensionManifest;
  state: ExtensionState;
  encoding: StorageEncoding;
  /** Absolute path to the payload file on disk. */
  payloadPath: string;
  activatedAt?: number;
  deactivatedAt?: number;
}

export interface PermissionGrant {
  extensionId: string;
  permission: ExtensionPermission;
  granted: boolean;
  grantedAt: number;
  /** Who/what approved it -- "user", "auto-policy", etc. */
  grantedBy: string;
}

export interface DependencyResolution {
  satisfied: boolean;
  /** id -> resolved version, for every dependency that *was* resolvable. */
  resolved: Record<string, string>;
  /** Dependencies that could not be satisfied (missing id, or no version in range). */
  missing: DependencySpec[];
}
