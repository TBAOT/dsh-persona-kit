import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyOperation,
  applyOperations,
  applyRethink,
  entryAgeDays,
  staleEntries,
  withPersonaLock,
  entryHash,
  visibleEntries,
  formatEntries,
  inspectContent,
  parseEntries,
  renderBlock,
  sanitizeId,
  similarity,
  MERGE_SIMILARITY,
  totalChars,
  usage,
} from '../lib/store.js'

test('parse and format round-trip', () => {
  const entries = ['第一件事\n第二行', '第二件事']
  const text = formatEntries('memory', entries)
  assert.match(text, /^<!-- dsh-persona-kit v1 target=memory -->/)
  assert.deepEqual(parseEntries(text), entries)
})

test('empty file parses to no entries', () => {
  assert.deepEqual(parseEntries(''), [])
  assert.deepEqual(parseEntries('<!-- dsh-persona-kit v1 target=user -->\n'), [])
})

test('a header from before the 0.12.0 rename is not read back as an entry', () => {
  // Renaming the package changed HEADER_PREFIX; files written by older versions still
  // start with `<!-- dsh-persona v1 …`. If the parser only knew the new prefix, every
  // such file would gain a junk entry, and an empty tier would look like one fact.
  assert.deepEqual(parseEntries('<!-- dsh-persona v1 target=user -->'), [])
  assert.deepEqual(parseEntries('<!-- dsh-persona v1 target=memory -->\n项目用 pnpm'), ['项目用 pnpm'])
})

test('add rejects exact duplicate', () => {
  const first = applyOperation([], { action: 'add', content: '偏好简洁回答' })
  assert.equal(first.ok, true)
  const again = applyOperation(first.entries, { action: 'add', content: '偏好简洁回答' })
  assert.equal(again.ok, false)
  assert.match(again.error, /完全相同/)
})

