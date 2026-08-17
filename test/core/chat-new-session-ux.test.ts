import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("AI Chat New Session Micro-UX Enhancements", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/app/chat.tsx");
  const fileContent = fs.readFileSync(filePath, "utf-8");

  it("includes handleNewChat session reset function", () => {
    expect(fileContent).toContain("handleNewChat");
    expect(fileContent).toContain("Started a new chat session");
  });

  it("includes New Chat button with accessible ARIA attributes and focus rings", () => {
    expect(fileContent).toContain('aria-label="Start a new chat session"');
    expect(fileContent).toContain('title="Start a new chat session"');
    expect(fileContent).toContain("focus-visible:ring-primary");
    expect(fileContent).toContain("active:scale-95");
  });
});
