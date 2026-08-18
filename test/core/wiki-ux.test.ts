import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Wiki Page Micro-UX & Accessibility Enhancements", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/app/wiki.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("associates search input with an accessible label element", () => {
    expect(fileContent).toContain('htmlFor="wiki-search-input"');
    expect(fileContent).toContain('id="wiki-search-input"');
    expect(fileContent).toContain('Search wiki pages');
  });

  it("includes clear search button with tactile scaling and ARIA descriptors", () => {
    expect(fileContent).toContain('aria-label="Clear search filter"');
    expect(fileContent).toContain('title="Clear search filter"');
    expect(fileContent).toContain("active:scale-95");
    expect(fileContent).toContain('onClick={() => setQuery(\'\')}');
  });

  it("includes ARIA live status region for screen reader announcements", () => {
    expect(fileContent).toContain('role="status"');
    expect(fileContent).toContain('aria-live="polite"');
    expect(fileContent).toContain("filteredPages.length");
  });

  it("provides zero-match empty state with clear search filter CTA", () => {
    expect(fileContent).toContain("Clear Search Filter");
    expect(fileContent).toContain('aria-label="Clear search query filter"');
  });

  it("includes focus visible rings and tactile scaling on sidebar navigation items", () => {
    expect(fileContent).toContain("active:scale-[0.98]");
    expect(fileContent).toContain("focus-visible:ring-2");
  });
});
