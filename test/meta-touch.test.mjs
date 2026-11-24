import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { entryHash, readMetaSync, refreshMeta, writeEntries } from '../lib/store.js'

async function withTempHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-persona-meta-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

test('refreshMeta moves lastTouchedAt only for the hashes handed to it', async () => {  await withTempHome(async () => {
    const a = '条目甲'
    const b = '条目乙'
    await writeEntries('touch', 'memory', [a, b])
    await refreshMeta('touch', { at: '2026-11-01T00:00:00Z' })
    const first = readMetaSync('touch')
    assert.equal(first.entries[entryHash(a)].lastTouchedAt, '2026-11-01T00:00:00Z')
    assert.equal(first.entries[entryHash(a)].createdAt, '2026-11-01T00:00:00Z')

    await refreshMeta('touch', { at: '2026-11-20T00:00:00Z', touched: new Set([entryHash(a)]) })
    const next = readMetaSync('touch')
    assert.equal(next.entries[entryHash(a)].lastTouchedAt, '2026-11-20T00:00:00Z', '被处理的条目要刷新')
    assert.equal(next.entries[entryHash(b)].lastTouchedAt, '2026-11-01T00:00:00Z', '没被处理的条目保持原样')
    assert.equal(next.entries[entryHash(b)].createdAt, '2026-11-01T00:00:00Z', 'createdAt 不该被刷新')
  })
})

test('origin is written for new entries only, never back-filled', async () => {
  await withTempHome(async () => {
    const oldEntry = '早就存在的条目'
    await writeEntries('origin', 'memory', [oldEntry])
    await refreshMeta('origin', { at: '2026-11-01T00:00:00Z' })
    assert.equal(readMetaSync('origin').entries[entryHash(oldEntry)].origin, null, '老条目不该被补来源')

    const fresh = '后来写入的条目'
    await writeEntries('origin', 'memory', [oldEntry, fresh])
    await refreshMeta('origin', {
      at: '2026-11-20T00:00:00Z',
      origin: { kind: 'review', sessionId: 'session-1', cwd: 'C:\\work\\proj' },
    })
    const meta = readMetaSync('origin')
    assert.equal(meta.entries[entryHash(oldEntry)].origin, null, '老条目仍然没有来源')
    assert.deepEqual(meta.entries[entryHash(fresh)].origin, {
      kind: 'review',
      sessionId: 'session-1',
      cwd: 'C:\\work\\proj',
      at: '2026-11-20T00:00:00Z',
    })
  })
})