test('patch replaces only the matched span', () => {
  const result = applyOperation(['用户用 npm 装依赖'], {
    action: 'patch',
    old_text: 'npm',
    content: 'pnpm',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, ['用户用 pnpm 装依赖'])
})

test('patch refuses ambiguous match', () => {
  const result = applyOperation(['npm 和 npm'], { action: 'patch', old_text: 'npm', content: 'pnpm' })
  assert.equal(result.ok, false)
  assert.match(result.error, /命中 2 处/)
})

test('remove deletes exactly one entry', () => {
  const result = applyOperation(['保留这条', '删掉这条'], { action: 'remove', old_text: '删掉' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, ['保留这条'])
})

test('remove refuses ambiguous match across entries', () => {
  const result = applyOperation(['项目 A', '项目 B'], { action: 'remove', old_text: '项目' })
  assert.equal(result.ok, false)
  assert.match(result.error, /多个条目/)
})

test('batch over the limit is refused and reports the deficit', () => {
  const limit = 20
  const result = applyOperations([], [{ action: 'add', content: 'x'.repeat(30) }], limit)
  assert.equal(result.ok, false)
  assert.ok(result.overflow > 0)
  assert.match(result.error, /超出/)
})

test('batch may free space then add within the limit', () => {
  const limit = 30
  const start = ['a'.repeat(20)]
  const result = applyOperations(
    start,
    [
      { action: 'remove', old_text: 'a'.repeat(20) },
      { action: 'add', content: 'b'.repeat(20) },
    ],
    limit,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, ['b'.repeat(20)])
})

test('invisible characters are refused', () => {
  const result = inspectContent('正常文本\u200B隐藏')
  assert.equal(result.ok, false)
  assert.match(result.error, /不可见/)
})

test('secret-shaped content is refused', () => {
  assert.equal(inspectContent('key sk-' + 'a'.repeat(24)).ok, false)
  assert.equal(inspectContent('-----BEGIN RSA PRIVATE KEY-----').ok, false)
})

test('sanitizeId keeps safe ids and falls back', () => {
  assert.equal(sanitizeId('Work.A_1'), 'work.a_1')
  assert.equal(sanitizeId('../evil'), 'default')
  assert.equal(sanitizeId(''), 'default')
})

test('usage and render include percent header', () => {
  const entries = ['abc']
  const size = usage(entries, 10)
  assert.equal(size.used, 3)
  assert.equal(size.percent, 30)
  const block = renderBlock('标题', entries, 10)
  assert.match(block, /^## 标题 \[30% — 3\/10 字符\]/)
  assert.match(block, /- abc/)
})

test('totalChars accounts for separators', () => {
  assert.equal(totalChars(['ab', 'cd']), 4 + '\n§\n'.length)
})

test('a resident entry is one fact, so an add over 120 characters is refused with a hint', () => {
  const long = '这是一条很长的正文，把过程、命令、参数和对照数据全塞进常驻条目里，导致索引层被正文占满。'.repeat(3)
  const result = applyOperation([], { action: 'add', content: long })
  assert.equal(result.ok, false)
  assert.match(result.error, /120 字上限/)
  assert.match(result.error, /topic/)
})

test('a patch is how a legacy long entry gets shorter, so it is not capped', () => {
  const legacy = `前缀标记${'旧'.repeat(200)}`
  const shorter = applyOperation([legacy], { action: 'patch', old_text: '前缀标记', content: '简称' })
  assert.equal(shorter.ok, true)
  assert.ok(shorter.entries[0].length < legacy.length)
})

test('rethink replaces the whole tier, with guards against a sweep', () => {
  const tier = ['一条事实甲', '一条事实乙', '一条事实丙', '一条事实丁']
  const ok = applyRethink(tier, '合并后的事实甲\n合并后的事实乙\n合并后的事实丙', 3000)
  assert.equal(ok.ok, true)
  assert.equal(ok.entries.length, 3)
  assert.equal(ok.rethought, true)

  // Dropping more than a third of the facts is refused outright.
  const sweep = applyRethink(tier, '只剩一条', 3000)
  assert.equal(sweep.ok, false)
  assert.match(sweep.error, /2\/3/)

  const duplicated = applyRethink(tier, '甲\n甲\n乙\n丙', 3000)
  assert.equal(duplicated.ok, false)

  const overlong = applyRethink(tier, `${'长'.repeat(140)}\n乙\n丙`, 3000)
  assert.equal(overlong.ok, false)

  const tooBig = applyRethink(tier, `${'甲'.repeat(60)}\n${'乙'.repeat(60)}\n${'丙'.repeat(60)}`, 100)
  assert.equal(tooBig.ok, false)
  assert.match(tooBig.error, /超上限/)
})

test('a near-duplicate add rewrites the existing entry instead of stacking up', () => {
  const existing = ['项目一律用 pnpm，不生成 package-lock.json']
  const merged = applyOperation(existing, { action: 'add', content: '项目一律用 pnpm，不生成 package-lock.json 文件' })
  assert.equal(merged.ok, true)
  assert.equal(merged.entries.length, 1)
  assert.match(merged.entries[0], /pnpm/)
  assert.match(merged.mergedInto, /^[0-9a-f]{12}$/)
  // The rewrite is reported, not silent: the caller shows what it replaced.
  assert.match(merged.replacedText, /package-lock/)

  const fresh = applyOperation(existing, { action: 'add', content: '打印机墨盒芯片读不到时换墨盒即可' })
  assert.equal(fresh.ok, true)
  assert.equal(fresh.entries.length, 2)
  assert.equal(fresh.mergedInto, undefined)
})
test('per-persona writes are serialised, so no batch is lost', async () => {
  const order = []
  const run = (tag, delay) =>
    withPersonaLock('slot-x', async () => {
      order.push(`${tag}:start`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      order.push(`${tag}:end`)
    })
  await Promise.all([run('a', 20), run('b', 1)])
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end'])
})
test('a nearly full tier refuses new entries but still accepts rewrites and removals', () => {
  const limit = 200
  const base = '项目约定一律用 pnpm 安装依赖并且不生成锁文件；'
  const full = [`${base.repeat(7)} ZETA`]
  assert.ok(full[0].length >= limit * 0.9)

  const diverted = applyOperations(
    full,
    [{ action: 'add', content: '打印机墨盒读不到时换一支即可', topic: 'printer', summary: '墨盒读不到就换一支' }],
    limit,
  )
  assert.equal(diverted.ok, true)
  assert.equal(diverted.redirects.length, 1)
  assert.equal(diverted.entries.length, 1)
  // The summary must survive the redirect: without it the index line is a bare
  // slug, and the head carries 70% of the recall score.
  assert.equal(diverted.redirects[0].summary, '墨盒读不到就换一支')
  assert.equal(diverted.redirects[0].slugHint, 'printer')

  const refused = applyOperations(full, [{ action: 'add', content: '再来一条' }], limit, { addOverflow: 'reject' })
  assert.equal(refused.ok, false)
  assert.equal(refused.blocked, 'threshold')

  // A near-duplicate add is a rewrite, and a rewrite is never routed away by the
  // threshold — that is how a full tier gets smaller instead of spawning topics.
  const twinTier = ['项目约定一律用 pnpm 安装依赖并且不生成锁文件；'.repeat(3)]
  const merged = applyOperations(twinTier, [{ action: 'add', content: '项目约定一律用 pnpm 安装依赖并且不生成锁文件' }], limit)
  assert.equal(merged.ok, true, merged.error)
  assert.equal(merged.entries.length, 1)
  assert.equal(merged.redirects.length, 0)

  const patched = applyOperations(full, [{ action: 'patch', old_text: 'ZETA', content: 'ZETA（严格）' }], limit)
  assert.equal(patched.ok, true)

  const removed = applyOperations(full, [{ action: 'remove', old_text: 'ZETA' }], limit)
  assert.equal(removed.ok, true)

  const disabled = applyOperations(full, [{ action: 'add', content: '再来一条' }], limit, { routeThreshold: 0 })
  assert.equal(disabled.ok, true)
})
test('expired and superseded entries stop being injected but stay in the file', () => {
  const active = '仍然有效的规则'
  const expired = '早就该退场的事实'
  const replaced = '被新条目推翻的旧事实'
  const meta = {
    entries: {
      [entryHash(expired)]: { status: 'active', expiresAt: '2000-01-01' },
      [entryHash(replaced)]: { status: 'superseded', invalidAt: '2026-01-01T00:00:00Z' },
    },
  }
  const visible = visibleEntries([active, expired, replaced], meta, '2026-11-14')
  assert.deepEqual(visible, [active])
  assert.equal(visibleEntries([active, expired], { entries: {} }, '2026-11-14').length, 2)
})

test('supersedes replaces the contradicted entry in place and records the chain', () => {
  const old = '发布窗口：周四 18:00 之后不发版'
  const next = '发布窗口改成工作日 10 点到 16 点'
  // 相似度不高（<0.8），所以没有 supersedes 时会被当成两条并存——这正是要修的问题
  assert.ok(similarity(old, next) < MERGE_SIMILARITY)

  const single = applyOperation([old], { action: 'add', content: next, supersedes: entryHash(old).slice(0, 6) })
  assert.equal(single.ok, true)
  assert.deepEqual(single.entries, [next], '新事实占据旧位置，旧的整条被替换')
  assert.equal(single.supersededHash, entryHash(old))
  assert.equal(single.explicit, true)

  const batch = applyOperations([old], [{ action: 'add', content: next, supersedes: old }], 500)
  assert.equal(batch.ok, true)
  assert.deepEqual(batch.entries, [next])
  assert.equal(batch.superseded[entryHash(old)], entryHash(next), '失效链要写进 superseded')
  assert.equal(batch.replaced.length, 1)
})

test('an unknown or ambiguous supersedes is refused instead of guessing', () => {  const unknown = applyOperation(['甲条'], { action: 'add', content: '新事实', supersedes: 'deadbeef1234' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /没有命中/)

  const ambiguous = applyOperation(['项目用 pnpm 构建', '项目用 pnpm 测试'], {
    action: 'add',
    content: '项目用 pnpm 发布',
    supersedes: '项目用 pnpm',
  })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.error, /命中 2 条/)
})

test('staleness counts only entries that were actually handled', () => {
  const now = Date.parse('2026-11-22T00:00:00Z')
  const fresh = '刚被处理过的条目'
  const old = '很久没人动的条目'
  const freshHash = entryHash(fresh)
  const oldHash = entryHash(old)
  const meta = {
    entries: {
      [freshHash]: { target: 'memory', createdAt: '2026-01-01T00:00:00Z', lastTouchedAt: '2026-11-20T00:00:00Z' },
      [oldHash]: { target: 'memory', createdAt: '2026-01-01T00:00:00Z', lastTouchedAt: '2026-01-02T00:00:00Z' },
    },
  }
  assert.equal(entryAgeDays(meta.entries[freshHash], now), 2)
  const stale = staleEntries([fresh, old], meta, { days: 30, now })
  assert.deepEqual(stale.map((item) => item.text), [old])
  assert.ok(stale[0].age > 300)

  // 用户画像档默认不参与淘汰排序：偏好停用不等于失效
  const userMeta = { entries: { [oldHash]: { target: 'user', createdAt: '2025-01-01T00:00:00Z' } } }
  assert.deepEqual(staleEntries([old], userMeta, { days: 30, now }), [])
  assert.equal(staleEntries([old], userMeta, { days: 30, now, targets: ['user'] }).length, 1)

  // 排序与上限：最久的在前，limit 生效
  const meta3 = {
    entries: {
      [entryHash('a')]: { target: 'memory', lastTouchedAt: '2025-01-01T00:00:00Z' },
      [entryHash('b')]: { target: 'memory', lastTouchedAt: '2025-06-01T00:00:00Z' },
      [entryHash('c')]: { target: 'memory', lastTouchedAt: '2025-09-01T00:00:00Z' },
    },
  }
  const ordered = staleEntries(['a', 'b', 'c'], meta3, { days: 1, now, limit: 2 })
  assert.deepEqual(ordered.map((item) => item.text), ['a', 'b'])
  assert.ok(ordered[0].age > ordered[1].age)
})