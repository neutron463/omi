// The export-destination catalog + delivery-tier metadata. Pure data, no I/O.
//
// Port of macOS `MemoryExportDestination` (`desktop/macos/Desktop/Sources/
// MemoryExportService.swift`), frozen reference v0.12.72. The 10 cases and their
// three delivery tiers drive the unified-connectors UI at all entry points
// (Memories page, onboarding data-sources step, Apps hub). Waves C/D/E consume
// this; keep the tier sets in lockstep with the Swift source.

export type MemoryExportDestination =
  | 'notion'
  | 'obsidian'
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'agents'
  | 'claudeCode'
  | 'codex'
  | 'openclaw'
  | 'hermes'

// How a live MCP connection is actually carried out for a destination:
//  - localAutonomous: deterministic local CLI/config/file write, no browser.
//  - assisted: Omi opens the destination + copies a value; user finishes manually.
//  - browserAutonomous: currently unmapped to any case (ChatGPT/Claude moved off
//    it because cross-browser AX automation was too brittle). Kept for parity.
export type McpExecuteKind = 'localAutonomous' | 'assisted' | 'browserAutonomous'

export interface DestinationMeta {
  id: MemoryExportDestination
  label: string
  supportsMemoryPack: boolean // one-time Markdown copy/paste. "MANUAL" tag.
  supportsMCP: boolean // live MCP connection. "AUTOMATIC" tag.
  mcpExecuteKind: McpExecuteKind
  supportsAgentSetup: boolean // 'agents' only
  hasLocallyVerifiableLiveSetup: boolean
}

// Tier membership, verbatim from the Swift computed properties (title/
// supportsMemoryPack/supportsMCP/mcpExecuteKind/supportsAgentSetup/
// hasLocallyVerifiableLiveSetup). `agents` resolves to `.assisted` in Swift
// (MemoryExportService.swift:169) — the brief omitted it, source is authoritative.
const DESTINATIONS: DestinationMeta[] = [
  meta('notion', 'Notion', { memoryPack: true, kind: 'assisted' }),
  meta('obsidian', 'Obsidian', { memoryPack: true, kind: 'assisted' }),
  meta('chatgpt', 'ChatGPT', { memoryPack: true, mcp: true, kind: 'assisted' }),
  meta('claude', 'Claude', { memoryPack: true, mcp: true, kind: 'assisted' }),
  meta('gemini', 'Gemini', { memoryPack: true, kind: 'assisted' }),
  meta('agents', 'AI Agents', { kind: 'assisted', agentSetup: true, verifiable: true }),
  meta('claudeCode', 'Claude Code', { mcp: true, kind: 'localAutonomous', verifiable: true }),
  meta('codex', 'Codex', { mcp: true, kind: 'localAutonomous', verifiable: true }),
  meta('openclaw', 'OpenClaw', { mcp: true, kind: 'localAutonomous', verifiable: true }),
  meta('hermes', 'Hermes', { mcp: true, kind: 'localAutonomous', verifiable: true })
]

function meta(
  id: MemoryExportDestination,
  label: string,
  opts: {
    memoryPack?: boolean
    mcp?: boolean
    kind: McpExecuteKind
    agentSetup?: boolean
    verifiable?: boolean
  }
): DestinationMeta {
  return {
    id,
    label,
    supportsMemoryPack: opts.memoryPack ?? false,
    supportsMCP: opts.mcp ?? false,
    mcpExecuteKind: opts.kind,
    supportsAgentSetup: opts.agentSetup ?? false,
    hasLocallyVerifiableLiveSetup: opts.verifiable ?? false
  }
}

const BY_ID: Record<MemoryExportDestination, DestinationMeta> = Object.fromEntries(
  DESTINATIONS.map((d) => [d.id, d])
) as Record<MemoryExportDestination, DestinationMeta>

/** All destinations in canonical (enum) order. */
export function listDestinations(): DestinationMeta[] {
  return DESTINATIONS
}

/** Metadata for one destination. Throws on an unknown id — the type already
 *  bounds callers, so a miss means a programming error, not user input. */
export function getDestination(id: MemoryExportDestination): DestinationMeta {
  const found = BY_ID[id]
  if (!found) throw new Error(`Unknown export destination: ${id}`)
  return found
}

/**
 * Hosted MCP server URL (used by Waves B/E to mint keys + probe connections).
 * Mirrors Mac's `mcpServerURL = "{mcpBaseURL}v1/mcp/sse"` where mcpBaseURL is the
 * Python backend base — Windows' `VITE_OMI_DESKTOP_API_BASE` (same base the
 * desktopApi client and geminiClient use). Trailing slash normalized so the
 * result always ends in exactly `/v1/mcp/sse`.
 */
export function mcpServerURL(): string {
  const base = (import.meta.env.VITE_OMI_DESKTOP_API_BASE as string) ?? ''
  return `${base.replace(/\/+$/, '')}/v1/mcp/sse`
}
