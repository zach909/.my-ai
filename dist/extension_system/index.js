export { ExtensionStore } from "./store.js";
export { PermissionGuard, PermissionDeniedError } from "./security.js";
export { ExtensionManager, DependencyError } from "./manager.js";
export { parseVersion, isValidVersion, compareVersions, gt, satisfies, resolveBest } from "./semver.js";
