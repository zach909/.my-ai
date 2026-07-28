## 2026-07-04 - [Accessibility & Feedback Loop Improvements]
**Learning:** Adding ARIA live regions and disabling inputs during async operations creates a much more robust and accessible feedback loop, especially in a terminal-like interface where the user might otherwise double-submit or miss AI responses.
**Action:** Always include `role="log"`, `aria-live="polite"`, and `aria-atomic="false"` for chat-like containers, and ensure inputs are disabled during processing with a `finally` block to restore state and focus.

## 2026-07-16 - [Keyboard Accessible Tabs & Async Guardrails]
**Learning:** Implementing `role="tablist"` and `role="tab"` with `tabindex="0"` and `aria-selected` ensures that custom UI navigation is accessible to keyboard users. Combining this with explicit disabling of inputs and buttons during async operations creates a "guarded" interaction pattern that prevents duplicate state mutations and provides clear feedback.
**Action:** Use a unified `switchTab` refactor pattern for any multi-panel interface to keep ARIA states in sync, and always wrap async operations in `finally` blocks to restore interactive UI elements.

## 2026-07-22 - [Accessible Input Association & Icon Button Accessibility]
**Learning:** To make sliders and text inputs screen-reader accessible and descriptive, they must be explicitly associated with their respective label elements using matching `id` and `htmlFor` attributes. Additionally, icon-only buttons require descriptive `aria-label` and matching `title` properties to guarantee that assistive technologies can read their purpose, and hover interactions provide clear tooltips.
**Action:** Always link visual label texts to input controls with `htmlFor` and `id`, and provide both `aria-label` and `title` to visual-only icon buttons.

## 2026-07-26 - [Dynamic Client-Side Routing & Active Sidebar Highlights]
**Learning:** Using raw anchor tags (`<a>`) in sidebar headers or layout structures causes full page reloads that discard local client state and create layout flicker. Refactoring these navigation bars to use `@tanstack/react-router`'s `<Link>` with `activeOptions={{ exact: true }}` and `activeProps`/`inactiveProps` provides instantaneous SPA transitions and eliminates hardcoded active states.
**Action:** Use framework-native `<Link>` elements for internal navigation, and bind active styles dynamically via routing context instead of manual component states.
