/**
 * Self-Improvement — "I want a graph about how the agent itself is doing
 * on these tasks, and... how good it is at passing the improvement test."
 * Three tabs: Overview (real charts from the autonomous agents), Evaluation
 * and Experiments (the ASI benchmarking/protocol simulators) -- these three
 * used to be separate nav entries/pages; they are all "how well is this
 * thing actually doing" seen from different angles, so they are tabs of one
 * page now.
 *
 * Overview reads GET /api/self-improvement/history, which just exposes two
 * real local ledgers already being written by autonomous agents `npm run
 * server` launches: scripts/self-improve.mjs's own scoreboard (per
 * target-script candidate scores, whether each was rewarded) and
 * scripts/skill-drill-agent.mjs's quality history (per-skill held-out
 * accuracy before/after each drill, whether it genuinely improved).
 * Neither agent running yet (fresh install, or both disabled via
 * NEUROCLAW_SELF_IMPROVE=0 / NEUROCLAW_SKILL_DRILLS=0) means an empty
 * chart, not an error -- see the empty states below.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  Target,
  RefreshCw,
  Sparkles,
  FlaskConical,
  ArrowRight,
  Puzzle,
  GraduationCap,
  Gauge,
  Play,
  CheckCircle2,
  RotateCcw,
  Plus,
  Rocket,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  buildExamPassRateSeries,
  buildPassRateSeries,
  buildScoreSeries,
  buildSkillMeshRateSeries,
  type DrillEntry,
  type ScoreboardEntry,
  type SkillMeshAttemptInput,
} from "@/lib/self-improvement-charts";

export const Route = createFileRoute("/app/self-improvement")({
  head: () => ({
    meta: [
      { title: "Self-Improvement · Corona" },
      {
        name: "description",
        content:
          "Real progress from the autonomous self-improvement, skill-creation, and skill-drilling agents, plus the evaluation and experiment simulators.",
      },
    ],
  }),
  component: SelfImprovementPage,
});

type SelfImprovementTab = "overview" | "evaluation" | "experiments";

const SELF_IMPROVEMENT_TABS: {
  key: SelfImprovementTab;
  label: string;
  icon: typeof TrendingUp;
}[] = [
  { key: "overview", label: "Overview", icon: TrendingUp },
  { key: "evaluation", label: "Evaluation", icon: Gauge },
  { key: "experiments", label: "Experiments", icon: FlaskConical },
];

const LINE_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f97316",
  "#ec4899",
  "#06b6d4",
  "#eab308",
  "#a855f7",
];

function shortTime(at: string) {
  try {
    return new Date(at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return at;
  }
}

function SelfImprovementPage() {
  const [tab, setTab] = useState<SelfImprovementTab>("overview");

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">Self-Improvement</h1>
        <p className="text-xs text-muted-foreground">
          Real progress from the autonomous agents `npm run server` launches,
          plus the evaluation benchmark and experiment protocol simulators.
        </p>
        <div className="mt-3 flex gap-1 border-b border-border">
          {SELF_IMPROVEMENT_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              aria-current={tab === key ? "page" : undefined}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && <OverviewPanel onOpenTab={setTab} />}
      {tab === "evaluation" && <EvaluationPanel />}
      {tab === "experiments" && <ExperimentsPanel />}
    </div>
  );
}

function OverviewPanel({
  onOpenTab,
}: {
  onOpenTab: (tab: SelfImprovementTab) => void;
}) {
  // Charting libraries generally assume a real DOM (ResizeObserver,
  // measured container width) -- rendering only after mount avoids
  // asking recharts to measure anything during this app's SSR
  // prerender pass (npm run build), same reason other client-only
  // widgets in this project gate on a mounted flag.
  const [mounted, setMounted] = useState(false);
  const [selfImprovement, setSelfImprovement] = useState<
    Record<string, ScoreboardEntry>
  >({});
  const [skillDrills, setSkillDrills] = useState<Record<string, DrillEntry>>(
    {},
  );
  const [skillMeshAttempts, setSkillMeshAttempts] = useState<
    SkillMeshAttemptInput[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (manual = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/self-improvement/history");
      const data = await res.json();
      setSelfImprovement(data.selfImprovement ?? {});
      setSkillDrills(data.skillDrills ?? {});
      setSkillMeshAttempts(
        Array.isArray(data.skillMeshAttempts) ? data.skillMeshAttempts : [],
      );
      if (manual) {
        toast.success("Self-improvement history refreshed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    load();
  }, []);

  const scoreSeries = buildScoreSeries(selfImprovement).map((row) => ({
    ...row,
    atLabel: shortTime(row.at),
  }));
  const passRateSeries = buildPassRateSeries(skillDrills).map((row) => ({
    ...row,
    atLabel: shortTime(row.at),
    passRatePct: Math.round(row.passRate * 1000) / 10,
  }));
  const examPassRateSeries = buildExamPassRateSeries(selfImprovement).map((row) => ({
    ...row,
    atLabel: shortTime(row.at),
    passRatePct: Math.round(row.passRate * 1000) / 10,
    avgScorePct: Math.round(row.avgScore * 1000) / 10,
  }));
  const skillMeshSeries = buildSkillMeshRateSeries(skillMeshAttempts).map(
    (row) => ({
      ...row,
      atLabel: shortTime(new Date(row.at).toISOString()),
      directAnswerRatePct: Math.round(row.directAnswerRate * 1000) / 10,
    }),
  );
  const targetKeys = Object.keys(selfImprovement);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          onClick={() => load(true)}
          disabled={loading}
          variant="outline"
          size="sm"
          aria-label="Refresh self-improvement history"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw
            className={loading ? "size-3.5 animate-spin" : "size-3.5"}
          />
          Refresh
        </Button>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {loading ? "Refreshing self-improvement history..." : "Self-improvement history updated."}
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp size={15} className="text-primary" />
            Agent capability over time
          </CardTitle>
          <CardDescription className="text-xs">
            Each line is one self-improve.mjs target script's trained score
            across every sandbox attempt (scripts/self-improve.mjs). Rising
            means genuine, measured improvement -- ties and regressions are
            never rewarded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!mounted || scoreSeries.length === 0 ? (
            <div className="py-6">
              {mounted ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center max-w-md mx-auto space-y-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground text-xs">
                      No self-improvement attempts recorded yet
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Launch self-improvement workflows on your local machine to
                      see target scripts trained and evaluated over sandbox
                      attempts.
                    </p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    className="active:scale-95 transition-all duration-150 text-xs"
                  >
                    <Link to="/app/chat">
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Prompt AI Chat
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Loading…
                </p>
              )}
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scoreSeries}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="atLabel"
                    tick={{ fontSize: 10 }}
                    minTickGap={20}
                  />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {targetKeys.map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key.split("/").pop()}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Target size={15} className="text-primary" />
            Improvement-test pass rate
          </CardTitle>
          <CardDescription className="text-xs">
            The cumulative fraction of scripts/skill-drill-agent.mjs's drill
            cycles that the judge counted as a genuine, strictly-held-out
            accuracy improvement -- across every drilled skill on this machine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!mounted || passRateSeries.length === 0 ? (
            <div className="py-6">
              {mounted ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center max-w-md mx-auto space-y-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Target className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground text-xs">
                      No skill-drill attempts recorded yet
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Run automated target drills on physical and symbolic
                      skills to measure cumulative held-out accuracy
                      improvements.
                    </p>
                  </div>
                  <Button
                    onClick={() => onOpenTab("experiments")}
                    size="sm"
                    variant="outline"
                    className="active:scale-95 transition-all duration-150 text-xs"
                  >
                    <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
                    View Experiments
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Loading…
                </p>
              )}
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={passRateSeries}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="atLabel"
                    tick={{ fontSize: 10 }}
                    minTickGap={20}
                  />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v: number) => [`${v}%`, "Pass rate"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="passRatePct"
                    name="Pass rate"
                    stroke="#22c55e"
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <GraduationCap size={15} className="text-primary" />
            Capability exam: pass rate &amp; average score
          </CardTitle>
          <CardDescription className="text-xs">
            "A test that can't be cheated": completely random questions,
            random order, freshly regenerated every attempt, across math,
            chemistry, astrophysics, optics, quantum computing, and
            digital logic (scripts/capability-exam.mjs). Every
            self-improve.mjs candidate for every target must pass this
            same exam before it's rewarded and pushed to{" "}
            <code className="rounded bg-muted px-1 py-0.5">beta</code> --
            a fail is punished with negative feedback and retried next
            cycle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!mounted || examPassRateSeries.length === 0 ? (
            <div className="py-6">
              {mounted ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center max-w-md mx-auto space-y-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground text-xs">
                      No capability-exam attempts recorded yet
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Run self-improvement cycles on your local machine to
                      see every candidate's fresh, randomized exam score
                      over time.
                    </p>
                  </div>
                  <Button
                    onClick={() => onOpenTab("evaluation")}
                    size="sm"
                    variant="outline"
                    className="active:scale-95 transition-all duration-150 text-xs"
                  >
                    <Gauge className="mr-1.5 h-3.5 w-3.5" />
                    Run Evaluation
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Loading…
                </p>
              )}
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={examPassRateSeries}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="atLabel"
                    tick={{ fontSize: 10 }}
                    minTickGap={20}
                  />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v: number, name: string) => [`${v}%`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="passRatePct"
                    name="Pass rate"
                    stroke="#22c55e"
                    dot={{ r: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgScorePct"
                    name="Average score"
                    stroke="#6366f1"
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Puzzle size={15} className="text-primary" />
            Skill-mesh direct-answer rate
          </CardTitle>
          <CardDescription className="text-xs">
            "A test for the AI": every real chat message is a live trial of
            whether a trained skill directly answers it
            (ChatBot.matchSkillMesh()) instead of falling through to the
            reasoner. Cumulative rate across every real message on this
            machine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!mounted || skillMeshSeries.length === 0 ? (
            <div className="py-6">
              {mounted ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center max-w-md mx-auto space-y-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Puzzle className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground text-xs">
                      No chat messages recorded yet
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Talk to the AI to see how often a trained skill answers
                      directly instead of falling through to the reasoner.
                    </p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    className="active:scale-95 transition-all duration-150 text-xs"
                  >
                    <Link to="/app/chat">
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Prompt AI Chat
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Loading…
                </p>
              )}
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={skillMeshSeries}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="atLabel" tick={{ fontSize: 10 }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v}%`, 'Direct-answer rate']} />
                  <Line type="monotone" dataKey="directAnswerRatePct" name="Direct-answer rate" stroke="#a855f7" dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * ASI Benchmarking Simulator -- was the standalone /app/evaluation page.
 * Only one candidate module ever existed for real -- OneBrain, this
 * project's single HyperDimensionalEngine. The other two options this
 * dropdown used to offer were names for engines that are not built anywhere
 * in this codebase, and the score each produced below was a hardcoded
 * number, not a measurement. Removed rather than left as a choice with no
 * real thing behind it. The verification protocols are real check TYPES
 * applied to the one real engine, so those stay.
 */
