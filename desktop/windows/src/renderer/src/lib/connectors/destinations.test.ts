import { describe, it, expect } from 'vitest'
import {
  listDestinations,
  getDestination,
  mcpServerURL,
  type MemoryExportDestination,
  type McpExecuteKind
} from './destinations'

// Pull the members of a tier out of the catalog so the assertions read as the
// exact sets from the Swift source (MemoryExportService.swift), not derived.
function idsWhere(pred: (d: ReturnType<typeof listDestinations>[number]) => boolean): string[] {
  return listDestinations()
    .filter(pred)
    .map((d) => d.id)
    .sort()
}
function idsWithKind(kind: McpExecuteKind): string[] {
  return idsWhere((d) => d.mcpExecuteKind === kind)
}

describe('destinations catalog', () => {
  it('has exactly the 10 destinations in canonical order', () => {
    expect(listDestinations().map((d) => d.id)).toEqual([
      'notion',
      'obsidian',
      'chatgpt',
      'claude',
      'gemini',
      'agents',
      'claudeCode',
      'codex',
      'openclaw',
      'hermes'
    ])
  })

  it('supportsMemoryPack tier = notion, obsidian, chatgpt, claude, gemini', () => {
    expect(idsWhere((d) => d.supportsMemoryPack)).toEqual(
      ['notion', 'obsidian', 'chatgpt', 'claude', 'gemini'].sort()
    )
  })

  it('supportsMCP tier = chatgpt, claude, claudeCode, codex, openclaw, hermes', () => {
    expect(idsWhere((d) => d.supportsMCP)).toEqual(
      ['chatgpt', 'claude', 'claudeCode', 'codex', 'openclaw', 'hermes'].sort()
    )
  })

  it('mcpExecuteKind.localAutonomous = claudeCode, codex, openclaw, hermes', () => {
    expect(idsWithKind('localAutonomous')).toEqual(
      ['claudeCode', 'codex', 'openclaw', 'hermes'].sort()
    )
  })

  it('mcpExecuteKind.assisted = chatgpt, claude, notion, obsidian, gemini, agents', () => {
    // `agents` falls here too (resolved from Swift source, not the brief).
    expect(idsWithKind('assisted')).toEqual(
      ['chatgpt', 'claude', 'notion', 'obsidian', 'gemini', 'agents'].sort()
    )
  })

  it('browserAutonomous maps to no destination (kept as a type only)', () => {
    expect(idsWithKind('browserAutonomous')).toEqual([])
  })

  it('supportsAgentSetup = agents only', () => {
    expect(idsWhere((d) => d.supportsAgentSetup)).toEqual(['agents'])
  })

  it('hasLocallyVerifiableLiveSetup = agents, claudeCode, codex, openclaw, hermes', () => {
    expect(idsWhere((d) => d.hasLocallyVerifiableLiveSetup)).toEqual(
      ['agents', 'claudeCode', 'codex', 'openclaw', 'hermes'].sort()
    )
  })

  it('every destination has a non-empty label', () => {
    for (const d of listDestinations()) expect(d.label.length).toBeGreaterThan(0)
  })

  it('getDestination returns the matching meta', () => {
    expect(getDestination('claude').label).toBe('Claude')
    expect(getDestination('agents').supportsAgentSetup).toBe(true)
  })

  it('getDestination throws on an unknown id', () => {
    expect(() => getDestination('nope' as MemoryExportDestination)).toThrow()
  })
})

describe('mcpServerURL', () => {
  it('ends with /v1/mcp/sse', () => {
    expect(mcpServerURL().endsWith('/v1/mcp/sse')).toBe(true)
  })

  it('does not double a slash when the base has a trailing slash', () => {
    expect(mcpServerURL()).not.toMatch(/\/\/v1\/mcp\/sse$/)
  })
})
