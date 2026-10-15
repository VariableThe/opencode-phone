// Human-readable status labels shown while the agent works ("Searching codebase...").
// Extracted from stores/events.ts so the mapping is unit-testable in isolation.
// `import type` is erased at runtime, so this module pulls in no RN/SDK code.
import type { Part } from "./sdk"

// Tool status labels derived from part type.
export const TOOL_STATUS: Record<string, string> = {
  read: "Gathering context...",
  list: "Searching codebase...",
  grep: "Searching codebase...",
  glob: "Searching codebase...",
  webfetch: "Searching web...",
  edit: "Making edits...",
  write: "Making edits...",
  apply_patch: "Making edits...",
  bash: "Running command...",
  task: "Delegating...",
  todowrite: "Planning...",
  todoread: "Planning...",
}

export function statusFromPart(part: Part): string {
  if (part.type === "reasoning") return "Thinking..."
  if (part.type === "tool" && part.tool) return TOOL_STATUS[part.tool] || `Running ${part.tool}...`
  if (part.type === "text") return "Writing..."
  return "Working..."
}
