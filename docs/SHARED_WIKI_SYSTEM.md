# Shared Wiki System — Design

## Overview

The Shared Wiki is a living documentation layer for the system: the AI continuously
researches the codebase (and, where permitted, external sources), and keeps a
structured, cross-linked, versioned, citeable knowledge base up to date without a
human manually maintaining it. It sits alongside the existing static `wiki/` and
`docs/` folders but is backed by a real store, an indexer, a knowledge graph, and
an API, rather than being a pile of hand-edited Markdown.

Design goals:

- **Always current** — pages are regenerated/patched automatically as source code,
  configs, and conversations change, not just when a human remembers to write docs.
- **Verifiable** — every generated claim carries a citation back to the artifact
  (file, commit, external URL) that supports it.
- **Navigable** — pages are connected through an explicit link graph and a
  queryable knowledge graph, not just prose.
- **Auditable** — every change is versioned, diffable, and attributable to either
  a human edit or a specific AI research pass.
- **Local-first** — consistent with the rest of this project's "no external APIs
  required, everything works offline" principle; network research is an optional,
  explicitly-scoped add-on.

---

## 1. Architecture

### 1.1 High-level components

```
                    ┌─────────────────────────┐
                    │   Research Scheduler     │  (cron / event-driven)
                    │  - watches file changes  │
                    │  - watches git commits   │
                    │  - watches chat sessions │
                    └───────────┬─────────────┘
                                │ triggers
                                ▼
┌───────────────┐      ┌──────────────────┐      ┌────────────────────┐
│  Source Crawlers│───▶ │  Fact Extractor   │───▶ │   Draft Composer    │
│ (code, git log, │     │ (symbols, configs,│     │ (LLM: writes/edits  │
│  configs, chats, │     │  diffs, external  │     │  a wiki page from   │
│  optional web)   │     │  fetched docs)    │     │  extracted facts)   │
└───────────────┘      └──────────────────┘      └─────────┬──────────┘
                                                             │
                                                             ▼
                                                   ┌────────────────────┐
                                                   │  Citation Binder    │
                                                   │ (attaches source    │
                                                   │  refs to claims)    │
                                                   └─────────┬──────────┘
                                                             │
                                                             ▼
┌───────────────┐      ┌──────────────────┐      ┌────────────────────┐
│  Link Resolver │◀───▶│  Diff & Review    │◀────│   Page Store        │
│ (wiki-links,    │     │ (auto-merge low-  │     │ (Markdown + front-  │
│  backlinks)      │     │  risk, flag high- │     │  matter + version   │
└───────────────┘      │  risk changes)     │     │  history)           │
                        └──────────────────┘      └─────────┬──────────┘
                                                             │
                    ┌────────────────────────────────────────┼─────────────┐
                    ▼                        ▼                              ▼
          ┌──────────────────┐   ┌────────────────────┐        ┌──────────────────┐
          │  Knowledge Graph   │   │   Search Index      │        │      API layer    │
          │  (entities/edges)  │   │  (full-text + vec)  │        │ (REST/GraphQL/MCP)│
          └──────────────────┘   └────────────────────┘        └──────────────────┘
```

### 1.2 Placement in this repo

- `src/server/wiki/` — backend service (scheduler, crawlers, extractor, composer,
  citation binder, link resolver, graph, search, API routes). Runs as part of the
  existing `src/server` process (same one that serves the desktop-app / interface
  backend), so it shares auth, config, and process lifecycle with the rest of the
  system rather than being a separate service.
- `src/features/wiki/` — frontend: page viewer/editor, graph explorer, search UI,
  version-history/diff UI. Follows the same feature-module convention as
  `src/features/builder` and `src/features/mesh`.
- `wiki-data/` (new, gitignored except for a seed) — the actual store: SQLite DB +
  a content-addressed blob directory for page snapshots. The existing `wiki/*.md`
  files become the **seed content** imported on first run; after that, `wiki/*.md`
  is a generated read-only export for GitHub's native wiki renderer, not the
  source of truth.

