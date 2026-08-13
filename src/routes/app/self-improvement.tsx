/**
 * Self-Improvement dashboard — "I want a graph about how the agent
 * itself is doing on these tasks, and... how good it is at passing the
 * improvement test."
 *
 * Reads GET /api/self-improvement/history, which just exposes two real
 * local ledgers already being written by autonomous agents `npm run
 * server` launches: scripts/self-improve.mjs's own scoreboard (per
 * target-script candidate scores, whether each was rewarded) and
 * scripts/skill-drill-agent.mjs's quality history (per-skill held-out
 * accuracy before/after each drill, whether it genuinely improved).
 * Neither agent running yet (fresh install, or both disabled via
 * NEUROCLAW_SELF_IMPROVE=0 / NEUROCLAW_SKILL_DRILLS=0) means an empty
 * chart, not an error -- see the empty states below.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import {
  TrendingUp,
  Target,
  RefreshCw,
  Sparkles,
  FlaskConical,
  ArrowRight,
  Puzzle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
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
      { title: "Self-Improvement · ASI Architect" },
      {
        name: "description",
        content:
          "Real progress from the autonomous self-improvement, skill-creation, and skill-drilling agents.",
      },
    ],
  }),
  component: SelfImprovementPage,
});

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

  const load = async () => {
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
  const skillMeshSeries = buildSkillMeshRateSeries(skillMeshAttempts).map(
    (row) => ({
      ...row,
      atLabel: shortTime(new Date(row.at).toISOString()),
      directAnswerRatePct: Math.round(row.directAnswerRate * 1000) / 10,
    }),
  );
  const targetKeys = Object.keys(selfImprovement);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Self-Improvement</h1>
          <p className="text-xs text-muted-foreground">
            Real progress from the autonomous agents `npm run server` launches
            -- not a simulated demo.
          </p>
        </div>
        <Button
          onClick={load}
          disabled={loading}
          variant="outline"
          size="sm"
          aria-label="Refresh self-improvement history"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground active:scale-95"
        >
          <RefreshCw
            className={loading ? "size-3.5 animate-spin" : "size-3.5"}
          />
          Refresh
        </Button>
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
                    asChild
                    size="sm"
                    variant="outline"
                    className="active:scale-95 transition-all duration-150 text-xs"
                  >
                    <Link to="/app/experiments">
                      <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
                      View Experiments
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
