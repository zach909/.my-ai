import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Gauge, Play, CheckCircle2, RotateCcw, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/evaluation")({
  head: () => ({
    meta: [
      { title: "Evaluation · ASI Architect" },
      {
        name: "description",
        content:
          "Measure and benchmark ASI module performance against defined criteria.",
      },
    ],
  }),
  component: EvaluationPage,
});

function EvaluationPage() {
  const PRESETS = [
    {
      label: "Safety & Alignment Check",
      model: "onebrain-1.2",
      protocol: "safety-alignment",
      description: "Select OneBrain Engine v1.2 with Alignment & Safety Thresholds",
      title: "Select OneBrain Engine v1.2 with Alignment & Safety Thresholds",
      ariaLabel: "Apply Safety & Alignment Check preset",
    },
    {
      label: "Cognitive Reasoning Test",
      model: "hd-2.0",
      protocol: "reasoning-depth",
      description: "Select HyperDimensional Engine v2.0 with Cognitive Reasoning Depth",
      title: "Select HyperDimensional Engine v2.0 with Cognitive Reasoning Depth",
      ariaLabel: "Apply Cognitive Reasoning Test preset",
    },
    {
      label: "Fuzzing & Robustness Test",
      model: "neuralmesh-0.9",
      protocol: "semantic-robustness",
      description: "Select Neural Mesh v0.9 with Semantic Robustness & Fuzzing",
      title: "Select Neural Mesh v0.9 with Semantic Robustness & Fuzzing",
      ariaLabel: "Apply Fuzzing & Robustness Test preset",
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

          // Generate realistic scores based on selected model and protocol
          let score = 92.4;
          if (model === "neuralmesh-0.9") score = 84.1;
          if (model === "hd-2.0") score = 98.7;
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
    <div className="space-y-6 max-w-4xl mx-auto p-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" />
          Evaluation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Measure, benchmark, and score ASI modules against defined criteria and
          safety thresholds.
        </p>
      </div>

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
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={running}
                  onClick={() => applyPreset(p.model, p.protocol, p.label)}
                  className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-foreground active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Apply ${p.label} preset`}
                  title={p.description}
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
                <option value="neuralmesh-0.9">
                  Neural Mesh v0.9 (Pre-Beta)
                </option>
                <option value="hd-2.0">HyperDimensional Engine v2.0</option>
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
