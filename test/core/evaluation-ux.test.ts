import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Evaluation Page Micro-UX Enhancements", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/app/evaluation.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("includes quick benchmark preset buttons with accessible attributes", () => {
    expect(fileContent).toContain("Quick Benchmark Presets");
    expect(fileContent).toContain("applyPreset");
    expect(fileContent).toContain('aria-label="Apply Safety & Alignment Check preset"');
    expect(fileContent).toContain('aria-label="Apply Cognitive Reasoning Test preset"');
    expect(fileContent).toContain('aria-label="Apply Fuzzing & Robustness Test preset"');
  });

  it("includes tactile scale micro-interactions and focus rings on preset buttons", () => {
    expect(fileContent).toContain("active:scale-95");
    expect(fileContent).toContain("focus-visible:ring-2");
    expect(fileContent).toContain("focus-visible:ring-ring");
  });

  it("includes helpful title tooltips for preset buttons", () => {
    expect(fileContent).toContain('title="Select OneBrain Engine v1.2 with Alignment & Safety Thresholds"');
    expect(fileContent).toContain('title="Select HyperDimensional Engine v2.0 with Cognitive Reasoning Depth"');
    expect(fileContent).toContain('title="Select Neural Mesh v0.9 with Semantic Robustness & Fuzzing"');
  });
});
