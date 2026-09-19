// Hand-written replacements for clsx + tailwind-merge (`cn`) and
// class-variance-authority (`cva`) — small enough, and used narrowly enough
// in this codebase, to not need a third-party package for either.

/** Anything cn() accepts as one "class-ish" argument. */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | Record<string, boolean | null | undefined>
  | ClassValue[]

function flatten(input: ClassValue, out: string[]) {
  if (!input && input !== 0) return
  if (typeof input === 'string' || typeof input === 'number') {
    out.push(String(input))
  } else if (Array.isArray(input)) {
    for (const item of input) flatten(item, out)
  } else if (typeof input === 'object') {
    for (const key in input) {
      if (input[key]) out.push(key)
    }
  }
}

// Tailwind utilities that share a "kind" (e.g. every `p-*` class is a
// padding utility) conflict with each other -- only the last one should
// win, same as tailwind-merge. Matched by prefix; classes with no matching
// group just pass through untouched (including arbitrary values, which
// this intentionally does not try to parse -- rare enough in this codebase
// that a false negative here is a cosmetic dedup miss, not a correctness bug).
const CONFLICT_GROUPS: RegExp[] = [
  /^-?(?:p|px|py|pt|pr|pb|pl)-/, /^-?(?:m|mx|my|mt|mr|mb|ml)-/,
  /^-?(?:w|min-w|max-w)-/, /^-?(?:h|min-h|max-h)-/,
  /^(?:bg)-/, /^(?:text)-(?!left$|center$|right$|justify$)/, /^(?:font)-/,
  /^(?:border)(?:-(?:t|r|b|l|x|y))?-(?!\[)/, /^(?:rounded)(?:-[a-z]+)?-/,
  /^(?:flex)-/, /^(?:justify)-/, /^(?:items)-/, /^(?:gap|gap-x|gap-y)-/,
  /^(?:top|right|bottom|left|inset)-/, /^(?:z)-/, /^(?:opacity)-/,
  /^(?:shadow)-?/, /^(?:leading)-/, /^(?:tracking)-/, /^(?:duration)-/,
  /^(?:ease)-/, /^(?:cursor)-/, /^(?:overflow)(?:-[xy])?-/,
]

function conflictKey(cls: string): string | null {
  // Strip variant prefixes (hover:, dark:, md:, aria-invalid:, etc.) so
  // `p-2 hover:p-4` still resolves group membership on `p-4`'s own base
  // utility, and strip a leading `!` (Tailwind's important marker).
  const base = cls.split(':').pop()!.replace(/^!/, '')
  for (const re of CONFLICT_GROUPS) {
    if (re.test(base)) {
      const variantPrefix = cls.slice(0, cls.length - base.length)
      return variantPrefix + re.source
    }
  }
  return null
}

/** Combine class-name-ish values and drop earlier Tailwind utilities that a
 * later one in the same conflict group (padding, width, color, ...) overrides
 * -- so `cn('p-2', condition && 'p-4')` behaves like the real thing wins,
 * not both classes landing in the DOM. */
export function cn(...inputs: ClassValue[]) {
  const flat: string[] = []
  flatten(inputs, flat)
  const classes = flat.join(' ').split(/\s+/).filter(Boolean)

  const winners = new Map<string, string>() // conflictKey -> class
  const passthrough: string[] = []
  for (const cls of classes) {
    const key = conflictKey(cls)
    if (key) winners.set(key, cls) // later occurrence overwrites earlier
    else passthrough.push(cls)
  }
  return [...passthrough, ...winners.values()].join(' ')
}

// ── cva ──────────────────────────────────────────────────────────────────

type VariantMap = Record<string, Record<string, string>>
type VariantSelection<V extends VariantMap> = { [K in keyof V]?: keyof V[K] | null }

interface CvaConfig<V extends VariantMap> {
  variants?: V
  defaultVariants?: VariantSelection<V>
}

/** Minimal stand-in for class-variance-authority's `cva`: a base class string
 * plus named variant groups, each resolving to one class string, picked by
 * the caller's selection (falling back to defaultVariants). */
export function cva<V extends VariantMap>(base: string, config?: CvaConfig<V>) {
  return (props?: VariantSelection<V> & { className?: string }) => {
    const classes = [base]
    const variants = config?.variants
    if (variants) {
      for (const key of Object.keys(variants) as (keyof V)[]) {
        const selected = props?.[key] ?? config?.defaultVariants?.[key]
        if (selected != null) {
          const cls = variants[key][selected as string]
          if (cls) classes.push(cls)
        }
      }
    }
    if (props?.className) classes.push(props.className)
    return cn(...classes)
  }
}

/** Extracts a cva-returned function's variant-selection props (mirrors
 * class-variance-authority's `VariantProps<typeof x>` type helper). */
export type VariantProps<T extends (...args: never[]) => unknown> = Omit<
  NonNullable<Parameters<T>[0]>,
  'className'
>
