## 2026-07-04 - [Accessibility & Feedback Loop Improvements]
**Learning:** Adding ARIA live regions and disabling inputs during async operations creates a much more robust and accessible feedback loop, especially in a terminal-like interface where the user might otherwise double-submit or miss AI responses.
**Action:** Always include `role="log"`, `aria-live="polite"`, and `aria-atomic="false"` for chat-like containers, and ensure inputs are disabled during processing with a `finally` block to restore state and focus.

## 2026-07-16 - [Keyboard Accessible Tabs & Async Guardrails]
**Learning:** Implementing `role="tablist"` and `role="tab"` with `tabindex="0"` and `aria-selected` ensures that custom UI navigation is accessible to keyboard users. Combining this with explicit disabling of inputs and buttons during async operations creates a "guarded" interaction pattern that prevents duplicate state mutations and provides clear feedback.
**Action:** Use a unified `switchTab` refactor pattern for any multi-panel interface to keep ARIA states in sync, and always wrap async operations in `finally` blocks to restore interactive UI elements.
