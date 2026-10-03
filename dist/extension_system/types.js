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
export {};
