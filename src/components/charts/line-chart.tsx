// A small, hand-written line-chart component covering exactly what
// src/routes/app/self-improvement.tsx's four dashboard charts need --
// replaces the `recharts` package. Not a general-purpose charting library:
// a categorical (string) x-axis, one or more numeric line series (with
// gaps for `null` values, optionally bridged via `connectNulls`), an
// optional linear y-axis domain override, a hover tooltip, and a legend.
//
// Mimics recharts' declarative child-component API (<XAxis>, <YAxis>,
// <Tooltip>, <Legend>, <Line>, <CartesianGrid>) closely enough that the
// call sites barely change: those child elements never render anything
// themselves -- <LineChart> walks its own children to read their props as
// configuration, then draws everything itself in one <svg>.

import * as React from "react"
import { cn } from "@/lib/utils"

export interface LineSeriesPoint {
  [key: string]: string | number | null | undefined
}

// ── Config-only child components ────────────────────────────────────────
// Each one is a marker: LineChart reads its props via React.Children, and
// none of them render anything if mounted on their own.

export const CartesianGrid: React.FC<{ strokeDasharray?: string; className?: string }> = () => null

export const XAxis: React.FC<{ dataKey: string; tick?: { fontSize?: number }; minTickGap?: number }> = () => null

export const YAxis: React.FC<{
  tick?: { fontSize?: number }
  domain?: [number, number]
  unit?: string
}> = () => null

export type TooltipFormatter = (value: number, name: string) => [string | number, string]

export const Tooltip: React.FC<{ contentStyle?: React.CSSProperties; formatter?: TooltipFormatter }> = () => null

export const Legend: React.FC<{ wrapperStyle?: React.CSSProperties }> = () => null

export interface LineProps {
  dataKey: string
  name?: string
  stroke: string
  dot?: { r?: number }
  connectNulls?: boolean
  type?: string
}

export const Line: React.FC<LineProps> = () => null

// ── ResponsiveContainer ─────────────────────────────────────────────────

export function ResponsiveContainer({
  width = "100%",
  height = "100%",
  children,
}: {
  width?: string | number
  height?: string | number
  children: React.ReactElement<{ width?: number; height?: number }>
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    >
      {size.width > 0 && size.height > 0 &&
        React.cloneElement(children, { width: size.width, height: size.height })}
    </div>
  )
}

// ── LineChart ────────────────────────────────────────────────────────────

const MARGIN = { top: 8, right: 12, bottom: 24, left: 32 }

function childrenOfType<P>(
  children: React.ReactNode,
  type: React.ComponentType<P>,
): React.ReactElement<P>[] {
  const out: React.ReactElement<P>[] = []
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === type) out.push(child as React.ReactElement<P>)
  })
  return out
}

function childOfType<P>(children: React.ReactNode, type: React.ComponentType<P>): React.ReactElement<P> | undefined {
  return childrenOfType(children, type)[0]
}

