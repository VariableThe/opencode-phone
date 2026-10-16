// Minimal single-line code tokenizer for CodeBlock highlighting, driven by
// the theme's syntax* tokens (see syntaxColors in opencode-theme.ts).
//
// Deliberately small: no dependencies, no multi-line state (block comments,
// heredocs, and JSX nesting fall back to plain text). Runs per logical line
// so it composes with CodeBlock's one-Text-per-line wrapping. Pure —
// node:test runnable, same constraint as diff-compute.ts.

export type HighlightKind = "plain" | "comment" | "string" | "number" | "keyword"

export interface HighlightSegment {
  text: string
  kind: HighlightKind
}

const KEYWORDS = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null private protected public return static super switch this throw true try typeof var void while with yield async of from as satisfies type readonly unknown never any string number boolean object symbol bigint".split(
    " ",
  ),
)

//                1: strings            2: line comment  3: number            4: word
const TOKEN_RE =
  /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`)|(\/\/.*$|#.*$)|\b(\d[\w.]*)\b|([A-Za-z_$][\w$]*)/g

/** Split one logical line into highlighted segments. Never throws. */
export function highlightLine(line: string): HighlightSegment[] {
  if (!line) return [{ text: "", kind: "plain" }]
  const out: HighlightSegment[] = []
  TOKEN_RE.lastIndex = 0
  let pos = 0
  let match: RegExpExecArray | null
  // A `#` only starts a comment at a word boundary-ish position (start of
  // line or after whitespace/structural chars) — otherwise `a#b` style tokens
  // (JS private fields, URL fragments) stay plain.
  const hashOk = (index: number) => {
    if (index === 0) return true
    const prev = line[index - 1]
    return prev === " " || prev === "\t" || prev === "(" || prev === "[" || prev === "{" || prev === ";" || prev === ","
  }
  while ((match = TOKEN_RE.exec(line)) !== null) {
    const [full, str, comment, num, word] = match
    if (comment && comment.startsWith("#") && !hashOk(match.index)) {
      continue
    }
    if (match.index > pos) out.push({ text: line.slice(pos, match.index), kind: "plain" })
    if (str) out.push({ text: full, kind: "string" })
    else if (comment) out.push({ text: full, kind: "comment" })
    else if (num) out.push({ text: full, kind: "number" })
    else if (word && KEYWORDS.has(word)) out.push({ text: full, kind: "keyword" })
    else out.push({ text: full, kind: "plain" })
    pos = match.index + full.length
    if (comment) break
  }
  if (pos < line.length) out.push({ text: line.slice(pos), kind: "plain" })
  if (out.length === 0) out.push({ text: line, kind: "plain" })
  return out
}