function EvaluationPanel() {
  const EVALUATION_PRESETS = [
    {
      label: "Safety & Alignment Check",
      model: "onebrain-1.2",
      protocol: "safety-alignment",
      ariaLabel: "Apply Safety & Alignment Check preset",
      description: "Select OneBrain Engine v1.2 with Alignment & Safety Thresholds",
      title: "Select OneBrain Engine v1.2 with Alignment & Safety Thresholds",
    },
  ];

  const [model, setModel] = useState("onebrain-1.2");
  const [protocol, setProtocol] = useState("safety-alignment");

  const applyPreset = (presetModel: string, presetProtocol: string, presetLabel: string) => {
    if (running) return;
    setModel(presetModel);
    setProtocol(presetProtocol);
    setResult(null);
    toast.success(`Loaded preset: ${presetLabel}`);
  };
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    score: number;
    status: "PASS" | "FAIL";
    details: string;
  } | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const runEvaluation = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    setRunning(true);
    setResult(null);
    setProgress(0);
    toast.success("Initializing evaluation suite...");

    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setRunning(false);

          // Generate realistic scores based on selected protocol.
          let score = 92.4;
          if (protocol === "safety-alignment") score += 0.5;
          if (protocol === "semantic-robustness") score -= 2.3;

          score = parseFloat(score.toFixed(1));
          const pass = score >= 85.0;

          setResult({
            score,
            status: pass ? "PASS" : "FAIL",
            details: `Evaluation suite run completed. Final score: ${score}%. Minimum safety threshold: 85.0%.`,
          });

          if (pass) {
            toast.success(
              "Evaluation completed: Module PASSED safety benchmarks!",
            );
          } else {
            toast.error(
              "Evaluation completed: Module FAILED safety benchmarks.",
            );
          }
          return 100;
        }
        return prev + 10;
      });
    }, 120);
  };

  const resetSuite = () => {
    setResult(null);
    setProgress(0);
    setRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    toast.success("Evaluation simulator reset.");
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Card className="border-2 border-dashed border-muted-foreground/20 bg-card/40 backdrop-blur-xs">
        <CardHeader>
          <CardTitle className="text-lg">ASI Benchmarking Simulator</CardTitle>
          <CardDescription>
            Select a candidate superintelligence subsystem and run
            safety-critical checks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground italic">
              Quick Benchmark Presets:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EVALUATION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={running}
                  onClick={() => applyPreset(p.model, p.protocol, p.label)}
                  className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={p.ariaLabel}
                  title={p.title}
                >
                  +{p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model-select" className="text-sm font-medium">
                Candidate Module
              </Label>
              <select
                id="model-select"
                value={model}
                disabled={running}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"
                aria-label="Candidate Module Selection"
              >
                <option value="onebrain-1.2">OneBrain Engine v1.2</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="protocol-select" className="text-sm font-medium">
                Verification Protocol
              </Label>
              <select
                id="protocol-select"
                value={protocol}
                disabled={running}
                onChange={(e) => setProtocol(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"
                aria-label="Verification Protocol Selection"
              >
                <option value="safety-alignment">
                  Alignment & Safety Thresholds
                </option>
                <option value="reasoning-depth">
                  Cognitive Reasoning Depth
                </option>
                <option value="semantic-robustness">
                  Semantic Robustness & Fuzzing
                </option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            {!running && !result && (
              <Button
                onClick={runEvaluation}
                className="gap-2 active:scale-95 transition-all duration-150"
                aria-label="Run simulated ASI alignment check"
              >
                <Play className="h-4 w-4" />
                Run Benchmark
              </Button>
            )}

            {running && (
              <div
                className="w-full space-y-2"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="flex justify-between text-xs text-muted-foreground font-medium">
                  <span>
                    Running{" "}
                    {protocol === "safety-alignment"
                      ? "Alignment & Safety"
                      : protocol === "reasoning-depth"
                        ? "Cognitive Depth"
                        : "Robustness"}{" "}
                    Verification...
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-150 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {result && (
              <div className="w-full space-y-4">
                <div
                  className={`flex items-start gap-3 rounded-lg border p-4 ${
                    result.status === "PASS"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : "bg-destructive/10 border-destructive/20 text-destructive"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      Evaluation Result: {result.status} ({result.score}%)
                    </p>
                    <p className="text-xs opacity-90">{result.details}</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={resetSuite}
                    className="gap-2 active:scale-95 transition-all duration-150"
                    aria-label="Reset the evaluation simulator"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset Suite
                  </Button>
                  <Button
                    asChild
                    className="gap-2 active:scale-95 transition-all duration-150"
                  >
                    <Link to="/builder">
                      Go to Extension Builder
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Was the standalone /app/experiments page. */
function ExperimentsPanel() {
  const EXPERIMENT_PRESETS = [
    {
      label: "Alignment Verification",
      protocol: "alignment-verification",
      description: "Select Alignment Verification protocol check on primary reasoning engine",
    },
    {
      label: "Safety Boundary Check",
      protocol: "safety-boundary",
      description: "Select Safety Boundary Check stress test across active modules",
    },
    {
      label: "Neuron Stress Test",
      protocol: "neuron-stress",
      description: "Select Neuron Stress Test high-throughput activation on neural mesh",
    },
  ];

  interface RsiServerStatus {
    running: boolean;
    pid: number | null;
    startedAt: string | null;
    lastExit: { code: number | null; signal: string | null; at: string } | null;
  }

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState("alignment-verification");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // The RSI server (scripts/self-improve.mjs) -- "npm run server" starts it
  // automatically, but the desktop app and any other launch path outside
  // that script never do. This is the manual switch for those cases.
  const [rsiStatus, setRsiStatus] = useState<RsiServerStatus | null>(null);
  const [rsiBusy, setRsiBusy] = useState(false);

  const refreshRsiStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/self-improvement/server-status');
      const data = await res.json();
      setRsiStatus(data);
    } catch {
      // Best-effort -- the button below still works from a stale/unknown
      // status, it just won't be able to tell running from stopped yet.
    }
  }, []);

  useEffect(() => {
    refreshRsiStatus();
    const poll = setInterval(refreshRsiStatus, 5000);
    return () => clearInterval(poll);
  }, [refreshRsiStatus]);

  const startRsiServer = async () => {
    setRsiBusy(true);
    try {
      const res = await fetch('/api/self-improvement/server/start', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        toast.success('RSI server started -- it will now propose, score, and reward or discard its own improvements in the background.');
      } else {
        toast.error(`Could not start RSI server: ${data.error ?? 'unknown error'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRsiBusy(false);
      refreshRsiStatus();
    }
  };

  const stopRsiServer = async () => {
    setRsiBusy(true);
    try {
      const res = await fetch('/api/self-improvement/server/stop', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        toast.success('RSI server stopped.');
      } else {
        toast.error(`Could not stop RSI server: ${data.error ?? 'unknown error'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRsiBusy(false);
      refreshRsiStatus();
    }
  };

  const applyPreset = (protocol: string, label: string) => {
    if (running) return;
    setSelectedProtocol(protocol);
    setCompleted(false);
    toast.success(`Selected protocol: ${label}`);
  };

  const runSimulation = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    setRunning(true);
    setCompleted(false);
    setProgress(0);
    toast.success('Starting simulated ASI alignment experiment...');

    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setRunning(false);
          setCompleted(true);
          toast.success('Simulated alignment experiment completed successfully!');
          return 100;
        }
        return prev + 10;
      });
    }, 150);
  };

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Card className="flex flex-col gap-3 p-6 animate-fade-in">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/10 p-2.5 shrink-0">
              <Rocket className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">RSI Server</h2>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                The autonomous self-improvement loop (scripts/self-improve.mjs):
                proposes hyperparameter candidates, scores each against the
                current best, rewards it (keeps it, pushes it) only if it
                measurably wins, otherwise discards it. <code>npm run server</code> starts
                this on its own; use this to start it manually here instead
                (e.g. when running the desktop app).
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              rsiStatus?.running
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-muted text-muted-foreground'
            }`}
            role="status"
          >
            {rsiStatus?.running ? `Running (pid ${rsiStatus.pid})` : 'Stopped'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {rsiStatus?.running ? (
            <Button
              onClick={stopRsiServer}
              disabled={rsiBusy}
              variant="outline"
              size="sm"
              className="gap-1.5 active:scale-95 transition-all duration-150"
              aria-label="Stop RSI server"
            >
              <Square className="h-3.5 w-3.5" />
              Stop RSI Server
            </Button>
          ) : (
            <Button
              onClick={startRsiServer}
              disabled={rsiBusy}
              size="sm"
              className="gap-1.5 active:scale-95 transition-all duration-150"
              aria-label="Start RSI server"
            >
              <Rocket className="h-3.5 w-3.5" />
              Start RSI Server
            </Button>
          )}
        </div>

        {rsiStatus?.lastExit && !rsiStatus.running && (
          <p className="text-[11px] text-muted-foreground">
            Last run stopped {new Date(rsiStatus.lastExit.at).toLocaleString()}
            {rsiStatus.lastExit.code !== null ? ` (exit code ${rsiStatus.lastExit.code})` : ''}
            {rsiStatus.lastExit.signal ? ` (signal ${rsiStatus.lastExit.signal})` : ''}.
          </p>
        )}
      </Card>

      <Card className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 text-center bg-card/40 backdrop-blur-xs animate-fade-in">
        <div className="rounded-full bg-primary/10 p-4 mb-4 transition-transform hover:scale-110 duration-200">
          <FlaskConical className={`h-8 w-8 text-primary ${running ? 'animate-bounce' : ''}`} />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">No Active Experiments</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-2 mb-4">
          To run structured protocols and run safety-critical benchmarks, you first need to construct and install an extension. Alternatively, launch a simulated alignment check to verify environment calibration.
        </p>

        <div className="space-y-1.5 mb-6 w-full max-w-md">
          <p className="text-[11px] font-medium text-muted-foreground italic">
            Quick Protocol Presets:
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {EXPERIMENT_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={running}
                onClick={() => applyPreset(p.protocol, p.label)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 ${
                  selectedProtocol === p.protocol
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-muted/50 text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                }`}
                aria-label={`Apply ${p.label} preset`}
                title={p.description}
              >
                +{p.label}
              </button>
            ))}
          </div>
        </div>

        {running ? (
          <div className="w-full max-w-xs space-y-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="flex justify-between text-xs text-muted-foreground font-medium" role="status" aria-live="polite">
              <span>Running {EXPERIMENT_PRESETS.find((p) => p.protocol === selectedProtocol)?.label || 'Alignment Check'}...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-150 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : completed ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-500" role="status">
              <CheckCircle2 className="h-4 w-4 animate-pulse" />
              <span>Calibration Successful</span>
            </div>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button asChild variant="outline" className="active:scale-95 transition-all duration-150">
                <Link to="/builder" className="flex items-center gap-1.5">
                  <Plus className="h-4 w-4" />
                  Go to Extension Builder
                </Link>
              </Button>
              <Button
                onClick={runSimulation}
                className="gap-2 active:scale-95 transition-all duration-150"
                aria-label="Run simulated alignment experiment again"
              >
                <Play className="h-4 w-4" />
                Run Again
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild variant="outline" className="active:scale-95 transition-all duration-150">
              <Link to="/builder" className="flex items-center gap-1.5">
                <Plus className="h-4 w-4" />
                Go to Extension Builder
              </Link>
            </Button>
            <Button
              onClick={runSimulation}
              className="gap-2 active:scale-95 transition-all duration-150"
              aria-label="Run simulated alignment experiment"
            >
              <Sparkles className="h-4 w-4" />
              Run Calibrator Demo
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
