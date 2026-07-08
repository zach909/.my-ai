# TinyGPT Sample Corpus

This tiny Markdown file exists so the pipeline runs end-to-end out of the box.
Replace the contents of `data/pretrain/` with your own `.md` corpus (dozens of
megabytes is plenty for a 10–30M parameter model) before a real training run.

## What a language model does

A language model reads a sequence of tokens and predicts the next one. Trained
over a large corpus, it learns grammar, facts, and style purely from the
statistics of which tokens tend to follow which. TinyGPT is a decoder-only
Transformer: it attends only to earlier positions, so it can generate text one
token at a time from left to right.

## Markdown structure

Markdown documents mix prose with structure: headings, lists, code blocks, and
emphasis. A model trained on Markdown learns these patterns too.

- Lists like this one.
- Nested ideas and short phrases.
- Links, `inline code`, and **emphasis**.

```python
def hello(name):
    return f"Hello, {name}!"
```

## Why small models matter

Small models train quickly on a single consumer GPU, are easy to inspect, and
make a great teaching tool. You will not get GPT-4 out of 20 million parameters,
but you will get a model that writes fluent, on-topic Markdown after enough
steps — and you will understand every line of code that produced it.

## Repetition helps tiny corpora

Because this sample is deliberately small, the tokenizer and model will simply
memorise it. That is expected: it demonstrates that the training loop, loss,
checkpointing, and sampling all work. Swap in real data to get a real model.
