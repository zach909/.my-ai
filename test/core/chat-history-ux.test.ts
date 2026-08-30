import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Chat History Micro-UX Enhancements", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/app/chat-history.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("includes a search input associated with a label via matching id/htmlFor", () => {
    expect(fileContent).toContain('id="chat-history-search"');
    expect(fileContent).toContain('htmlFor="chat-history-search"');
    expect(fileContent).toContain('aria-label="Filter chat history"');
    expect(fileContent).toContain('placeholder="Search chats or groups…"');
  });

  it("includes a clear-search button with tactile scale transitions and ARIA attributes", () => {
    expect(fileContent).toContain('aria-label="Clear search filter"');
    expect(fileContent).toContain('title="Clear search filter"');
    expect(fileContent).toContain("active:scale-95");
    expect(fileContent).toContain("focus-visible:ring-2");
    expect(fileContent).toContain("onClick={() => setSearchQuery('')}");
  });

  it("includes an ARIA live status region announcing filtered chat counts to screen readers", () => {
    expect(fileContent).toContain('role="status"');
    expect(fileContent).toContain('aria-live="polite"');
    expect(fileContent).toContain("totalFilteredChats");
  });

  it("includes an empty state card with a clear-filter CTA for zero search matches", () => {
    expect(fileContent).toContain("No conversations or topic groups matching");
    expect(fileContent).toContain('aria-label="Clear search query filter"');
    expect(fileContent).toContain("Clear Filter");
  });
});
