# Privacy Policy

The full privacy policy for this project lives in the wiki: **[wiki/Privacy-Policy.md](wiki/Privacy-Policy.md)** (plain-language: what data leaves your machine, where it goes, and when) and **[wiki/Privacy.md](wiki/Privacy.md)** (the technical implementation: encryption, key derivation, and how "no external APIs" is enforced in code).

This file exists at the repository root so it's discoverable without navigating into `wiki/` first — the content there is the source of truth; this is a pointer, not a duplicate that can drift out of sync.

**Short version**: this software runs locally by default, has no accounts and no telemetry, and the only things that ever leave your machine are: web search query text (only when you invoke web search), and — only if you don't disable them — small numeric hyperparameter/score values from the autonomous self-improvement loop, sent to this repository's `beta` branch and to any peers you explicitly configure. See [wiki/Privacy-Policy.md](wiki/Privacy-Policy.md) for the complete table of what/where/when.
