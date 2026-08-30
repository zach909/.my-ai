import { CalendarPlugin } from "../../plugins/calendar";

describe("CalendarPlugin Security and Input Validation", () => {
  const pluginDef = {
    id: "calendar",
    name: "Calendar",
    type: "api-connection",
    capabilities: ["calendar"],
  } as any;

  it("allows adding, listing, updating, removing, and querying upcoming events with valid inputs", async () => {
    const plugin = new CalendarPlugin(pluginDef);

    const now = Date.now();
    const event = await plugin.add({
      title: "Security Sync",
      description: "Discussing security hardening",
      startTime: now + 3600000,
      endTime: now + 7200000,
      location: "Room A",
      category: "Work",
    });

    expect(event.id).toBeDefined();
    expect(event.title).toBe("Security Sync");

    const list = await plugin.list(now, now + 10000000);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(event.id);

    const updated = await plugin.update(event.id, {
      title: "Updated Security Sync",
      description: "Updated description",
    });
    expect(updated).toBe(true);

    const upcoming = await plugin.getUpcoming(5);
    expect(upcoming.length).toBe(1);
    expect(upcoming[0].title).toBe("Updated Security Sync");

    const removed = await plugin.remove(event.id);
    expect(removed).toBe(true);

    const emptyList = await plugin.list();
    expect(emptyList.length).toBe(0);
  });

  describe("add() validation", () => {
    it("rejects non-object event parameter", async () => {
      const plugin = new CalendarPlugin(pluginDef);
      // @ts-expect-error test invalid type
      await expect(plugin.add(null)).rejects.toThrow("Security Error: Event data must be an object.");
      // @ts-expect-error test invalid type
      await expect(plugin.add("invalid")).rejects.toThrow("Security Error: Event data must be an object.");
      // @ts-expect-error test invalid type
      await expect(plugin.add([1, 2, 3])).rejects.toThrow("Security Error: Event data must be an object.");
    });

    it("rejects non-string or empty title", async () => {
      const plugin = new CalendarPlugin(pluginDef);
      const now = Date.now();

      // @ts-expect-error test invalid type
      await expect(plugin.add({ title: 123, startTime: now, endTime: now + 1000 })).rejects.toThrow("Security Error: Event title must be a string.");
      await expect(plugin.add({ title: "", startTime: now, endTime: now + 1000 })).rejects.toThrow("Security Error: Event title cannot be empty.");
      await expect(plugin.add({ title: "   ", startTime: now, endTime: now + 1000 })).rejects.toThrow("Security Error: Event title cannot be empty.");
    });

    it("rejects oversized fields", async () => {
      const plugin = new CalendarPlugin(pluginDef);
      const now = Date.now();

      await expect(plugin.add({ title: "a".repeat(201), startTime: now, endTime: now + 1000 })).rejects.toThrow("Security Error: Event title exceeds maximum length limit of 200 characters.");
      await expect(plugin.add({ title: "Valid Title", description: "b".repeat(2001), startTime: now, endTime: now + 1000 })).rejects.toThrow("Security Error: Event description exceeds maximum length limit of 2000 characters.");
      await expect(plugin.add({ title: "Valid Title", location: "c".repeat(501), startTime: now, endTime: now + 1000 })).rejects.toThrow("Security Error: Event location exceeds maximum length limit of 500 characters.");
      await expect(plugin.add({ title: "Valid Title", category: "d".repeat(101), startTime: now, endTime: now + 1000 })).rejects.toThrow("Security Error: Event category exceeds maximum length limit of 100 characters.");
    });

    it("rejects invalid timestamps", async () => {
      const plugin = new CalendarPlugin(pluginDef);
      const now = Date.now();

      // @ts-expect-error test invalid type
      await expect(plugin.add({ title: "Valid Title", startTime: "invalid", endTime: now + 1000 })).rejects.toThrow("Security Error: 'startTime' must be a non-negative finite number.");
      // @ts-expect-error test invalid type
      await expect(plugin.add({ title: "Valid Title", startTime: now, endTime: NaN })).rejects.toThrow("Security Error: 'endTime' must be a non-negative finite number.");
      await expect(plugin.add({ title: "Valid Title", startTime: -100, endTime: now + 1000 })).rejects.toThrow("Security Error: 'startTime' must be a non-negative finite number.");
      await expect(plugin.add({ title: "Valid Title", startTime: now + 1000, endTime: now })).rejects.toThrow("Security Error: 'startTime' cannot be greater than 'endTime'.");
    });
  });

  describe("update() validation", () => {
    it("rejects invalid event ID", async () => {
      const plugin = new CalendarPlugin(pluginDef);

      // @ts-expect-error test invalid type
      await expect(plugin.update(123, { title: "New Title" })).rejects.toThrow("Security Error: Event ID must be a string.");
      await expect(plugin.update("", { title: "New Title" })).rejects.toThrow("Security Error: Event ID cannot be empty.");
      await expect(plugin.update("x".repeat(101), { title: "New Title" })).rejects.toThrow("Security Error: Event ID exceeds maximum length limit of 100 characters.");
    });

    it("rejects invalid update fields", async () => {
      const plugin = new CalendarPlugin(pluginDef);
      const now = Date.now();
      const event = await plugin.add({ title: "Title", startTime: now, endTime: now + 1000 });

      // @ts-expect-error test invalid type
      await expect(plugin.update(event.id, { title: 456 })).rejects.toThrow("Security Error: Event title must be a string.");
      await expect(plugin.update(event.id, { title: " " })).rejects.toThrow("Security Error: Event title cannot be empty.");
      await expect(plugin.update(event.id, { startTime: now + 5000 })).rejects.toThrow("Security Error: 'startTime' cannot be greater than 'endTime'.");
    });
  });

  describe("list() and getUpcoming() validation", () => {
    it("rejects invalid list timestamp filters", async () => {
      const plugin = new CalendarPlugin(pluginDef);

      // @ts-expect-error test invalid type
      await expect(plugin.list("invalid", 1000)).rejects.toThrow("Security Error: 'from' timestamp must be a non-negative finite number.");
      // @ts-expect-error test invalid type
      await expect(plugin.list(1000, "invalid")).rejects.toThrow("Security Error: 'to' timestamp must be a non-negative finite number.");
      await expect(plugin.list(2000, 1000)).rejects.toThrow("Security Error: 'from' timestamp cannot be greater than 'to' timestamp.");
    });

    it("rejects invalid getUpcoming count limits", async () => {
      const plugin = new CalendarPlugin(pluginDef);

      // @ts-expect-error test invalid type
      await expect(plugin.getUpcoming("5")).rejects.toThrow("Security Error: 'count' must be an integer between 1 and 1000.");
      await expect(plugin.getUpcoming(0)).rejects.toThrow("Security Error: 'count' must be an integer between 1 and 1000.");
      await expect(plugin.getUpcoming(-1)).rejects.toThrow("Security Error: 'count' must be an integer between 1 and 1000.");
      await expect(plugin.getUpcoming(1001)).rejects.toThrow("Security Error: 'count' must be an integer between 1 and 1000.");
      await expect(plugin.getUpcoming(2.5)).rejects.toThrow("Security Error: 'count' must be an integer between 1 and 1000.");
    });
  });
});
