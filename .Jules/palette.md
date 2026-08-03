## 2026-07-04 - [Accessibility & Feedback Loop Improvements]
**Learning:** Adding ARIA live regions and disabling inputs during async operations creates a much more robust and accessible feedback loop, especially in a terminal-like interface where the user might otherwise double-submit or miss AI responses.
**Action:** Always include `role="log"`, `aria-live="polite"`, and `aria-atomic="false"` for chat-like containers, and ensure inputs are disabled during processing with a `finally` block to restore state and focus.

## 2026-07-16 - [Keyboard Accessible Tabs & Async Guardrails]
**Learning:** Implementing `role="tablist"` and `role="tab"` with `tabindex="0"` and `aria-selected` ensures that custom UI navigation is accessible to keyboard users. Combining this with explicit disabling of inputs and buttons during async operations creates a "guarded" interaction pattern that prevents duplicate state mutations and provides clear feedback.
**Action:** Use a unified `switchTab` refactor pattern for any multi-panel interface to keep ARIA states in sync, and always wrap async operations in `finally` blocks to restore interactive UI elements.

## 2026-07-22 - [Accessible Input Association & Icon Button Accessibility]
**Learning:** To make sliders and text inputs screen-reader accessible and descriptive, they must be explicitly associated with their respective label elements using matching `id` and `htmlFor` attributes. Additionally, icon-only buttons require descriptive `aria-label` and matching `title` properties to guarantee that assistive technologies can read their purpose, and hover interactions provide clear tooltips.
**Action:** Always link visual label texts to input controls with `htmlFor` and `id`, and provide both `aria-label` and `title` to visual-only icon buttons.

## 2026-07-28 - [TanStack Router Link Refactoring & Interactive Sidebar Polish]
**Learning:** Replacing raw `<a>` tags with TanStack Router `<Link>` and dynamic `activeProps` in nav menus eliminates full-page reloads and guarantees synchronized, accurate route highlighting. Pairing this with descriptive `aria-label` definitions on icon-only/collapsed states and tactile transition feedback (`active:scale-95`) provides an extremely polished and accessible SPA feel.
**Action:** Always prefer framework-native routing links over raw anchor elements for navigation menus, and explicitly apply a11y labels and focus rings to all sidebar control actions.
## 2026-07-26 - [Dynamic Client-Side Routing & Active Sidebar Highlights]
**Learning:** Using raw anchor tags (`<a>`) in sidebar headers or layout structures causes full page reloads that discard local client state and create layout flicker. Refactoring these navigation bars to use `@tanstack/react-router`'s `<Link>` with `activeOptions={{ exact: true }}` and `activeProps`/`inactiveProps` provides instantaneous SPA transitions and eliminates hardcoded active states.
**Action:** Use framework-native `<Link>` elements for internal navigation, and bind active styles dynamically via routing context instead of manual component states.

## 2026-08-01 - [Input Focus Preservation & Chat Log Accessibility]
**Learning:** Toggling disabled states on inputs causes browsers to drop active keyboard focus. Restoring focus programmatically via a React ref when async tasks finish prevents user disruption and ensures fluid navigation. Wrapping chat lists in a `role="log"` live region keeps assistive technologies seamlessly informed.
**Action:** For chat and input-heavy interfaces, pair `role="log"` container regions with a ref-based programmatic focus restoration on input fields once processing states conclude.

## 2026-08-08 - [Focus Restoration & Screen-Reader Labels in Collaborative Workspaces]
**Learning:** For multi-agent collaboration panels or chat-groups, keeping keyboard focus inside input fields during asynchronous workflows prevents screen-reader context disruption. Providing hidden sr-only labels for inputs and adding explicit ARIA labels on button triggers ensures that assistive technology users can fully navigate the interface.
**Action:** Always pair focus restoration with explicit input-to-label bindings and high-contrast ARIA properties in text-submit flows.

## 2026-08-15 - [Interactive State Preservation & Tactile Buttons for App Sub-Modes]
**Learning:** Multi-state buttons or global sub-modes (such as incognito toggles) must declare their activation state using standard `aria-pressed` properties and be paired with tactile scale-down transforms (`active:scale-95 transition-all`) to mirror high-end interface environments.
**Action:** Always pair `aria-pressed` with tactile scale transition feedback on sub-mode controls.
## 2026-08-15 - [Interactive Toggle Button Accessibility & Tactile Feedback]
**Learning:** Interactive state toggle controls (like an incognito mode button) must explicitly manage screen-reader state using `aria-pressed` and present descriptive `aria-label` elements that reflect whether the mode is active or inactive. Furthermore, pairing these with visual-tactile response transitions (`active:scale-95 transition-all duration-150`) greatly enhances the physical feedback of interacting with critical session states.
**Action:** When designing toggle inputs or mode switch buttons, always pair `aria-pressed` state tracking with explicit labels and active scale visual transitions.
## 2026-08-15 - [SVG Canvas Connection Accessibility & Interactive Groups]
**Learning:** SVG connections / edges are typically non-interactive and hidden from keyboard or screen reader users, causing layout gaps. Wrapping `<path>` and `<text>` elements in a `<g>` element with `role="button"`, `tabIndex={0}`, and `aria-label` lets assistive tech users navigate connections, while combining with Tailwind `group` utilities allows seamless, synchronized visual hover/focus feedback.
**Action:** When building custom canvases, always make SVG path-and-text connection layers accessible with interactive group wrappers and keyboard event hooks.
