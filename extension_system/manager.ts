/**
 * ExtensionManager -- lifecycle, dependency resolution, versioning, and
 * automatic creation for the Extension System (docs/EXTENSION_SYSTEM.md).
 *
 * This is the orchestration layer above ExtensionStore (bytes on disk) and
 * PermissionGuard (grants). It is the single place the runtime (and the AI
 * itself, when it decides to remember/reason/skill-ify something durably)
 * goes through to install, activate, update, or remove an extension.
 */

import type {
  DependencyResolution,
  DependencySpec,
  ExtensionKind,
  ExtensionManifest,
  ExtensionPermission,
  ExtensionRecord,
  ExtensionState,
} from "./types.js";
import { ExtensionStore, type WriteOptions } from "./store.js";
import { PermissionGuard, PermissionDeniedError } from "./security.js";
import { compareVersions, gt, isValidVersion, resolveBest } from "./semver.js";

export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyError";
  }
}

export interface InstallInput {
  id: string;
  name: string;
  version?: string; // defaults to "1.0.0" for a brand-new id
  kind: ExtensionKind;
  description: string;
  author?: string;
  permissions?: ExtensionPermission[];
  dependencies?: DependencySpec[];
  entrypoint?: string;
  capabilities?: string[];
  payload: Buffer;
  storageOptions?: WriteOptions;
  provenance?: { autoCreated: boolean; createdBy: string; sources?: string[] };
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export class ExtensionManager {
  private readonly store: ExtensionStore;
  readonly permissions: PermissionGuard;
  /** id -> version -> record. In-memory index; source of truth is ExtensionStore on disk. */
  private records = new Map<string, Map<string, ExtensionRecord>>();
  /** id -> currently active version. */
  private active = new Map<string, string>();

  constructor(opts?: { rootDir?: string; store?: ExtensionStore; permissions?: PermissionGuard }) {
    this.store = opts?.store ?? new ExtensionStore(opts?.rootDir);
    this.permissions = opts?.permissions ?? new PermissionGuard();
  }

  /** Hydrate the in-memory index from what's already on disk (Section 16: runtime integration / restart). */
  load(): void {
    for (const id of this.store.listIds()) {
      for (const version of this.store.listVersions(id)) {
        const manifest = this.store.readManifest(id, version);
        const encoding = this.store.readEncoding(id, version);
        if (!manifest || !encoding) continue;
        this.indexRecord({
          manifest,
          state: "installed",
          encoding,
          payloadPath: `${id}/${version}/payload.bin`,
        });
      }
    }
    const activeMap = this.store.readActiveMap();
    for (const [id, version] of Object.entries(activeMap)) {
      const rec = this.records.get(id)?.get(version);
      if (rec) {
        rec.state = "active";
        this.active.set(id, version);
      }
    }
  }

  private indexRecord(record: ExtensionRecord): void {
    let byVersion = this.records.get(record.manifest.id);
    if (!byVersion) {
      byVersion = new Map();
      this.records.set(record.manifest.id, byVersion);
    }
    byVersion.set(record.manifest.version, record);
  }

  // ---------------------------------------------------------------- install

  async install(input: InstallInput): Promise<ExtensionRecord> {
    const id = input.id || slugify(input.name);
    const version = input.version ?? "1.0.0";
    if (!isValidVersion(version)) throw new Error(`Invalid version "${version}" for extension "${id}"`);
    if (this.records.get(id)?.has(version)) {
      throw new Error(`Extension "${id}"@${version} is already installed`);
    }

    const now = Date.now();
    const manifest: ExtensionManifest = {
      id,
      name: input.name,
      version,
      kind: input.kind,
      description: input.description,
      author: input.author ?? "system",
      permissions: input.permissions ?? [],
      dependencies: input.dependencies ?? [],
      entrypoint: input.entrypoint,
      capabilities: input.capabilities ?? [],
      provenance: {
        autoCreated: input.provenance?.autoCreated ?? false,
        createdBy: input.provenance?.createdBy ?? "user",
        sources: input.provenance?.sources ?? [],
      },
      createdAt: now,
      updatedAt: now,
    };

    // Dependencies are declared at install time but only *resolved and
    // enforced* at activation: an extension may be installed before its
    // dependency exists on disk yet (e.g. both produced in the same
    // auto-creation batch), it just can't activate until they do.
    const encoding = await this.store.write(id, version, input.payload, input.storageOptions);
    this.store.writeManifest(manifest);

    const record: ExtensionRecord = {
      manifest,
      state: "installed",
      encoding,
      payloadPath: `${id}/${version}/payload.bin`,
    };
    this.indexRecord(record);

    // Every permission that isn't sensitive is auto-granted at install time
    // so non-sensitive extensions (coding, skill-maker, ...) don't need a
    // human in the loop; sensitive ones stay ungranted until explicitly
    // approved (Section 13: Security).
    this.permissions.autoGrantNonSensitive(id, manifest.permissions);

    return record;
  }

  /**
   * Automatic creation entrypoint (Section 4): the AI calling this is
   * declaring "I decided to keep this" -- a piece of memory, a reasoning
   * trace, a synthesized skill -- as a durable, versioned extension rather
   * than transient output. If `id` already has an installed version, this
   * is treated as an update (a new version), not a duplicate install.
   */
  async autoCreate(input: Omit<InstallInput, "version" | "id"> & { id?: string; createdBy: string; sources?: string[] }): Promise<ExtensionRecord> {
    const id = input.id || slugify(input.name);
    const existingVersions = this.store.listVersions(id).concat(Array.from(this.records.get(id)?.keys() ?? []));
    const provenance = { autoCreated: true, createdBy: input.createdBy, sources: input.sources ?? [] };

    if (existingVersions.length === 0) {
      return this.install({ ...input, id, version: "1.0.0", provenance });
    }
    const latest = existingVersions.reduce((best, v) => (gt(v, best) ? v : best));
    const [major, minor, patch] = latest.split(".").map(Number);
    const nextVersion = `${major}.${minor}.${patch + 1}`;
    return this.update(id, nextVersion, input.payload, {
      description: input.description,
      capabilities: input.capabilities,
      permissions: input.permissions,
      dependencies: input.dependencies,
      storageOptions: input.storageOptions,
      provenance,
    });
  }

  // ------------------------------------------------------------ versioning

  async update(
    id: string,
    newVersion: string,
    payload: Buffer,
    patch: {
      description?: string;
      capabilities?: string[];
      permissions?: ExtensionPermission[];
      dependencies?: DependencySpec[];
      storageOptions?: WriteOptions;
      provenance?: { autoCreated: boolean; createdBy: string; sources?: string[] };
    } = {},
  ): Promise<ExtensionRecord> {
    const byVersion = this.records.get(id);
    if (!byVersion || byVersion.size === 0) throw new Error(`Extension "${id}" is not installed; cannot update`);
    const latest = this.latestVersion(id)!;
    if (!gt(newVersion, latest)) {
      throw new Error(`New version "${newVersion}" must be greater than current latest "${latest}"`);
    }
    const base = byVersion.get(latest)!.manifest;
    const wasActive = this.active.get(id) === latest;

    const record = await this.install({
      id,
      name: base.name,
      version: newVersion,
      kind: base.kind,
      description: patch.description ?? base.description,
      author: base.author,
      permissions: patch.permissions ?? base.permissions,
      dependencies: patch.dependencies ?? base.dependencies,
      entrypoint: base.entrypoint,
      capabilities: patch.capabilities ?? base.capabilities,
      payload,
      storageOptions: patch.storageOptions,
      provenance: patch.provenance ?? { autoCreated: base.provenance.autoCreated, createdBy: base.provenance.createdBy, sources: base.provenance.sources },
    });

    // Old versions are retained on disk (rollback support); only the
    // in-memory "which version is active" pointer moves forward.
    if (wasActive) {
      await this.deactivate(id);
      await this.activate(id, newVersion);
    }
    return record;
  }

  /** Reactivate the version immediately before the one currently active. */
  async rollback(id: string): Promise<ExtensionRecord> {
    const versions = this.installedVersions(id).sort(compareVersions);
    const currentActive = this.active.get(id);
    const idx = currentActive ? versions.indexOf(currentActive) : versions.length;
    if (idx <= 0) throw new Error(`No earlier version of "${id}" to roll back to`);
    const target = versions[idx - 1];
    if (currentActive) await this.deactivate(id);
    return this.activate(id, target);
  }

  // ------------------------------------------------------------ dependencies

  resolveDependencies(manifest: ExtensionManifest): DependencyResolution {
    const resolved: Record<string, string> = {};
    const missing: DependencySpec[] = [];
    for (const dep of manifest.dependencies) {
      this.assertNoCycle(manifest.id, dep.id, new Set([manifest.id]));
      const available = this.installedVersions(dep.id);
      const best = resolveBest(available, dep.range);
      if (best) {
        resolved[dep.id] = best;
      } else if (dep.required) {
        missing.push(dep);
      }
    }
    return { satisfied: missing.length === 0, resolved, missing };
  }

  private assertNoCycle(rootId: string, currentId: string, visited: Set<string>): void {
    if (visited.has(currentId)) {
      throw new DependencyError(`Circular dependency detected involving "${rootId}" -> "${currentId}"`);
    }
    const latest = this.latestVersion(currentId);
    if (!latest) return; // dependency not installed (yet) -- handled by resolveDependencies' `missing`
    const manifest = this.records.get(currentId)!.get(latest)!.manifest;
    const nextVisited = new Set(visited);
    nextVisited.add(currentId);
    for (const dep of manifest.dependencies) this.assertNoCycle(rootId, dep.id, nextVisited);
  }

  /** Every extension that lists `id` as a *required* dependency of its active version. */
  private activeDependents(id: string): string[] {
    const dependents: string[] = [];
    for (const [depId, version] of this.active) {
      const manifest = this.records.get(depId)?.get(version)?.manifest;
      if (!manifest) continue;
      if (manifest.dependencies.some(d => d.id === id && d.required)) dependents.push(depId);
    }
    return dependents;
  }

  // -------------------------------------------------------------- lifecycle

  async activate(id: string, version?: string): Promise<ExtensionRecord> {
    const targetVersion = version ?? this.latestVersion(id);
    if (!targetVersion) throw new Error(`Extension "${id}" is not installed`);
    const record = this.records.get(id)?.get(targetVersion);
    if (!record) throw new Error(`Extension "${id}"@${targetVersion} is not installed`);

    const resolution = this.resolveDependencies(record.manifest);
    if (!resolution.satisfied) {
      const names = resolution.missing.map(d => `${d.id}@${d.range}`).join(", ");
      throw new DependencyError(`Cannot activate "${id}"@${targetVersion}: unresolved dependencies ${names}`);
    }
    // Activate required dependencies first (deepest-needed activates first).
    for (const [depId, depVersion] of Object.entries(resolution.resolved)) {
      const dep = record.manifest.dependencies.find(d => d.id === depId);
      if (dep?.required && this.active.get(depId) !== depVersion) {
        await this.activate(depId, depVersion);
      }
    }

    try {
      this.permissions.assertAll(id, record.manifest.permissions);
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        record.state = "disabled";
        throw e;
      }
      throw e;
    }

    // Only one active version per id; swap out the old one first.
    const currentlyActive = this.active.get(id);
    if (currentlyActive && currentlyActive !== targetVersion) {
      const old = this.records.get(id)!.get(currentlyActive)!;
      old.state = "inactive";
      old.deactivatedAt = Date.now();
    }

    record.state = "active";
    record.activatedAt = Date.now();
    this.active.set(id, targetVersion);
    this.store.writeActiveMap(Object.fromEntries(this.active));
    return record;
  }

