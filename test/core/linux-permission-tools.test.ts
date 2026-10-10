import { describe, expect, it, vi } from "vitest";
import {
  LINUX_PERMISSION_TOOLS,
  getLinuxPermissionTool,
  listLinuxPermissionTools,
  type LinuxToolCallContext,
} from "../../plugins/linux-permission-tools.js";
import { LinuxPermissionToolsPlugin } from "../../plugins/linux-permission-plugin.js";

describe("Linux permission tools", () => {
  it("registers a separate tool for every Linux and Lennox capability", () => {
    expect(LINUX_PERMISSION_TOOLS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(LINUX_PERMISSION_TOOLS.map((tool) => tool.permission)).size).toBe(LINUX_PERMISSION_TOOLS.length);
    expect(listLinuxPermissionTools()).toHaveLength(LINUX_PERMISSION_TOOLS.length);
    expect(getLinuxPermissionTool("linux_chmod")).toBeDefined();
    expect(getLinuxPermissionTool("lennox_ordering")).toBeDefined();
    expect(getLinuxPermissionTool("linux_permission_inventory")).toBeDefined();
    expect(getLinuxPermissionTool("linux_seccomp_policy")).toBeDefined();
    expect(getLinuxPermissionTool("linux_disk_encryption")).toBeDefined();
    expect(getLinuxPermissionTool("linux_effective_access_check")).toBeDefined();
  });

  it("keeps the expanded privileged permission catalog opt-in", () => {
    const sensitive = new Set([
      "linux-disk-encryption",
      "linux-seccomp-policy",
      "linux-polkit-policy",
      "linux-packet-capture",
      "linux-permission-inventory",
    ]);
    for (const permission of sensitive) {
      const tool = LINUX_PERMISSION_TOOLS.find((item) => item.permission === permission);
      expect(tool, `missing tool for ${permission}`).toBeDefined();
      expect(tool!.risk).toBe("high");
    }
  });

  it("denies calls without a grant before reaching an adapter", async () => {
    const adapter = vi.fn(async () => "should not run");
    const tool = getLinuxPermissionTool("linux_chmod")!;
    const context: LinuxToolCallContext = {
      platform: "linux",
      isGranted: () => false,
      requestApproval: async () => true,
      adapters: { "linux-chmod": adapter },
    };
    await expect(tool.execute({ path: "/tmp/example", mode: 384 }, context)).rejects.toThrow(/Permission denied/);
    expect(adapter).not.toHaveBeenCalled();
  });

  it("requires human approval for high-impact operations", async () => {
    const adapter = vi.fn(async () => "changed");
    const approval = vi.fn(async () => false);
    const tool = getLinuxPermissionTool("linux-service-control")!;
    const context: LinuxToolCallContext = {
      platform: "linux",
      isGranted: () => true,
      requestApproval: approval,
      adapters: { "linux-service-control": adapter },
    };
    await expect(tool.execute({ target: "ssh", action: "stop" }, context)).rejects.toThrow(/approval denied/);
    expect(approval).toHaveBeenCalledOnce();
    expect(adapter).not.toHaveBeenCalled();
  });

  it("fails closed when a capability has no native adapter", async () => {
    const tool = getLinuxPermissionTool("lennox_ordering")!;
    const context: LinuxToolCallContext = {
      platform: "linux",
      isGranted: () => true,
      requestApproval: async () => true,
      adapters: {},
    };
    await expect(tool.execute({ action: "create" }, context)).rejects.toThrow(/no native adapter/);
  });

  it("exposes every capability as a named ToolPlugin tool", () => {
    const plugin = new LinuxPermissionToolsPlugin({
      id: "linux-permission-tools",
      name: "Linux Permission Tools",
      type: "api-connection",
      capabilities: ["linux-permissions"],
    });
    expect(plugin.getTools()).toHaveLength(LINUX_PERMISSION_TOOLS.length);
    expect(plugin.getTool("linux_chmod")?.capability).toBe("linux-chmod");
    expect(plugin.getTool("lennox_warranty_returns")).toBeDefined();
  });

  it("rejects use on non-Linux hosts", async () => {
    const tool = getLinuxPermissionTool("linux_system_information")!;
    const context: LinuxToolCallContext = {
      platform: "win32",
      isGranted: () => true,
      requestApproval: async () => true,
      adapters: { "linux-system-information": async () => "unexpected" },
    };
    await expect(tool.execute({}, context)).rejects.toThrow(/Linux-only/);
  });
});
