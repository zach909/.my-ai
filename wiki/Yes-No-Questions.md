# Yes/No Questions

Give NeuroClaw a whole piece of text, such as an email, plus a yes/no question such as "Is this spam?". It answers **yes** or **no**, with the probability.

## Using it

TypeScript (`models && skills/core/yes-no.ts`):

```typescript
const doorway = new YesNoDoorway(engine);            // engine = the live mesh
doorway.teach('Is this spam?', 'WIN a FREE iPhone now', true);
doorway.teach('Is this spam?', 'Lunch tomorrow at noon?', false);
// ...more examples of each...
doorway.ask('Is this spam?', emailText);
// { answer: 'yes', probabilityYes: 0.87, confidence: 0.87, trained: true, fitAccuracy: 1, ... }
```

HTTP, on the running app:

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/yes-no/teach` | `{ question, text, answer: true/false }` | examples taught so far |
| `POST /api/yes-no/ask` | `{ question, text }` | answer, `probabilityYes`, `confidence`, `trained`, `fitAccuracy` |
| `GET /api/yes-no` | | every question and its example counts |

What you teach is saved to `~/.neuroclaw/yes-no.json` and restored into the mesh on restart.

## How it works

Each question is its own **region of the one mesh**, three neurons: *input*, *yes* and *no*. Questions don't interfere with each other.

- **Teaching:**
  - The text becomes hashed word and word-pair features, one per mesh dimension.
  - Each answer neuron's incoming connection from the input neuron is tuned (`tuneNeuronTo`) toward the average of its side's examples, centred between the two sides.
- **Asking:**
  - Each answer neuron's signed response to the text through that tuned connection is its score.
  - The probability is a logistic of the yes-minus-no difference. The logistic is calibrated so an answer as clear-cut as the average taught example reads about 88%.
- **Why not the Zip Loop:** spelling a whole email in bit by bit costs tens of thousands of ticks, and the answer is one of two things, not text.

## Limits

- It's a nearest-average classifier over word features. It's as good as the examples you teach it: 6 of each gets simple spam right, and more examples help.
- A question without at least one example of each answer returns `trained: false` at 50%, rather than guessing.
- `fitAccuracy` is how well it fits the examples it was taught, not a held-out score.

## See Also

- [[MoE|Net-Skill Routing]] - how the rest of the mesh is divided into regions
- [[Zip-IO]] - the doorway for text in and text out
