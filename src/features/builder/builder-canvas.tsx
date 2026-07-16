/**
 * Extension Builder — visual drag-and-connect canvas.
 *
 * Neurons are draggable cards positioned by the engine's own x/y; dragging
 * writes back through engine.moveNeuron. Connections render as SVG curves
 * with their weight. Connect mode: click a source node, then a target node.
 * Label chips from the palette are HTML5-dragged onto a node, which calls
 * engine.dragLabel — the spec's "drag labels between neurons."
 */

import { useRef, useState, useCallback } from 'react';
import type { NeuronData, ConnectionData, LabelData } from './use-builder';

const NODE_W = 148;
const NODE_H = 56;

const TYPE_COLORS: Record<NeuronData['type'], string> = {
  neuron: 'border-sky-500/60',
  codenet: 'border-amber-500/60',
  netsearch: 'border-violet-500/60',
  output: 'border-emerald-500/60',
};

interface BuilderCanvasProps {
  neurons: NeuronData[];
  connections: ConnectionData[];
  labels: LabelData[];
  selectedId: string | null;
  connectSource: string | null;
  connectMode: boolean;
  searchMatches: Set<string>;
  onSelect: (neuronId: string | null) => void;
  onNodeClick: (neuronId: string) => void;
  onMove: (neuronId: string, x: number, y: number) => void;
  onDropLabel: (neuronId: string, label: string) => void;
  onDeleteConnection: (connectionId: string) => void;
}

export function BuilderCanvas({
  neurons,
  connections,
  labels,
  selectedId,
  connectSource,
  connectMode,
  searchMatches,
  onSelect,
  onNodeClick,
  onMove,
  onDropLabel,
  onDeleteConnection,
}: BuilderCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [, setDragTick] = useState(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, neuron: NeuronData) => {
      if (connectMode) return; // clicks connect, they don't drag
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = {
        id: neuron.id,
        dx: e.clientX - rect.left - neuron.x,
        dy: e.clientY - rect.top - neuron.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [connectMode],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!drag || !rect) return;
      const x = Math.max(0, e.clientX - rect.left - drag.dx);
      const y = Math.max(0, e.clientY - rect.top - drag.dy);
      onMove(drag.id, x, y);
      setDragTick((t) => t + 1);
    },
    [onMove],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const byId = new Map(neurons.map((n) => [n.id, n]));

  return (
    <div
      ref={canvasRef}
      className="relative h-full min-h-[480px] w-full overflow-auto rounded-lg border border-border bg-background/60 [background-image:radial-gradient(circle,hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => onSelect(null)}
      data-testid="builder-canvas"
    >
      {/* connection curves */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {connections.map((c) => {
          const a = byId.get(c.fromId);
          const b = byId.get(c.toId);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W / 2;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x + NODE_W / 2;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          return (
            <g key={c.id}>
              <path
                d={`M ${x1} ${y1} Q ${mx} ${my - 24} ${x2} ${y2}`}
                fill="none"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
                className="stroke-muted-foreground/70"
              />
              <text
                x={mx}
                y={my - 16}
                textAnchor="middle"
                className="pointer-events-auto cursor-pointer select-none fill-muted-foreground text-[10px] hover:fill-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConnection(c.id);
                }}
              >
                w={c.weight.toFixed(2)} ✕
              </text>
            </g>
          );
        })}
      </svg>

      {/* neuron nodes */}
      {neurons.map((n) => {
        const isSelected = n.id === selectedId;
        const isSource = n.id === connectSource;
        const isMatch = searchMatches.has(n.id);
        return (
          <div
            key={n.id}
            role="button"
            tabIndex={0}
            data-neuron-id={n.id}
            className={`absolute cursor-grab select-none rounded-md border-2 bg-card px-2.5 py-1.5 text-xs shadow-sm transition-shadow active:cursor-grabbing ${TYPE_COLORS[n.type]} ${
              isSelected ? 'ring-2 ring-primary' : ''
            } ${isSource ? 'ring-2 ring-amber-400' : ''} ${isMatch ? 'ring-2 ring-emerald-400' : ''}`}
            style={{ left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H }}
            onPointerDown={(e) => handlePointerDown(e, n)}
            onClick={(e) => {
              e.stopPropagation();
              onNodeClick(n.id);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const label = e.dataTransfer.getData('text/neuroclaw-label');
              if (label) onDropLabel(n.id, label);
            }}
          >
            <div className="truncate font-medium text-foreground">{n.name}</div>
            <div className="text-[10px] text-muted-foreground">
              {n.type} · vale {n.value.toFixed(2)}
            </div>
            {n.definition && (
              <div className="mt-0.5 truncate text-[10px] italic text-muted-foreground/80">{n.definition}</div>
            )}
          </div>
        );
      })}

      {/* attached labels (engine dragLabel output) */}
      {labels.map((l) => (
        <span
          key={l.id}
          className="pointer-events-none absolute rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
          style={{ left: l.x, top: l.y }}
        >
          {l.text}
        </span>
      ))}

      {neurons.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Add a neuron to start building — then drag to arrange, and use Connect to wire them.
        </div>
      )}
    </div>
  );
}
