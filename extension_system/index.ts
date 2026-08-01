export { ExtensionStore } from "./store.js";
export type { WriteOptions } from "./store.js";

export { PermissionGuard, PermissionDeniedError } from "./security.js";

export { ExtensionManager, DependencyError } from "./manager.js";
export type { InstallInput } from "./manager.js";

export { parseVersion, isValidVersion, compareVersions, gt, satisfies, resolveBest } from "./semver.js";
export type { Version } from "./semver.js";

export type {
  ExtensionKind,
  ExtensionState,
  ExtensionManifest,
  ExtensionRecord,
  DependencySpec,
  DependencyResolution,
  StorageEncoding,
  Provenance,
  PermissionGrant,
  ExtensionPermission,
} from "./types.js";
