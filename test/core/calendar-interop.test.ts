/**
 * Regression test for plugins/calendar.ts's load()/plugin_calendar.py interop
 * (both plugins persist to the exact same STORAGE_FILE path, sharing the
 * "cal-*" id format, but historically used different field names: this
 * class's CalendarEvent uses startTime/endTime milliseconds, while
 * plugin_calendar.py's events use start/end seconds).
 *
 * Without normalization, list()/getUpcoming() filter and sort on
 * `e.startTime`/`e.endTime`, which are `undefined` on every Python-written
 * record -- getUpcoming() silently drops genuinely upcoming events
 * (undefined >= now is always false).
 */

import { vi, beforeEach, afterEach } from 'vitest';

const pythonWrittenEvent = {
  id: 'cal-1785651772487-675cb719',
  title: 'Team meeting',
  start: 2_000_000_000, // seconds since epoch -- year ~2033, genuinely upcoming
  end: 2_000_003_600,
  description: 'desc',
  location: 'room',
  created: 1_785_651_772.4873543,
};

describe('CalendarPlugin reads plugin_calendar.py-written events', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('node:fs');
  });

  async function loadPluginWithFile(content: unknown) {
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        existsSync: () => true,
        readFileSync: () => JSON.stringify(content),
        writeFileSync: () => {},
        mkdirSync: () => {},
      };
    });
    const { CalendarPlugin } = await import('../../plugins/calendar');
    const plugin = new CalendarPlugin({ id: 'calendar', name: 'Calendar', type: 'api-connection', capabilities: [] } as any);
    const fakeLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    await plugin.onActivate({ logger: fakeLogger } as any);
    return plugin;
  }

  it('getUpcoming() finds a Python-written event with only start/end fields', async () => {
    const plugin = await loadPluginWithFile([pythonWrittenEvent]);
    const upcoming = await plugin.getUpcoming();
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].id).toBe(pythonWrittenEvent.id);
  });

  it('list() returns a Python-written event with startTime/endTime populated (seconds -> ms)', async () => {
    const plugin = await loadPluginWithFile([pythonWrittenEvent]);
    const listed = await plugin.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].startTime).toBe(pythonWrittenEvent.start * 1000);
    expect(listed[0].endTime).toBe(pythonWrittenEvent.end * 1000);
  });

  it('does not disturb a native TS-written event that already has startTime/endTime', async () => {
    const nativeEvent = { id: 'cal-native', title: 'native', startTime: 123456, endTime: 654321 };
    const plugin = await loadPluginWithFile([nativeEvent]);
    const listed = await plugin.list();
    expect(listed[0].startTime).toBe(123456);
    expect(listed[0].endTime).toBe(654321);
  });
});
