## 2025-05-14 - [Chat Accessibility and Feedback]
**Learning:** Adding `role="log"` and `aria-live="polite"` to chat containers ensures screen readers announce new AI responses. Disabling inputs during async "thinking" states prevents user confusion and double-submissions.
**Action:** Always include ARIA live regions for dynamic chat content and provide clear visual feedback (disabled states) for ongoing asynchronous operations.

## 2025-05-15 - [Accessible Status and Response Utility]
**Learning:** Visual status indicators must use `role="img"` and dynamic `aria-label` updates to be accessible. Providing a "Copy" button on AI responses with immediate "Copied!" feedback significantly improves utility and matches modern chat UX expectations.
**Action:** Implement focus-visible copy buttons on AI messages and ensure all status dots are properly labeled for screen readers.

## 2025-07-09 - [High Contrast for Terminal Themes]
**Learning:** In dark-themed interfaces like this terminal (#0a0a0a), secondary text colors like #555 fall below the WCAG AA 4.5:1 contrast threshold. Moving to #888 ensures accessibility without sacrificing the "dimmed" feel of metadata.
**Action:** Audit all secondary text (timestamps, status text) for contrast compliance on dark backgrounds and prefer #888+ over #555.
## 2025-05-16 - [Contrast Standards and Session Management]
**Learning:** To meet WCAG AA standards (4.5:1 ratio) on dark backgrounds, secondary text (like timestamps) requires a higher luminance (e.g., #888 instead of #555). Additionally, providing a "Clear Chat" feature that resets both the UI and the underlying message history state is a critical micro-UX for persistent AI terminals.
**Action:** Use #888 for secondary text on black/dark themes and ensure session-clearing actions are synchronized across all application state layers.

## 2025-07-10 - [Focus Visibility and Tactile Feedback]
**Learning:** In terminal-themed interfaces, standard focus outlines are often lost against dark backgrounds. Explicitly styling `:focus-visible` with a high-contrast theme color (e.g., #00ff41) ensures accessibility for keyboard users without adding visual noise for mouse users. Additionally, adding `:active` states (like `transform: translateY(1px)`) provides subtle but essential tactile feedback for button clicks.
**Action:** Use `:focus-visible` for consistent, accessible focus indicators and `:active` transforms for responsive-feeling interactions.

## 2025-10-24 - [Persistent Chat Sessions]
**Learning:** In terminal-style AI interfaces, losing context on page refresh is a major friction point. Implementing LocalStorage persistence for message history, including timestamps and roles, creates a seamless and "always-on" feel that matches user expectations for persistent tools.
**Action:** Default to persistent chat history via LocalStorage for web-based AI terminals, ensuring a robust 'Clear' mechanism is also provided to reset state.
## 2025-07-13 - [Resilient Dashboard Status and Screen Reader Feedback]
**Learning:** For polling-based status indicators, ensuring the error/catch block explicitly resets both visual classes (e.g., `.online`) and ARIA labels (e.g., `aria-label="System status: Offline"`) is critical for reliability. Furthermore, applying `role="log"` and `aria-live="polite"` to chat containers in dashboard views ensures accessibility parity with specialized terminal components.
**Action:** Always synchronize visual class removal and ARIA attribute updates in status polling error handlers to prevent "stuck" indicators.
