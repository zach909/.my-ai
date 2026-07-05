## 2025-05-14 - [Chat Accessibility and Feedback]
**Learning:** Adding `role="log"` and `aria-live="polite"` to chat containers ensures screen readers announce new AI responses. Disabling inputs during async "thinking" states prevents user confusion and double-submissions.
**Action:** Always include ARIA live regions for dynamic chat content and provide clear visual feedback (disabled states) for ongoing asynchronous operations.
