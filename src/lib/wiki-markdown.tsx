import type { ReactNode } from 'react'

/**
 * Dependency-free markdown renderer scoped to exactly what wiki/*.md
 * actually uses (verified against wiki/Home.md, wiki/Builder.md,
 * wiki/Elastic-Value-Budget.md, wiki/NeuroLang.md, ...): headings, bold/
 * italic/inline code, fenced code blocks, pipe tables, bulleted and
 * numbered lists, blockquotes, horizontal rules, ordinary links, and the
 * GitHub-wiki `[[Page]]` / `[[Page|Label]]` link syntax every page here
 * uses to cross-reference the others. No external package — this project
 * has no npm install step in most run environments, and every other
 * substantial piece of parsing in this repo (asi_core/neural_dsl.py,
 * models && skills/core/neuro-lang.ts) is hand-rolled for the same reason.
 *
 * `onWikiLink` is called instead of a real navigation for `[[Page]]`
 * links, so the caller (src/routes/app/wiki.tsx) can switch pages
 * in-app via TanStack Router state instead of a full page reload.
 */

interface RenderOptions {
  onWikiLink: (pageName: string) => void
}

/** Inline spans within one line: **bold**, *italic*, `code`, [text](url), [[Page]] / [[Page|Label]]. */
function renderInline(text: string, opts: RenderOptions, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // One combined regex, alternation order matters: wikilink before plain
  // link (both start with '['), bold before italic (both use '*').
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const key = `${keyPrefix}-${i++}`
    if (m[1] !== undefined) {
      const page = m[1].trim()
      const label = (m[2] ?? m[1]).trim()
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => opts.onWikiLink(page)}
          className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary cursor-pointer"
        >
          {label}
        </button>,
      )
    } else if (m[3] !== undefined) {
      nodes.push(
        <a key={key} href={m[4]} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
          {m[3]}
        </a>,
      )
    } else if (m[5] !== undefined) {
      nodes.push(<strong key={key} className="font-semibold text-foreground">{m[5]}</strong>)
    } else if (m[6] !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{m[6]}</code>,
      )
    } else if (m[7] !== undefined) {
      nodes.push(<em key={key}>{m[7]}</em>)
    }
    last = pattern.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderTable(rows: string[], keyPrefix: string): ReactNode {
  const cellsOf = (line: string) =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  const header = cellsOf(rows[0])
  // rows[1] is the `---|---|---` separator line — skip it.
  const body = rows.slice(2).map(cellsOf)
  return (
    <div key={keyPrefix} className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {header.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-foreground">
                {renderInline(h, { onWikiLink: () => {} }, `${keyPrefix}-h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="border-b border-border last:border-0">
              {row.map((c, ci) => (
                <td key={ci} className="px-3 py-2 align-top text-muted-foreground">
                  {renderInline(c, { onWikiLink: () => {} }, `${keyPrefix}-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function renderWikiMarkdown(source: string, opts: RenderOptions): ReactNode {
  const lines = source.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let listBuffer: { ordered: boolean; text: string }[] = []

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return
    const ordered = listBuffer[0].ordered
    const items = listBuffer.map((item, idx) => (
      <li key={idx}>{renderInline(item.text, opts, `${key}-li${idx}`)}</li>
    ))
    blocks.push(
      ordered ? (
        <ol key={key} className="my-2 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">{items}</ol>
      ) : (
        <ul key={key} className="my-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">{items}</ul>
      ),
    )
    listBuffer = []
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    const key = `b${i}`

    if (trimmed.startsWith('```')) {
      flushList(`${key}-list`)
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing fence
      blocks.push(
        <pre key={key} className="my-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(lines[i + 1].trim())) {
      flushList(`${key}-list`)
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      blocks.push(renderTable(tableLines, key))
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushList(`${key}-list`)
      const level = heading[1].length
      const text = renderInline(heading[2], opts, key)
      const cls =
        level === 1 ? 'mt-6 mb-3 text-2xl font-semibold tracking-tight text-foreground first:mt-0' :
        level === 2 ? 'mt-6 mb-2 text-lg font-semibold text-foreground border-b border-border pb-1' :
        level === 3 ? 'mt-4 mb-2 text-base font-semibold text-foreground' :
        'mt-3 mb-1 text-sm font-semibold text-foreground'
      const Tag = (`h${Math.min(level + 1, 4)}`) as 'h2' | 'h3' | 'h4' | 'h5'
      blocks.push(<Tag key={key} className={cls}>{text}</Tag>)
      i++
      continue
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushList(`${key}-list`)
      blocks.push(<hr key={key} className="my-4 border-border" />)
      i++
      continue
    }

    if (trimmed.startsWith('> ')) {
      flushList(`${key}-list`)
      blocks.push(
        <blockquote key={key} className="my-3 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
          {renderInline(trimmed.slice(2), opts, key)}
        </blockquote>,
      )
      i++
      continue
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    const numbered = trimmed.match(/^\d+\.\s+(.+)$/)
    if (bullet || numbered) {
      listBuffer.push({ ordered: !!numbered, text: (bullet ?? numbered)![1] })
      i++
      continue
    }

    if (!trimmed) {
      flushList(`${key}-list`)
      i++
      continue
    }

    flushList(`${key}-list`)
    blocks.push(
      <p key={key} className="my-2 text-sm leading-relaxed text-muted-foreground">
        {renderInline(line, opts, key)}
      </p>,
    )
    i++
  }
  flushList('tail-list')

  return <>{blocks}</>
}