export function LineChart({
  data,
  width = 0,
  height = 0,
  children,
}: {
  data: LineSeriesPoint[]
  width?: number
  height?: number
  children: React.ReactNode
}) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)

  const xAxis = childOfType(children, XAxis)
  const yAxis = childOfType(children, YAxis)
  const tooltip = childOfType(children, Tooltip)
  const legend = childOfType(children, Legend)
  const lines = childrenOfType(children, Line)

  const dataKey = xAxis?.props.dataKey ?? "x"
  const unit = yAxis?.props.unit ?? ""

  // The legend renders as an HTML <div> below the <svg> (so its text uses
  // normal document flow, not SVG text metrics), which adds extra height
  // beyond the <svg> itself -- shrink the svg's own height by that amount
  // so (svg + legend) together still fit inside the caller's fixed-height
  // container instead of overflowing it.
  const legendHeight = legend ? 24 : 0
  const svgHeight = Math.max(0, height - legendHeight)
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerHeight = Math.max(0, svgHeight - MARGIN.top - MARGIN.bottom)

  const allValues = data.flatMap((row) =>
    lines.map((line) => row[line.props.dataKey]).filter((v): v is number => typeof v === "number"),
  )
  const [domainMin, domainMax] = yAxis?.props.domain ?? [
    Math.min(0, ...allValues),
    allValues.length ? Math.max(...allValues) : 1,
  ]
  const domainSpan = domainMax - domainMin || 1

  const n = data.length
  const xFor = (i: number) => (n <= 1 ? innerWidth / 2 : (i / (n - 1)) * innerWidth)
  const yFor = (v: number) => innerHeight - ((v - domainMin) / domainSpan) * innerHeight

  const yTicks = 4
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => domainMin + (domainSpan * i) / yTicks)

  // Thin x-axis labels to roughly one per `minTickGap` px (default ~40px)
  // of available width -- an approximation of recharts' own auto-thinning,
  // not a pixel-exact port of it.
  const minTickGap = xAxis?.props.minTickGap ?? 40
  const maxLabels = Math.max(2, Math.floor(innerWidth / Math.max(minTickGap, 1)))
  const labelStride = Math.max(1, Math.ceil(n / maxLabels))

  const fontSize = xAxis?.props.tick?.fontSize ?? 10

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || n === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - MARGIN.left
    const i = Math.round((x / innerWidth) * (n - 1))
    setHoverIndex(Math.max(0, Math.min(n - 1, i)))
  }

  if (width === 0 || height === 0) return null

  const hoverRow = hoverIndex !== null ? data[hoverIndex] : null

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={svgHeight}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* CartesianGrid: horizontal gridlines at each y tick */}
          {yTickValues.map((v, i) => (
            <line
              key={i}
              x1={0}
              x2={innerWidth}
              y1={yFor(v)}
              y2={yFor(v)}
              className="stroke-border"
              strokeDasharray="3 3"
            />
          ))}

          {/* Y axis labels */}
          {yTickValues.map((v, i) => (
            <text key={i} x={-6} y={yFor(v)} textAnchor="end" dominantBaseline="middle" fontSize={fontSize} className="fill-muted-foreground">
              {Math.round(v * 10) / 10}
              {unit}
            </text>
          ))}

          {/* X axis labels */}
          {data.map((row, i) =>
            i % labelStride === 0 ? (
              <text
                key={i}
                x={xFor(i)}
                y={innerHeight + 14}
                textAnchor="middle"
                fontSize={fontSize}
                className="fill-muted-foreground"
              >
                {String(row[dataKey] ?? "")}
              </text>
            ) : null,
          )}

          {/* One polyline (broken across nulls unless connectNulls) + dots per line series */}
          {lines.map((line) => {
            const { dataKey: key, stroke, dot, connectNulls } = line.props
            const points: Array<[number, number]> = []
            const segments: Array<Array<[number, number]>> = []
            let current: Array<[number, number]> = []
            data.forEach((row, i) => {
              const v = row[key]
              if (typeof v === "number") {
                const point: [number, number] = [xFor(i), yFor(v)]
                points.push(point)
                current.push(point)
              } else if (!connectNulls) {
                if (current.length) segments.push(current)
                current = []
              }
            })
            if (current.length) segments.push(current)
            const toDraw = connectNulls ? [points] : segments
            return (
              <g key={key}>
                {toDraw.map((seg, si) => (
                  <polyline
                    key={si}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.5}
                    points={seg.map(([x, y]) => `${x},${y}`).join(" ")}
                  />
                ))}
                {points.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={dot?.r ?? 2} fill={stroke} />
                ))}
              </g>
            )
          })}

          {/* Hover crosshair */}
          {hoverIndex !== null && (
            <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={0} y2={innerHeight} className="stroke-border" />
          )}
        </g>
      </svg>

      {legend && (
        <div
          className="flex flex-wrap justify-center gap-3 pt-1"
          style={{ fontSize: legend.props.wrapperStyle?.fontSize ?? 11 }}
        >
          {lines.map((line) => (
            <div key={line.props.dataKey} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: line.props.stroke }} />
              <span className="text-muted-foreground">{line.props.name ?? line.props.dataKey}</span>
            </div>
          ))}
        </div>
      )}

      {hoverRow && (
        <div
          className={cn(
            "pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2 py-1.5 text-popover-foreground shadow-md",
          )}
          style={{
            fontSize: tooltip?.props.contentStyle?.fontSize ?? 12,
            left: Math.min(MARGIN.left + xFor(hoverIndex!) + 8, width - 140),
            top: MARGIN.top,
          }}
        >
          <div className="mb-0.5 font-medium">{String(hoverRow[dataKey] ?? "")}</div>
          {lines.map((line) => {
            const raw = hoverRow[line.props.dataKey]
            if (typeof raw !== "number") return null
            const name = line.props.name ?? line.props.dataKey
            const [displayValue, displayName] = tooltip?.props.formatter
              ? tooltip.props.formatter(raw, name)
              : [raw, name]
            return (
              <div key={line.props.dataKey} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: line.props.stroke }} />
                <span>
                  {displayName}: {displayValue}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
