import assert from 'node:assert/strict'
import test from 'node:test'
import { cosine, gramVector, makeSemanticScorer, topicText } from '../lib/semantic.js'

test('identical text scores 1, unrelated text scores near 0', () => {
  const a = gramVector('发布流程与回滚')
  assert.equal(cosine(a, gramVector('发布流程与回滚')), 1)
  assert.ok(cosine(a, gramVector('艺术考级政策')) < 0.15)
  assert.equal(cosine(a, gramVector('')), 0)
})

test('paraphrase overlaps more than an unrelated subject', () => {
  const topic = gramVector('部署步骤与回滚检查项')
  const near = cosine(gramVector('怎么发版和回滚'), topic)
  const far = cosine(gramVector('学员请假规则'), topic)
  assert.ok(near > far, `paraphrase ${near} 应高于 unrelated ${far}`)
})

test('the scorer is deterministic and returns a number in [0, 1]', () => {
  const topic = { slug: '部署手册', summary: '部署步骤与回滚', keywords: ['部署', '回滚'], body: '先 staging 再生产。' }
  const first = makeSemanticScorer()('怎么发版', topic)
  const second = makeSemanticScorer()('怎么发版', topic)
  assert.equal(first, second)
  assert.ok(first >= 0 && first <= 1)
})

test('the scored text includes summary, aliases and body head', () => {
  const text = topicText({ slug: 'x', summary: '摘要词', keywords: ['别名甲'], body: '正文词' })
  assert.match(text, /摘要词/)
  assert.match(text, /别名甲/)
  assert.match(text, /正文词/)
})