### 1.3 Process model

- The scheduler runs as a background loop inside `src/server` (analogous to the
  RLM/mesh background tick loop already in the system) — it is a *subsystem*, not
  a cron job external to the app, so it can react to in-memory events (e.g. "MoE
  router config changed") in addition to filesystem/git polling.
- All AI calls (extraction, drafting, citation binding) go through the same
  MoE/skill routing used elsewhere in the system — "wiki research" and "wiki
  writer" are registered as Skills (see `wiki/Skills.md` convention), so they're
  swappable/upgradable like any other expert.
- Everything the scheduler does is queued through a single-writer job queue
  (`WikiJobQueue`) so concurrent edits (human + AI) can't race on the same page.

---

## 2. Automatic Documentation

### 2.1 Triggers

| Trigger | Source | Action |
|---|---|---|
| File save / commit | git post-commit hook + fs watcher | Re-extract facts for changed files, patch affected pages |
| New skill/plugin registered | Plugin/skill manager event | Generate a new page from a template |
| Chat session ends | Session lifecycle event | Extract decisions/Q&A worth documenting, propose a page diff |
| Scheduled sweep | Cron (default: nightly) | Re-crawl everything, catch drift the event triggers missed |
| Manual "research this" request | User/API call | One-off deep dive, same pipeline, higher time budget |

### 2.2 Pipeline stages

1. **Crawl** — gather raw material: changed file contents, `git log -p` for the
   diff, config files, existing page content, and (only if the user has enabled
   the optional "web research" scope) external fetches via the same `WebFetch`
   tool used interactively, with domain allow-listing.
2. **Extract** — turn raw material into typed **facts**: `{subject, predicate,
   object, sourceRef, confidence}`. E.g. `{"MoE Router", "defaultK", "2",
   src/server/wiki/facts.md ref to models && skills/core/moe-router.ts:41, 0.95}`.
   Extraction uses static analysis where possible (parse exported symbols,
   config schemas, route tables) and falls back to LLM summarization for
   prose/intent facts that can't be parsed mechanically.
3. **Compose** — an LLM drafts or patches the target page's Markdown from the
   fact set, preserving any section marked `<!-- human-authored -->` verbatim
   (never overwritten automatically).
4. **Cite** — the Citation Binder walks the draft and attaches a citation marker
   to every sentence derived from a fact, linking back to `sourceRef`.
5. **Risk-score & route** — a diff is scored low/medium/high risk (see §4.3) and
   either auto-committed, queued for review, or dropped with a logged reason.

### 2.3 Human-authored vs. AI-authored content

Every page has YAML front-matter marking provenance per-section:

```yaml
---
title: Mixture of Experts (MoE) Router
maintainers: [human]
sections:
  overview: ai-generated
  design-rationale: human-authored
  api: ai-generated
---
```

`human-authored` sections are never touched by the composer; they can only be
edited by an explicit human commit through the normal edit path. This prevents
the classic failure mode of auto-doc systems silently clobbering hand-tuned
prose.

---

## 3. Linking

### 3.1 Link types

- **Wiki-links**: `[[Page Name]]` / `[[Page Name|display text]]`, same syntax
  the existing `wiki/*.md` files already use (e.g. `wiki/Architecture.md`'s
  `See also:` line). Resolved at render time against the page-title index.
- **Anchor links**: `[[Page Name#Section]]` resolves to a heading slug.
- **Source links**: `[[src:path/to/file.ts:42]]` — a special link class that
  jumps straight to a line in the actual source tree (rendered as a clickable
  link in the frontend, ignored/flattened in the GitHub-wiki export).
- **Entity links**: auto-inserted by the Link Resolver when composing a page —
  if a drafted sentence mentions a known entity (another page's title, a
  registered skill/plugin name, a config key), the resolver rewrites the plain
  text mention into a `[[...]]` link automatically.

### 3.2 Link Resolver

- Maintains a `title -> pageId` and `alias -> pageId` map (aliases come from
  front-matter `aliases: [...]`).
- Runs a **backlink index**: for every page, the set of pages that link to it.
  Rendered as a "Referenced by" footer on each page, mirroring the "See also"
  convention already used.
- Detects **broken links** (target doesn't exist) and **orphan pages** (no
  inbound links) as part of the nightly sweep; both surface as wiki-health
  findings (§ testing/observability) rather than failing silently.
- Detects **redirects**: renaming a page leaves a redirect stub so old links
  and external bookmarks keep resolving.

### 3.3 Relationship to the Knowledge Graph

Links are the *document-level* graph (page → page). The Knowledge Graph (§6) is
finer-grained (entity → entity, e.g. `Skill --registeredAs--> Expert`). The Link
Resolver and Knowledge Graph share the same entity-resolution table so a page
about "MoE Router" and the graph node `Component:MoERouter` are the same
identity, just viewed at different granularity.

---

## 4. Version History

### 4.1 Model

Every page is a sequence of immutable **revisions**:

```
Revision {
  id: uuid
  pageId
  parentRevisionId | null
  author: "ai:wiki-writer" | "human:<user>"
  triggerJobId          // links back to the automation job that produced it, if AI
  timestamp
  contentHash           // sha256 of full rendered Markdown
  contentBlobRef         // pointer into content-addressed blob store
  diffSummary            // machine-generated summary of what changed and why
  citations[]             // snapshot of citation set at this revision
  riskScore               // low | medium | high (see 4.3)
  status: "committed" | "pending-review" | "rejected"
}
```

Storage: content blobs are stored once (content-addressed, deduplicated) and
revisions reference them, so the DB stays small even with frequent AI passes
that produce byte-identical output (no-op re-crawls cost only a row, not a blob).

### 4.2 Operations

- **Diff**: standard line-level Markdown diff between any two revisions,
  rendered in the frontend with citation/section provenance annotated per
  hunk (so a reviewer can see "this hunk is AI-authored, sourced from commit
  abc123").
- **Revert**: creates a new revision whose content equals a prior revision's
  content (never destructively rewrites history).
- **Merge conflict handling**: since AI and humans can both edit, a
  three-way merge is attempted (base = common ancestor revision, ours =
  human edit, theirs = AI draft); on structural conflict, the AI draft is
  demoted to `pending-review` rather than force-applied.

### 4.3 Auto-commit risk gating

| Risk | Criteria | Action |
|---|---|---|
| Low | Only `ai-generated` sections touched, all claims cited, no human-authored section altered, diff < N lines | Auto-commit |
| Medium | Larger diff, or a section boundary is ambiguous | Queue for async human approval (surfaced via API/notification); auto-applied after a configurable timeout if unreviewed |
| High | Touches `human-authored` marked section, or contradicts an existing high-confidence fact | Blocked; requires explicit human approval |

### 4.4 Retention

- Full revision history kept indefinitely by default (cheap: text + dedup
  blobs). Optional compaction policy can squash AI-only "no functional diff"
  revisions older than N days into a single tombstone revision, configurable
  per-space.

---

## 5. Citations

### 5.1 Citation model

```
Citation {
  id
  claimSpan: { revisionId, startOffset, endOffset }   // exact text cited
  sourceType: "file" | "commit" | "external_url" | "conversation" | "graph_fact"
  sourceRef: string        // path:line-range, commit SHA, URL, session id, fact id
  fetchedAt / retrievedAt
  snapshotRef?             // for external URLs: an archived copy (see 5.3)
  confidence: 0..1
}
```

Rendered inline as footnote-style markers (`... routes to top-K experts.[^1]`)
with a references section per page, and also available via the API as
structured data (so the frontend can highlight "everything sourced from file
X" when that file is opened).

### 5.2 Enforcement

- The Citation Binder runs as a **required** pipeline stage, not optional: the
  Draft Composer is prompted to emit inline citation placeholders per claim,
  and any sentence that reaches the Diff & Review stage without a resolvable
  citation is either (a) auto-tagged `unverified-claim` and excluded from
  low-risk auto-commit, or (b) stripped, depending on the space's policy.
- Internal citations (file/commit) are validated automatically — the binder
  checks the referenced file/line still exists at binding time; broken
  internal citations block auto-commit.
- External citations require the source to have been fetched during *this*
  research pass (no citing-from-memory) and are only allowed at all in spaces
  where web research is explicitly enabled.

### 5.3 External source snapshots

For `external_url` citations, the fetched content is archived (rendered
text, not full binary) alongside the citation so the citation remains
checkable even if the source page later changes or disappears. This mirrors
Wikipedia's "archive.org snapshot" pattern.

---

## 6. Knowledge Graph

### 6.1 Schema

Property graph, stored relationally (see §9) but exposed as a graph API.

- **Node** = `{ id, type, name, aliases[], properties{}, pageId? }`
  - Types: `Component`, `Skill`, `Plugin`, `ConfigKey`, `Concept`, `Person`,
    `ExternalSource`, `Decision`.
- **Edge** = `{ id, from, to, type, sourceCitationIds[], confidence }`
  - Types: `dependsOn`, `implements`, `documents`, `supersedes`,
    `mentionedIn`, `contradicts`, `partOf`.

### 6.2 Population

- Structural edges (`dependsOn`, `partOf`) come from the static-analysis
  extractor (import graphs, plugin registration calls, config references) —
  high confidence, no LLM involved.
- Semantic edges (`implements`, `contradicts`, `supersedes`) are proposed by
  the LLM extraction stage and stored with the LLM's confidence score;
  `contradicts` edges are the mechanism that flags stale docs (see 6.4).

### 6.3 Uses

- **Backlinks-on-steroids**: "show me everything that depends on the MoE
  Router" is a graph traversal, not a text search.
- **Change-impact analysis**: when a source file changes, walk `documents`
  and `dependsOn` edges to find every page that might now be stale — this is
  what actually drives which pages the automatic-documentation pipeline
  re-visits, rather than a blind full re-crawl every time.
- **Contradiction detection**: if a new extracted fact conflicts with an
  existing edge/fact (e.g. default value changed but no page mentions it),
  a `contradicts` edge is created and surfaced as a wiki-health finding.

### 6.4 Staleness scoring

Each page gets a computed `stalenessScore` = f(time since last verified,
number of unresolved `contradicts` edges touching it, number of changed
source files it cites that haven't been re-crawled). Surfaced in the API and
UI as a sortable "needs attention" list — this is the main lever for the
"continuously" part of "continuously researches and updates."

---

## 7. Searching

### 7.1 Index types

- **Full-text (BM25/FTS)**: SQLite FTS5 virtual table over page content,
  headings weighted higher than body text. Zero external dependency,
  consistent with the project's local-first stance.
- **Vector/semantic**: embeddings per section (not just per page) stored in
  a local vector index (e.g. sqlite-vec or an in-process HNSW), enabling
  "find pages about X" even without exact keyword overlap. Embeddings are
  regenerated incrementally on section change, not full reindex.
- **Graph search**: structured queries against the Knowledge Graph (e.g.
  "pages documenting components that depend on the mesh engine").

### 7.2 Query flow

1. Parse query → detect if it's a structured graph query (`type:Skill
   dependsOn:MeshEngine`), a keyword query, or natural language.
2. Natural language and keyword queries run through both FTS and vector
   search; results are merged with reciprocal-rank fusion.
3. Results are re-ranked using signals beyond text relevance: recency,
   staleness score (penalize stale matches), and link-graph centrality
   (pages with more backlinks rank slightly higher, à la PageRank-lite).
4. Structured queries hit the graph store directly.

### 7.3 Surfaces

- In-app search bar (frontend `src/features/wiki`), returning snippet +
  citation preview.
- API endpoint (`GET /wiki/search`) for programmatic use, including by the
  AI itself when deciding whether a fact is already documented before
  drafting a new page (avoids duplicate pages).

---

## 8. APIs

Exposed from `src/server/wiki/api/`, following the same REST conventions as
the rest of `src/server`, plus an MCP-compatible tool surface so the AI's own
tool-calling loop can read/write the wiki like any other tool.

### 8.1 REST

```
GET    /wiki/pages                     list/search pages (q, tag, staleness, space)
GET    /wiki/pages/:id                 current revision, rendered + raw
GET    /wiki/pages/:id/revisions       version history
GET    /wiki/pages/:id/revisions/:rev  a specific revision
GET    /wiki/pages/:id/diff?from=&to=  diff between two revisions
POST   /wiki/pages                     create page (human or AI job)
PATCH  /wiki/pages/:id                 propose an edit (goes through risk gating)
POST   /wiki/pages/:id/revert          revert to a prior revision
GET    /wiki/pages/:id/backlinks        inbound links
GET    /wiki/search?q=&mode=fts|vector|graph
GET    /wiki/graph/nodes/:id            node + edges
POST   /wiki/graph/query                structured graph query (small DSL)
GET    /wiki/citations/:id              citation detail incl. archived snapshot
GET    /wiki/jobs                        automation job queue/status
POST   /wiki/jobs/:id/approve|reject     act on a pending-review job
GET    /wiki/health                      staleness list, broken links, orphans, contradictions
```

All mutating endpoints require the same auth/session context as the rest of
`src/server`; AI-originated writes are authenticated as a service principal
(`ai:wiki-writer`) so they're distinguishable from human writes in audit logs.

### 8.2 MCP / tool-call surface

The wiki is registered as a Skill/tool set (consistent with `wiki/Skills.md`)
exposing: `wiki_search`, `wiki_get_page`, `wiki_propose_edit`,
`wiki_get_graph_neighbors`. This lets the AI consult and extend the wiki as
part of ordinary reasoning (e.g. "check the wiki before answering, then
propose an update if the answer required info not yet documented").

### 8.3 Webhooks/events

`page.updated`, `job.pending_review`, `contradiction.detected` — emitted on
the existing internal event bus so the desktop-app UI can badge/notify
without polling.

---

## 9. Storage

### 9.1 Engine choice

SQLite (via the same driver already used elsewhere in `src/server`, if any;
otherwise `better-sqlite3`), for the same reason the rest of this project
favors local-first, zero-external-service components: it's a single file,
requires no daemon, and is trivially backed up/synced. Reassess to Postgres
only if/when the system needs true multi-writer concurrent access across
machines (out of scope for v1 — the job queue's single-writer model makes
SQLite's write-serialization a non-issue).

### 9.2 Schema (logical)

```
pages(id, title, slug, space, created_at, current_revision_id)
revisions(id, page_id, parent_id, author, trigger_job_id, timestamp,
          content_hash, content_blob_ref, diff_summary, risk_score, status)
blobs(hash PRIMARY KEY, content, compressed)          -- content-addressed
citations(id, revision_id, span_start, span_end, source_type, source_ref,
          snapshot_ref, confidence)
links(from_page_id, to_page_id, link_type, revision_id)  -- versioned edges
graph_nodes(id, type, name, properties_json, page_id NULL)
graph_edges(id, from_node, to_node, type, confidence)
graph_edge_citations(edge_id, citation_id)
jobs(id, trigger, status, started_at, finished_at, produced_revision_id)
fts_index (virtual table over revisions.content_blob_ref, current only)
vectors(section_id, revision_id, embedding BLOB, model_version)
```

### 9.3 Blob storage

Content blobs are stored compressed (reusing the project's existing Zip I/O
conventions where applicable) and deduplicated by hash — an AI re-crawl that
produces identical content costs one `revisions` row pointing at an existing
blob, not a new blob.

### 9.4 Backups & portability

- Entire store is one SQLite file + a blob directory → trivially copyable.
- A `wiki export` job renders current revisions back out to plain
  `wiki/*.md` files (preserving `[[links]]`) so the GitHub-native wiki
  mirror and any human who prefers grepping flat files stay in sync as a
  read-only projection.
- A `wiki import` job seeds/re-seeds the store from a flat Markdown
  directory (used for first-run bootstrap from the existing `wiki/` folder).

### 9.5 Multi-space support

Pages belong to a `space` (e.g. `engineering`, `product`, `research`) so
access control, staleness policy, and auto-commit risk thresholds can be
configured per space — e.g. `research` space allows external web citations,
`engineering` space does not.

---

## 10. Testing

### 10.1 Unit tests (`test/wiki/*`, mirroring existing `test/`/`tests/` layout)

- **Extractor**: given a fixed source diff, asserts the exact fact set
  produced (deterministic, no LLM in these tests — static-analysis paths
  only).
- **Link resolver**: alias resolution, redirect handling, broken-link
  detection, backlink index correctness.
- **Version history**: revision chain integrity, diff correctness, revert
  produces expected content, blob deduplication.
- **Citation binder**: rejects claims with unresolved refs per policy;
  validates internal citation liveness against a fixture file tree.
- **Risk gating**: table-driven tests over the low/medium/high matrix in §4.3.
- **Storage**: schema migrations round-trip; content-addressed dedup;
  export/import round-trip (`wiki export` then `wiki import` reproduces
  identical current-revision content).

### 10.2 Integration tests (`vitest run`, alongside existing `test:integration`)

- End-to-end pipeline: seed a fake source-file change → run scheduler tick →
  assert a low-risk revision was auto-committed with correct citations and
  updated graph edges.
- API contract tests for every endpoint in §8.1 (status codes, pagination,
  auth boundaries between human and `ai:wiki-writer` principals).
- Search relevance smoke tests: fixed corpus + fixed queries, assert
  expected page appears in top-K for both FTS and vector modes.
- Merge-conflict scenario: simulate concurrent human edit + AI draft on the
  same page, assert three-way merge or correct demotion to
  `pending-review`.

### 10.3 LLM-in-the-loop evaluation (non-blocking, scheduled)

Because the composer/extractor semantic stages are LLM-driven and not fully
deterministic, they're covered by an offline **eval harness** (not part of
`npm test`, run on a schedule/CI job similar to `benchmarks/`):

- A fixed set of "golden" source snapshots with hand-authored expected wiki
  output; scored on citation coverage (% claims cited), factual accuracy
  (spot-checked claims against source), and human-authored-section
  preservation (must be byte-identical — a hard pass/fail, not scored).
- Regression gate: a new model/prompt version for the wiki-writer skill must
  not reduce citation coverage or violate section-preservation on the golden
  set before it can be promoted.

### 10.4 Observability / health checks

`GET /wiki/health` (§8.1) doubles as a continuous test-in-production signal:
broken links, orphan pages, unresolved contradictions, and stale-score
outliers are all things a periodic CI-style job asserts are below a
threshold, alerting (via the existing event bus) if the wiki's own
self-maintenance is falling behind.

---

## Summary

| Subsystem | Core mechanism |
|---|---|
| Architecture | Scheduler → crawlers → extractor → composer → citation binder → store, mirrored in `src/server/wiki` + `src/features/wiki` |
| Automatic documentation | Event/cron-triggered pipeline; human-authored sections protected via front-matter provenance |
| Linking | `[[wiki-links]]`, source links, auto-inserted entity links, backlink index, redirects |
| Version history | Immutable revisions over content-addressed blobs; diff/revert/three-way merge; risk-gated auto-commit |
| Citations | Per-claim citation spans, mandatory binding, internal-ref liveness checks, external snapshot archiving |
| Knowledge graph | Typed node/edge property graph, structural + semantic edges, drives staleness scoring and change-impact re-crawls |
| Searching | Local FTS5 + vector + graph search, fused ranking with recency/staleness/centrality |
| APIs | REST + MCP tool surface + event bus, all AI writes attributed to a distinct service principal |
| Storage | SQLite + content-addressed blobs, per-space policy, export/import to flat Markdown |
| Testing | Deterministic unit tests for mechanical stages, integration tests for the pipeline/API, offline eval harness with a promotion gate for the LLM stages, continuous health checks in production |
