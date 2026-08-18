import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Chat History Micro-UX & Accessibility Enhancements", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/app/chat-history.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("includes filter input with proper label and accessible attributes", () => {
    expect(fileContent).toContain('id="search-history-input"');
    expect(fileContent).toContain('htmlFor="search-history-input"');
    expect(fileContent).toContain('aria-label="Filter chat history by title or group"');
    expect(fileContent).toContain('placeholder="Filter past chats or topic groups..."');
  });

  it("includes clear filter button with tactile scale transitions and ARIA attributes", () => {
    expect(fileContent).toContain('aria-label="Clear filter query"');
    expect(fileContent).toContain('title="Clear filter query"');
    expect(fileContent).toContain("active:scale-95");
    expect(fileContent).toContain("focus-visible:ring-2");
  });

  it("includes ARIA live status region for screen reader announcements", () => {
    expect(fileContent).toContain('role="status"');
    expect(fileContent).toContain('aria-live="polite"');
    expect(fileContent).toContain("totalFilteredChats");
  });

  it("includes empty state card for zero search filter matches", () => {
    expect(fileContent).toContain("Clear Filter");
    expect(fileContent).toContain('aria-label="Clear search query filter"');
  });
});
