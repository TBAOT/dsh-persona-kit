import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readTopic, replaceTopic, writeTopic } from '../lib/topics.js'

async function withHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-persona-topic-edit-'))
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

test('the panel can replace a topic body, keeping slug, keywords and summary', async () => {
  await withHome(async (home) => {
    await writeTopic('甲', {
      slug: '部署手册',
      summary: '部署步骤与回滚检查项',
      keywords: ['部署', '回滚'],
      content: '旧正文：先说清楚怎么发。',
    })
    const file = path.join(home, 'personas', '甲', 'topics', '部署手册.md')

    const result = await replaceTopic('甲', { slug: '部署手册', body: '新正文：只留结论。', byHuman: true })
    assert.equal(result.ok, true)

    const topic = readTopic(file)
    assert.equal(topic.body.trim(), '新正文：只留结论。', '编辑是替换，不是追加')
    assert.equal(topic.summary, '部署步骤与回滚检查项', '没给摘要就保留原摘要')
    assert.deepEqual(topic.keywords, ['部署', '回滚'], 'keywords 不能被编辑抹掉')
  })
})

test('an edited topic can update its summary, and over-cap edits are refused', async () => {
  await withHome(async () => {
    await writeTopic('甲', { slug: '值班', summary: '旧摘要', content: '正文' })

    const updated = await replaceTopic('甲', { slug: '值班', summary: '新摘要：P1 五分钟响应', body: '正文', byHuman: true })
    assert.equal(updated.ok, true)
    assert.equal(updated.summary, undefined)
    const topic = readTopic(path.join(process.env.DSH_HOME, 'personas', '甲', 'topics', '值班.md'))
    assert.equal(topic.summary, '新摘要：P1 五分钟响应')

    const tooLong = await replaceTopic('甲', { slug: '值班', body: 'x'.repeat(5000), byHuman: true })
    assert.equal(tooLong.ok, false)
    assert.match(tooLong.error, /超出上限/)
  })
})

test('an empty body is refused, and a read-only library only accepts the human path', async () => {
  await withHome(async (home) => {
    await writeTopic('甲', { slug: '值班', content: '正文' })
    const empty = await replaceTopic('甲', { slug: '值班', body: '   ', byHuman: true })
    assert.equal(empty.ok, false)
    assert.match(empty.error, /正文不能为空/)

    const fs = await import('node:fs/promises')
    await fs.mkdir(path.join(home, 'personas', '甲', 'memory'), { recursive: true })
    await fs.writeFile(
      path.join(home, 'personas', '甲', 'memory', 'policy.json'),
      JSON.stringify({ version: 1, readOnly: ['topic'] }),
      'utf8',
    )
    const asAgent = await replaceTopic('甲', { slug: '值班', body: 'agent 想改' })
    assert.equal(asAgent.ok, false)
    assert.match(asAgent.error, /只读/)

    const asHuman = await replaceTopic('甲', { slug: '值班', body: '人来改', byHuman: true })
    assert.equal(asHuman.ok, true)
  })
})

test('replacing a topic that does not exist is refused', async () => {
  await withHome(async () => {
    const result = await replaceTopic('甲', { slug: '没有这篇', body: '正文', byHuman: true })
    assert.equal(result.ok, false)
    assert.match(result.error, /没有这个主题/)
  })
})
