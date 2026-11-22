import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditPersona, formatAudit } from '../lib/audit.js'
import { writeTopic, writeTopicManifest } from '../lib/topics.js'
import { entryHash, refreshMeta, writeEntries } from '../lib/store.js'

async function withTempHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-persona-kit-audit-'))
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

const kinds = (report) => report.findings.map((item) => item.kind)

test('a healthy persona has no structural errors', async () => {
  await withTempHome(async () => {
    await writeEntries('clean', 'memory', ['项目用 pnpm 而不是 npm'])
    await writeEntries('clean', 'user', ['用户偏好简洁回答'])
    await writeTopic('clean', { slug: 'printer', summary: '打印机卡纸怎么处理', keywords: ['打印机'], content: '先查纸路再换鼓。' })
    await writeTopicManifest('clean')
    await refreshMeta('clean')
    const report = auditPersona('clean', { limits: { user: 1375, memory: 3000 } })
    assert.equal(report.errors, 0, formatAudit(report))
  })
})

test('an entry nobody touched for months is reported as stale', async () => {
  await withTempHome(async () => {
    const entry = '很久以前写下、再没动过的条目'
    await writeEntries('stale', 'memory', [entry])
    const metaFile = path.join(process.env.DSH_HOME, 'personas', 'stale', 'memory', 'meta.json')
    await writeFile(
      metaFile,
      JSON.stringify({
        version: 2,
        entries: { [entryHash(entry)]: { target: 'memory', createdAt: '2026-01-01T00:00:00Z', lastTouchedAt: '2026-01-01T00:00:00Z', status: 'active' } },
      }),
      'utf8',
    )
    const report = auditPersona('stale', { limits: { user: 1375, memory: 3000 } })
    const stale = report.findings.find((item) => item.kind === 'stale-entry')
    assert.ok(stale, '超过 90 天未动应当提醒')
    assert.equal(stale.level, 'advisory')

    const off = auditPersona('stale', { limits: { user: 1375, memory: 3000 }, staleDays: 0 })
    assert.equal(off.findings.some((item) => item.kind === 'stale-entry'), false, 'staleDays: 0 要能关掉')
  })
})

test('same wording with different numbers is a conflict, not a duplicate', async () => {
  await withTempHome(async () => {
    await writeEntries('conf', 'memory', ['发布窗口：周四 18:00 之后不发版', '发布窗口：周四 20:00 之后不发版'])
    await refreshMeta('conf')
    const report = auditPersona('conf', { limits: { user: 1375, memory: 3000 } })
    const conflict = report.findings.find((item) => item.kind === 'conflict-suspect')
    assert.ok(conflict, '措辞相同、数字不同应当提示')
    assert.equal(conflict.level, 'advisory', '是不是改了口径要人判断，只提醒不报错')
    assert.equal(report.findings.some((item) => item.kind === 'entry-near-duplicate'), false, '不能当成重复条目报错')
  })
})

test('duplicate facts are reported, inside a tier and across tiers', async () => {
  await withTempHome(async () => {
    await writeEntries('dupes', 'memory', ['项目一律用 pnpm 安装依赖', '项目一律用 pnpm 安装依赖'])
    await writeEntries('dupes', 'user', ['项目一律用 pnpm 安装依赖，不生成锁文件'])
    await refreshMeta('dupes')
    const report = auditPersona('dupes', { limits: { user: 1375, memory: 3000 } })
    assert.ok(kinds(report).includes('entry-duplicate'))
    assert.ok(kinds(report).includes('cross-tier-duplicate'))
    assert.ok(report.errors >= 2)
  })
})

test('an empty topic summary and near-duplicate topics are errors', async () => {
  await withTempHome(async () => {
    const dir = path.join(process.env.DSH_HOME, 'personas', 'topics', 'topics')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'blank.md'), '---\nslug: blank\nsummary:\nupdated: 2026-11-15\n---\n\n正文。\n', 'utf8')
    await writeFile(path.join(dir, 'a.md'), '---\nslug: a\nsummary: 打印机卡纸怎么处理\nupdated: 2026-11-15\n---\n\n先查纸路再换鼓。\n', 'utf8')
    await writeFile(path.join(dir, 'b.md'), '---\nslug: b\nsummary: 打印机卡纸怎么处理\nupdated: 2026-11-15\n---\n\n先查纸路再换鼓。\n', 'utf8')
    await writeEntries('topics', 'memory', ['项目用 pnpm'])
    await refreshMeta('topics')
    const report = auditPersona('topics', { limits: { user: 1375, memory: 3000 } })
    assert.ok(kinds(report).includes('topic-empty-summary'))
    assert.ok(kinds(report).includes('topic-near-duplicate'))
  })
})

test('a broken or contradictory policy is reported', async () => {
  await withTempHome(async () => {
    await writeEntries('pol', 'memory', ['项目用 pnpm'])
    await refreshMeta('pol')
    const dir = path.join(process.env.DSH_HOME, 'personas', 'pol', 'memory')
    await writeFile(path.join(dir, 'policy.json'), '{ nope', 'utf8')
    const broken = auditPersona('pol', { limits: { user: 1375, memory: 3000 } })
    assert.ok(kinds(broken).includes('policy-unreadable'))

    await writeFile(path.join(dir, 'policy.json'), JSON.stringify({ version: 1, limits: { memory: 1200 } }), 'utf8')
    const differing = auditPersona('pol', { limits: { user: 1375, memory: 3000 } })
    assert.ok(kinds(differing).includes('policy-limits-differ'))
  })
})

test('meta that no longer matches the files is reported as drift', async () => {
  await withTempHome(async () => {
    await writeEntries('drift', 'memory', ['第一条'])
    // no refreshMeta call: the file exists, the meta map does not
    const report = auditPersona('drift', { limits: { user: 1375, memory: 3000 } })
    assert.ok(kinds(report).includes('meta-drift'))
  })
})
