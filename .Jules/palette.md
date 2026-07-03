## 2026-07-03 - [Accessible AI Chat Interface]
**Learning:** AI chat interfaces often lack proper ARIA live regions for new messages and "thinking" states, making them difficult for screen reader users to follow. Additionally, providing a disabled state for the input during processing prevents accidental double-submissions.
**Action:** Always include `role="log"` and `aria-live="polite"` on chat containers, and ensure all inputs have associated labels (even if visually hidden).
