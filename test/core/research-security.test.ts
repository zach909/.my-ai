import { describe, it, expect } from "vitest";
import { ResearchPlugin } from "../../plugins/research";
import { resolve } from "node:path";

describe("ResearchPlugin searchDrive security validations", () => {
  const plugin = new ResearchPlugin({
    id: "research",
    name: "Research",
    type: "api-connection",
    capabilities: [],
  });

  it("allows searching under process.cwd()", async () => {
    // Should be able to search the current directory without errors
    const results = await plugin.searchDrive("class ResearchPlugin", {
      root: resolve(process.cwd(), "plugins"),
      maxResults: 1,
    });
    expect(Array.isArray(results)).toBe(true);
  });

  it("gracefully returns an empty array for non-existent root paths", async () => {
    const results = await plugin.searchDrive("anything", {
      root: "./definitely/does/not/exist/xyz",
    });
    expect(results).toEqual([]);
  });

  it("rejects path traversal attempts to existing directories outside process.cwd()", async () => {
    // "/" or "/etc" always exist on POSIX sandbox environments
    await expect(
      plugin.searchDrive("anything", {
        root: "/",
      })
    ).rejects.toThrow("Security Error: Path traversal detected");

    await expect(
      plugin.searchDrive("anything", {
        root: "/etc",
      })
    ).rejects.toThrow("Security Error: Path traversal detected");
  });
});
