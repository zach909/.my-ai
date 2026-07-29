/**
 * Response Actions — interactive UI for agent responses.
 *
 * Provides two features:
 * 1. "Use as prompt" button — quickly send the response back as a new prompt
 * 2. Multiple-choice selector — auto-detect options (A, B, C, etc.) and render as clickable buttons
 */

import { Button } from '@/components/ui/button'
import { useState } from 'react'

interface ResponseActionsProps {
  /** The agent's response text */
  response: string
  /** Callback when user selects to use response as prompt */
  onUseAsPrompt: (text: string) => void
  /** Callback when user selects a multiple-choice option */
  onSelectOption?: (option: string) => void
}

/** Detect multiple-choice options in response (A), (B), (C) pattern */
function detectOptions(text: string): string[] {
  const optionPattern = /\([A-Z]\)\s*[^\n]+/g
  const matches = text.match(optionPattern) || []
  return matches.length >= 2 ? matches : [] // Only treat as MC if 2+ options found
}

export function ResponseActions({
  response,
  onUseAsPrompt,
  onSelectOption,
}: ResponseActionsProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const options = detectOptions(response)
  const hasOptions = options.length >= 2

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-2">
      {/* Multiple-choice UI */}
      {hasOptions && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Choose an answer:</p>
          <div className="flex flex-col gap-1.5">
            {options.map((option, i) => (
              <button
                key={i}
                onClick={() => {
                  setSelectedOption(option)
                  onSelectOption?.(option)
                  onUseAsPrompt(option)
                }}
                className={`rounded px-2 py-1.5 text-xs text-left transition-colors ${
                  selectedOption === option
                    ? 'bg-primary/25 border border-primary text-primary'
                    : 'bg-muted hover:bg-muted/80 border border-transparent text-foreground'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Use as prompt button */}
      {!hasOptions && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full text-xs"
          onClick={() => onUseAsPrompt(response)}
          title="Send this response back to the agent as a new prompt"
        >
          ↻ Use this as prompt
        </Button>
      )}

      {/* When options are shown, also show a "Use full response" button */}
      {hasOptions && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-full text-[11px]"
          onClick={() => onUseAsPrompt(response)}
        >
          Use full response as prompt
        </Button>
      )}
    </div>
  )
}