  async deactivate(id: string, opts: { force?: boolean } = {}): Promise<void> {
    const version = this.active.get(id);
    if (!version) return; // already inactive
    const dependents = this.activeDependents(id);
    if (dependents.length > 0 && !opts.force) {
      throw new DependencyError(`Cannot deactivate "${id}": required by active extension(s) ${dependents.join(", ")}`);
    }
    const record = this.records.get(id)!.get(version)!;
    record.state = "inactive";
    record.deactivatedAt = Date.now();
    this.active.delete(id);
    this.store.writeActiveMap(Object.fromEntries(this.active));
  }

  async remove(id: string, version: string, opts: { force?: boolean } = {}): Promise<void> {
    const record = this.records.get(id)?.get(version);
    if (!record) return;
    const dependents = this.activeDependents(id);
    if (dependents.length > 0 && !opts.force) {
      throw new DependencyError(`Cannot remove "${id}"@${version}: required by active extension(s) ${dependents.join(", ")}`);
    }
    if (this.active.get(id) === version && !opts.force) {
      throw new Error(`Cannot remove active version "${id}"@${version}; deactivate first or pass force`);
    }
    this.store.remove(id, version);
    this.records.get(id)!.delete(version);
    if (this.active.get(id) === version) {
      this.active.delete(id);
      this.store.writeActiveMap(Object.fromEntries(this.active));
    }
    if (this.records.get(id)!.size === 0) this.records.delete(id);
  }

