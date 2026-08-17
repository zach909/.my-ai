import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Experiments Page Micro-UX Enhancements", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/app/experiments.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("includes quick protocol preset buttons with accessible attributes", () => {
    expect(fileContent).toContain("Quick Protocol Presets");
    expect(fileContent).toContain("applyPreset");
    expect(fileContent).toContain('aria-label={`Apply ${p.label} preset`}');
  });

  it("includes tactile scale micro-interactions and focus rings on preset buttons", () => {
    expect(fileContent).toContain("active:scale-95");
    expect(fileContent).toContain("focus-visible:ring-2");
    expect(fileContent).toContain("focus-visible:ring-ring");
  });

  it("includes helpful title tooltips and live ARIA progress region", () => {
    expect(fileContent).toContain('role="status" aria-live="polite"');
    expect(fileContent).toContain("Select Alignment Verification protocol check on primary reasoning engine");
    expect(fileContent).toContain("Select Safety Boundary Check stress test across active modules");
    expect(fileContent).toContain("Select Neuron Stress Test high-throughput activation on neural mesh");
  });
});
