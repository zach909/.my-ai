/**
 * Prompt Clips — save and manage reusable prompt templates.
 *
 * Stores prompt clips in localStorage with metadata (created, domain, usage count).
 */

export interface PromptClip {
  id: string
  text: string
  created: number
  category?: string
  usageCount: number
}

const STORAGE_KEY = 'neuroclaw_prompt_clips'

export const PromptClips = {
  /**
   * Save a prompt as a reusable clip.
   */
  save(text: string, category?: string): PromptClip {
    const clips = PromptClips.all()
    const clip: PromptClip = {
      id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      text,
      created: Date.now(),
      category,
      usageCount: 0,
    }
    clips.push(clip)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clips))
    return clip
  },

  /**
   * Get all saved clips.
   */
  all(): PromptClip[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    } catch {
      return []
    }
  },

  /**
   * Get clips in a specific category.
   */
  byCategory(category: string): PromptClip[] {
    return PromptClips.all().filter((c) => c.category === category)
  },

  /**
   * Record that a clip was used (increment usage counter).
   */
  use(id: string): void {
    const clips = PromptClips.all()
    const clip = clips.find((c) => c.id === id)
    if (clip) {
      clip.usageCount += 1
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clips))
    }
  },

  /**
   * Delete a clip.
   */
  delete(id: string): boolean {
    const clips = PromptClips.all()
    const idx = clips.findIndex((c) => c.id === id)
    if (idx >= 0) {
      clips.splice(idx, 1)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clips))
      return true
    }
    return false
  },

  /**
   * Clear all clips.
   */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY)
  },

  /**
   * Most recently used clips (sorted by usage count, then creation time).
   */
  frequent(limit = 5): PromptClip[] {
    return PromptClips.all()
      .sort((a, b) => b.usageCount - a.usageCount || b.created - a.created)
      .slice(0, limit)
  },
}
