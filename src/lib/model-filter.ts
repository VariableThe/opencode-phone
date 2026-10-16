// Pure model-catalog search shared by the chat ModelPicker and the
// new-session modal's model section. No sibling runtime imports —
// unit-testable with plain `node --test`, same pattern as pty.ts /
// bridge.ts (only structural types, every helper self-contained).
//
// The list MUST come from the connected server (GET /api/model via
// client.provider.list() -> toProviderCatalog): never hardcode models here.

export interface FilterableModel {
  id: string
  name: string
}

export interface FilterableProvider {
  id: string
  name: string
  models: FilterableModel[]
}

export interface ModelHit {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
}

// Matches one query against id, display name and provider name.
// Trims + lowercases first: a pasted query with surrounding whitespace must
// not silently match nothing.
export function matchesModelQuery(
  providerID: string,
  providerName: string,
  modelID: string,
  modelName: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    modelID.toLowerCase().includes(q) ||
    modelName.toLowerCase().includes(q) ||
    providerName.toLowerCase().includes(q) ||
    providerID.toLowerCase().includes(q)
  )
}

export function filterModels(providers: FilterableProvider[], query: string): ModelHit[] {
  const list = Array.isArray(providers) ? providers : []
  const out: ModelHit[] = []
  for (const p of list) {
    for (const m of p.models || []) {
      if (!matchesModelQuery(p.id, p.name || p.id, m.id, m.name || m.id, query)) continue
      out.push({
        providerID: p.id,
        providerName: p.name || p.id,
        modelID: m.id,
        modelName: m.name || m.id,
      })
    }
  }
  return out
}
