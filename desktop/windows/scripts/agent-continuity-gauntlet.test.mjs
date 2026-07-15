import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const driver = path.join(root, 'scripts', 'agent-continuity-gauntlet.mjs')

test('Windows agent continuity gauntlet self-check validates wiring and names known gaps', () => {
  const result = spawnSync(process.execPath, [driver, '--self-check'], {
    cwd: root,
    encoding: 'utf8'
  })

  expect(result.status, result.stderr || result.stdout).toBe(0)
  expect(result.stdout).toMatch(/SELF-CHECK PASS/)
  expect(result.stdout).toMatch(/synthetic PTT text/i)
  expect(result.stdout).toMatch(/legacy_sse/i)
  expect(result.stdout).toMatch(/owner isolation/i)
})

test('Windows agent continuity gauntlet refuses an implicit or primary live target', () => {
  const implicit = spawnSync(process.execPath, [driver], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, OMI_GAUNTLET_CDP_PORT: '' }
  })
  expect(implicit.status).toBe(1)
  expect(implicit.stderr).toMatch(/explicit --cdp-port/i)

  const primary = spawnSync(process.execPath, [driver, '--cdp-port', '9222'], {
    cwd: root,
    encoding: 'utf8'
  })
  expect(primary.status).toBe(1)
  expect(primary.stderr).toMatch(/refuses the canonical primary/i)
}, 15_000)
