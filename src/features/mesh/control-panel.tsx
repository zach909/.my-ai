/**
 * Prometheus Elastic Core — Control Panel
 *
 * Input injection, mesh controls, neuron inspector, and real-time statistics.
 * The user-facing control surface for driving the mesh.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Play,
  Pause,
  RotateCcw,
  Zap,
  Brain,
  Activity,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { MeshStats, Neuron } from '@/features/mesh/types';

// ─── Stats Panel ────────────────────────────────────────────────────────────

interface StatsRowProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}

function StatsRow({ label, value, icon }: StatsRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

interface StatsDisplayProps {
  stats: MeshStats | null;
  isRunning: boolean;
}

function StatsDisplay({ stats, isRunning }: StatsDisplayProps) {
  if (!stats) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        No data yet — press Play to start the mesh.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <StatsRow label="Ticks" value={stats.tickCount} icon={<Activity className="w-3 h-3" />} />
      <StatsRow label="Active Neurons" value={`${stats.activeNeurons}`} icon={<Zap className="w-3 h-3" />} />
      <StatsRow label="Mean Activation" value={stats.meanActivation.toFixed(4)} />
      <StatsRow label="Mean Vale" value={stats.meanVale.toFixed(1)} />
      <StatsRow label="Vale Entropy" value={stats.valeEntropy.toFixed(4)} />
      <StatsRow label="Last Delta" value={stats.lastMaxDelta === Infinity ? '—' : stats.lastMaxDelta.toExponential(2)} />
      <StatsRow label="Status" value={
        <span className={stats.isSettled ? 'text-emerald-400' : 'text-amber-400'}>
          {stats.isSettled ? 'Settled' : isRunning ? 'Propagating' : 'Paused'}
        </span>
      } />
    </div>
  );
}

// ─── Neuron Inspector ───────────────────────────────────────────────────────

interface NeuronInspectorProps {
  neuron: Neuron | null;
  onClose: () => void;
}

function NeuronInspector({ neuron, onClose }: NeuronInspectorProps) {
  if (!neuron) return null;

  const activation = Math.sqrt(neuron.state.reduce((s, v) => s + v * v, 0));

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            {neuron.label ?? neuron.id}
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            ×
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">ID</span>
          <span className="font-mono">{neuron.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Vale</span>
          <span className="font-mono">{neuron.vale}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Activation</span>
          <span className="font-mono">{activation.toFixed(5)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Input Flag</span>
          <span className="font-mono">{neuron.inputFlag.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-muted-foreground block mb-1">State Vector</span>
          <div className="font-mono bg-muted rounded px-2 py-1 break-all">
            [{neuron.state.map((v) => v.toFixed(4)).join(', ')}]
          </div>
        </div>
        {neuron.definition && (
          <div>
            <span className="text-muted-foreground block mb-1">Definition</span>
            <div className="text-foreground/80 italic">{neuron.definition}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Input Injection ──────────────────────────────────────────────────────

interface InputInjectionProps {
  onInject: (input: number[], strength: number) => void;
  disabled: boolean;
}

function InputInjection({ onInject, disabled }: InputInjectionProps) {
  const [text, setText] = useState('');
  const [strength, setStrength] = useState(0.5);

  const handleInject = useCallback(() => {
    if (!text.trim()) return;
    // Convert text to numeric vector via char codes
    const vector: number[] = [];
    for (let i = 0; i < text.length; i++) {
      vector.push(text.charCodeAt(i) / 128 - 1); // normalize to [-1, 1]
    }
    onInject(vector, strength);
  }, [text, strength, onInject]);

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Inject Input</Label>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleInject()}
        placeholder="Type input to inject..."
        className="h-8 text-xs"
        disabled={disabled}
      />
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">
          Strength: {strength.toFixed(1)}
        </Label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={strength}
          onChange={(e) => setStrength(parseFloat(e.target.value))}
          className="flex-1 h-1 accent-primary"
        />
      </div>
      <Button
        size="sm"
        className="w-full h-7 text-xs"
        onClick={handleInject}
        disabled={disabled || !text.trim()}
        variant="secondary"
      >
        <Zap className="w-3 h-3 mr-1" />
        Inject
      </Button>
    </div>
  );
}

// ─── Control Buttons ────────────────────────────────────────────────────────

interface MeshControlsProps {
  isRunning: boolean;
  onToggle: () => void;
  onReset: () => void;
  onStep: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  disabled: boolean;
}

function MeshControls({
  isRunning,
  onToggle,
  onReset,
  onStep,
  speed,
  onSpeedChange,
  disabled,
}: MeshControlsProps) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="flex-1 h-8 text-xs"
          onClick={onToggle}
          variant={isRunning ? 'default' : 'secondary'}
          disabled={disabled}
        >
          {isRunning ? (
            <><Pause className="w-3 h-3 mr-1" />Pause</>
          ) : (
            <><Play className="w-3 h-3 mr-1" />Play</>
          )}
        </Button>
        <Button
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={onStep}
          variant="outline"
          disabled={disabled || isRunning}
        >
          <Activity className="w-3 h-3" />
        </Button>
        <Button
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={onReset}
          variant="outline"
          disabled={disabled}
        >
          <RotateCcw className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Speed</span>
        <input
          type="range"
          min={1}
          max={10}
          value={speed}
          onChange={(e) => onSpeedChange(parseInt(e.target.value))}
          className="flex-1 h-1 accent-primary"
        />
        <span className="text-xs font-mono tabular-nums w-5">{speed}x</span>
      </div>
    </div>
  );
}

// ─── Learning Controls ──────────────────────────────────────────────────────

interface LearningControlsProps {
  onLearn: () => void;
  disabled: boolean;
}

function LearningControls({ onLearn, disabled }: LearningControlsProps) {
  return (
    <Button
      size="sm"
      className="w-full h-7 text-xs"
      variant="outline"
      onClick={onLearn}
      disabled={disabled}
    >
      <Brain className="w-3 h-3 mr-1" />
      Hebbian Learn
    </Button>
  );
}

// ─── Main Control Panel ─────────────────────────────────────────────────────

interface ControlPanelProps {
  stats: MeshStats | null;
  selectedNeuron: Neuron | null;
  isRunning: boolean;
  speed: number;
  onToggle: () => void;
  onReset: () => void;
  onStep: () => void;
  onSpeedChange: (speed: number) => void;
  onInjectInput: (input: number[], strength: number) => void;
  onLearn: () => void;
  onDeselectNeuron: () => void;
}

export function ControlPanel({
  stats,
  selectedNeuron,
  isRunning,
  speed,
  onToggle,
  onReset,
  onStep,
  onSpeedChange,
  onInjectInput,
  onLearn,
  onDeselectNeuron,
}: ControlPanelProps) {
  return (
    <div className="space-y-3">
      {/* Controls */}
      <Card className="border-border">
        <CardContent className="pt-4 space-y-3">
          <MeshControls
            isRunning={isRunning}
            onToggle={onToggle}
            onReset={onReset}
            onStep={onStep}
            speed={speed}
            onSpeedChange={onSpeedChange}
            disabled={false}
          />
          <div className="border-t border-border pt-3">
            <InputInjection onInject={onInjectInput} disabled={false} />
          </div>
          <div className="border-t border-border pt-3">
            <LearningControls onLearn={onLearn} disabled={false} />
          </div>
        </CardContent>
      </Card>

      {/* Neuron Inspector */}
      <NeuronInspector neuron={selectedNeuron} onClose={onDeselectNeuron} />

      {/* Real-time Stats */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Mesh Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StatsDisplay stats={stats} isRunning={isRunning} />
        </CardContent>
      </Card>
    </div>
  );
}
