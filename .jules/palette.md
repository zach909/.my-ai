## 2025-05-14 - [Chat Accessibility and Feedback]
**Learning:** Adding `role="log"` and `aria-live="polite"` to chat containers ensures screen readers announce new AI responses. Disabling inputs during async "thinking" states prevents user confusion and double-submissions.
**Action:** Always include ARIA live regions for dynamic chat content and provide clear visual feedback (disabled states) for ongoing asynchronous operations.

## 2025-05-15 - [Accessible Status and Response Utility]
**Learning:** Visual status indicators must use `role="img"` and dynamic `aria-label` updates to be accessible. Providing a "Copy" button on AI responses with immediate "Copied!" feedback significantly improves utility and matches modern chat UX expectations.
**Action:** Implement focus-visible copy buttons on AI messages and ensure all status dots are properly labeled for screen readers.
