import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Evaluation Page Micro-UX Enhancements", () => {
  // Evaluation moved into Self-Improvement as a tab.
  const filePath = path.resolve(process.cwd(), "src/routes/app/self-improvement.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("includes quick benchmark preset buttons with accessible attributes", () => {
    expect(fileContent).toContain("Quick Benchmark Presets");
    expect(fileContent).toContain("applyPreset");
    expect(fileContent).toContain("Apply Safety & Alignment Check preset");
  });

  it("does not offer a candidate module that isn't a real engine", () => {
    // "Neural Mesh v0.9 (Pre-Beta)" and "HyperDimensional Engine v2.0" were
    // names for nothing -- no such engine exists anywhere in this codebase,
    // and the score each produced was a hardcoded number standing in for a
    // measurement. OneBrain is the one real engine and the one option left.
    expect(fileContent).not.toContain("Neural Mesh v0.9");
    expect(fileContent).not.toContain("HyperDimensional Engine v2.0");
    expect(fileContent).not.toContain("neuralmesh-0.9");
    expect(fileContent).not.toContain("hd-2.0");
    expect(fileContent).toContain("OneBrain Engine v1.2");
  });

  it("includes tactile scale micro-interactions and focus rings on preset buttons", () => {
    expect(fileContent).toContain("active:scale-95");
    expect(fileContent).toContain("focus-visible:ring-2");
    expect(fileContent).toContain("focus-visible:ring-ring");
  });

  it("includes a helpful title tooltip for the preset button", () => {
    expect(fileContent).toContain("Select OneBrain Engine v1.2 with Alignment & Safety Thresholds");
  });
});