  // ------------------------------------------------------------------ read

  async loadPayload(id: string, version?: string): Promise<Buffer> {
    const v = version ?? this.latestVersion(id);
    if (!v) throw new Error(`Extension "${id}" is not installed`);
    const record = this.records.get(id)!.get(v)!;
    return this.store.read(id, v, record.encoding);
  }

  async verify(id: string, version: string): Promise<boolean> {
    const record = this.records.get(id)?.get(version);
    if (!record) return false;
    return this.store.verify(id, version, record.encoding);
  }

  getRecord(id: string, version?: string): ExtensionRecord | undefined {
    const v = version ?? this.latestVersion(id);
    return v ? this.records.get(id)?.get(v) : undefined;
  }

  getActiveRecord(id: string): ExtensionRecord | undefined {
    const v = this.active.get(id);
    return v ? this.records.get(id)?.get(v) : undefined;
  }

  installedVersions(id: string): string[] {
    return Array.from(this.records.get(id)?.keys() ?? []);
  }

  latestVersion(id: string): string | undefined {
    const versions = this.installedVersions(id);
    if (versions.length === 0) return undefined;
    return versions.reduce((best, v) => (gt(v, best) ? v : best));
  }

  listExtensions(filter: { kind?: ExtensionKind; state?: ExtensionState } = {}): ExtensionRecord[] {
    const out: ExtensionRecord[] = [];
    for (const byVersion of this.records.values()) {
      for (const record of byVersion.values()) {
        if (filter.kind && record.manifest.kind !== filter.kind) continue;
        if (filter.state && record.state !== filter.state) continue;
        out.push(record);
      }
    }
    return out;
  }
}
