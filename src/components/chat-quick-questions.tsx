/**
 * Quick Questions Panel — suggested prompts and conversation starters.
 *
 * Shows common questions the user can click to send immediately,
 * helping them get started or explore different topics.
 */

import { Button } from '@/components/ui/button'
import { Lightbulb } from 'lucide-react'

interface QuickQuestionsProps {
  onSelectQuestion: (question: string) => void
  disabled?: boolean
}

const QUICK_QUESTIONS = [
  'Help me break down a complex problem',
  'Generate multiple solutions and compare them',
  'What are the key considerations for this?',
  'Walk me through a step-by-step approach',
  'What are potential risks or edge cases?',
  'Show me best practices for this domain',
  'Help me write and test code for this',
  'Create a detailed plan with milestones',
]

export function ChatQuickQuestions({ onSelectQuestion, disabled }: QuickQuestionsProps) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Lightbulb size={16} className="text-yellow-500" />
        Quick questions
      </div>
      <div className="grid gap-2">
        {QUICK_QUESTIONS.map((question) => (
          <button
            key={question}
            onClick={() => onSelectQuestion(question)}
            disabled={disabled}
            className="group relative rounded px-3 py-2 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-muted-foreground group-hover:text-foreground">→ {question}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
