import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Knowledge Page Micro-UX & Accessibility Enhancements", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/app/knowledge.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("includes an accessible search input associated with a label", () => {
    expect(fileContent).toContain('htmlFor="semantic-query"');
    expect(fileContent).toContain('id="semantic-query"');
    expect(fileContent).toContain('ref={inputRef}');
  });

  it("includes an inline clear query button with tactile scaling and ARIA attributes", () => {
    expect(fileContent).toContain('onClick={handleClearQuery}');
    expect(fileContent).toContain('aria-label="Clear search query"');
    expect(fileContent).toContain('title="Clear search query"');
    expect(fileContent).toContain("active:scale-95");
    expect(fileContent).toContain("focus-visible:ring-2");
  });

  it("includes copy result button with tactile feedback and dynamic ARIA attributes", () => {
    expect(fileContent).toContain('CopyResultButton');
    expect(fileContent).toContain('aria-label={copied ? \'Query result copied\' : \'Copy query result\'}');
  });
});
