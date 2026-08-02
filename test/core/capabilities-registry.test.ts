/**
 * Regression test for interface/capabilities.js's CapabilitiesRegistry:
 * app-launcher, browser, microphone, contacts, calendar, email, tasks,
 * encryption, and diagnostics were all hardcoded `available: false`
 * regardless of the fact that every one of them has a real, working
 * implementation elsewhere in the repo (interface/app-launcher.js,
 * plugins/browser.ts, plugins/microphone.ts, plugins/contacts.ts,
 * plugins/calendar.ts, plugins/email.ts, plugins/tasks.ts,
 * interface/encryption.js, plugins/app-diagnostics.ts) with no external
 * binary dependency. getSystemPrompt() -- the AI's own description of what
 * it can do -- silently omitted all nine from "capabilities available",
 * so the model had no way to know it could use them.
 */

import { CapabilitiesRegistry } from '../../interface/capabilities.js';

describe('CapabilitiesRegistry reports real capabilities as available', () => {
  const alwaysAvailableIds = [
    'app-launcher',
    'browser',
    'microphone',
    'contacts',
    'calendar',
    'email',
    'tasks',
    'encryption',
    'diagnostics',
  ];

  it('marks every plugin-backed, no-external-dependency capability as available', () => {
    const registry = new CapabilitiesRegistry();
    for (const id of alwaysAvailableIds) {
      expect(registry.isAvailable(id)).toBe(true);
    }
  });

  it('includes all of them in the system prompt sent to the model', () => {
    const registry = new CapabilitiesRegistry();
    const prompt = registry.getSystemPrompt();
    for (const id of alwaysAvailableIds) {
      const cap = registry.get(id);
      expect(prompt).toContain(cap.name);
    }
  });
});
