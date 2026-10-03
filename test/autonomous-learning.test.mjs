import { describe, it, expect } from 'vitest';
import ConversationAnalyzer from '../scripts/conversation-analyzer.mjs';

describe('Autonomous Learning System', () => {
  describe('ConversationAnalyzer', () => {
    it('should classify messages by domain', () => {
      const testCases = [
        {
          text: 'Prove that all even numbers are divisible by 2',
          expected: ['reasoning'],
        },
        {
          text: 'Design a circuit with transistors and logic gates',
          expected: ['chip-design'],
        },
        {
          text: 'Calculate the escape velocity for a black hole using the Schwarzschild radius',
          expected: ['physics'],
        },
        {
          text: 'Implement a neural network using backpropagation in Python',
          expected: ['ai-coding'],
        },
        {
          text: 'What is the frequency of a photon with energy 5 eV?',
          expected: ['physics'],
        },
      ];

      for (const testCase of testCases) {
        const domains = ConversationAnalyzer.classifyMessage(testCase.text);
        for (const expectedDomain of testCase.expected) {
          expect(domains).toHaveProperty(expectedDomain);
          expect(domains[expectedDomain]).toBeGreaterThan(0);
        }
      }
    });

    it('should extract learnings from conversations', () => {
      const userMsg = 'How do I design a chip with Verilog?';
      const aiResponse = 'You can use Verilog to describe hardware at the register-transfer level (RTL). Define modules, use always blocks for sequential logic, and assign statements for combinational logic.';
      const domains = ConversationAnalyzer.classifyMessage(userMsg + ' ' + aiResponse);

      const learnings = ConversationAnalyzer.extractLearnings(userMsg, aiResponse, domains);

      expect(learnings).toHaveProperty('chip-design');
      if (learnings['chip-design']) {
        expect(learnings['chip-design'].length).toBeGreaterThan(0);
        expect(learnings['chip-design'][0]).toHaveProperty('sample');
        expect(learnings['chip-design'][0].sample).toHaveProperty('input');
        expect(learnings['chip-design'][0].sample).toHaveProperty('output');
      }
    });

    it('should analyze full conversation logs', () => {
      const turns = [
        {
          userMessage: 'Prove that x² + y² ≥ 2xy',
          response: 'This is true because (x-y)² ≥ 0, which expands to x² - 2xy + y² ≥ 0.',
          at: Date.now() - 1000,
        },
        {
          userMessage: 'How do transistors work in a MOSFET?',
          response: 'MOSFETs are controlled by voltage applied to the gate, which creates a conducting channel between source and drain.',
          at: Date.now(),
        },
      ];

      const domainLearnings = ConversationAnalyzer.analyzeConversationLog(turns);

      expect(domainLearnings).toHaveProperty('reasoning');
      expect(domainLearnings).toHaveProperty('chip-design');
      expect(domainLearnings.reasoning.length).toBeGreaterThan(0);
      expect(domainLearnings['chip-design'].length).toBeGreaterThan(0);
    });

    it('should not classify unrelated text', () => {
      const unrelated = 'The weather is nice today. I like eating pizza.';
      const domains = ConversationAnalyzer.classifyMessage(unrelated);

      expect(Object.keys(domains).length).toBe(0);
    });
  });
});
