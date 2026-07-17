# Supported Languages

The Coding skill (see [[Skills]]) covers 500+ programming languages — not as a marketing claim, but as a real, queryable catalog.

## Overview

**File**: `models && skills/programming-skills.ts` — `PROGRAMMING_SKILLS: ProgrammingSkill[]`

```typescript
interface ProgrammingSkill {
  id: string;
  name: string;
  category: string;
  extensions: string[];      // file extensions this language uses
  keywords: string[];        // for matching a query to a language
  description: string;
  expertType: 'coding' | 'scripting' | 'markup' | 'data' | 'system' | 'functional' | 'esoteric';
}

getSkillById(id);
getSkillsByCategory(category);
getSkillsByExpertType(expertType);
searchSkills(query);
getAllCategories();  getAllExpertTypes();
```

The catalog currently has **581 entries** (matching the "500+ languages" claim with real headroom, not a rounded-down number), spanning seven `expertType` classes: `coding`, `scripting`, `markup`, `data`, `system`, `functional`, and `esoteric` (Brainfuck, LOLCODE, Whitespace, and the like are genuinely catalogued, not just the mainstream languages).

## How it connects to the Coding skill

`searchSkills(query)` and `getSkillsByCategory`/`getSkillsByExpertType` are what let the [[MoE]] router match an input against a specific language's `keywords`/`extensions` rather than routing every coding-shaped request to one undifferentiated "coding" expert — a request that mentions `.rs` files or Rust-specific keywords resolves to the Rust entry specifically, which is how the Coding skill's per-language behaviour stays distinguishable inside one MoE expert slot.

## See Also

- [[Home]] - Main wiki page
- [[Skills]] - The Coding skill this catalog backs
- [[MoE]] - How a matched language routes to the right expert
- [[Extensions]] - Building a language-specific extension via Code-to-Net

---

*581 catalogued languages, each with real keywords and extensions to match against — not a marketing number.*
