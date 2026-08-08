import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FlaskConical, Plus } from "lucide-react";

export const Route = createFileRoute("/app/experiments")({
  head: () => ({
    meta: [
      { title: "Experiments · ASI Architect" },
      {
        name: "description",
        content:
          "Design and run ASI module experiments with structured protocols.",
      },
    ],
  }),
  component: ExperimentsPage,
});

function ExperimentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Experiments
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Design and run structured experiments to prototype and evaluate ASI
          modules.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center min-h-[350px] p-8 border-2 border-dashed border-muted rounded-xl bg-muted/20 text-center animate-fade-in">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 transition-transform hover:scale-110 duration-200">
          <FlaskConical className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          No active experiments
        </h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm mb-6">
          To run structured protocols and run safety-critical benchmarks, you
          first need to construct and install an extension.
        </p>
        <Button asChild className="active:scale-95 transition-all duration-150">
          <Link to="/builder" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Go to Extension Builder
          </Link>
        </Button>
      </div>
    </div>
  );
}
