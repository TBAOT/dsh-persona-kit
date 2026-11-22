import assert from 'node:assert/strict'
import test from 'node:test'
import { splitChunks } from '../lib/chunks.js'
import { selectTopics, sliceFor } from '../lib/recall.js'

const body = [
  '## 2026-11-20',
  '',
  '先 staging 再生产，出现 5xx 立即回滚到上一个 tag。',
  '',
  '## 2026-11-10',
  '',
  '发布窗口是工作日 10 点到 18 点。',
].join('\n')

test('dated headings are dropped and paragraphs become slices', () => {
  assert.deepEqual(splitChunks(body), [
    '先 staging 再生产，出现 5xx 立即回滚到上一个 tag。',
    '发布窗口是工作日 10 点到 18 点。',
  ])
})

test('a short fragment without punctuation joins the previous slice', () => {
  const chunks = splitChunks('第一段是一句完整的话。\n\n补充\n\n第二段也只有一句。')
  assert.equal(chunks.length, 2)
  assert.match(chunks[0], /补充/)
})

test('an over-long paragraph is cut at a sentence boundary', () => {
  const long = `${'甲'.repeat(100)}。${'乙'.repeat(100)}。`
  const [chunk] = splitChunks(long, { max: 120 })
  assert.ok(chunk.length <= 121)
  assert.match(chunk, /。$/)
})

test('the slice that answers the query is the one quoted', () => {
  const topic = { slug: 'deploy', summary: '部署与回滚', body }
  const slice = sliceFor('出现 5xx 怎么办', topic)
  assert.match(slice.text, /5xx/)
  assert.equal(sliceFor('完全无关的问题', topic), null)
  assert.equal(sliceFor('回滚', { slug: 'x', body: '' }), null)
})

test('the block carries the slice under the pointer, and can be turned off', () => {
  const topics = [{ slug: 'deploy', summary: '部署与回滚', keywords: ['部署'], body }]
  const withSlices = selectTopics('出现 5xx 怎么回滚', topics, { topN: 2, budget: 400 })
  assert.match(withSlices.block, /^- deploy/m)
  assert.match(withSlices.block, /· .*5xx/)
  assert.equal(withSlices.slices.length, 1)
  assert.equal(withSlices.slices[0].slug, 'deploy')

  const withoutSlices = selectTopics('出现 5xx 怎么回滚', topics, { topN: 2, budget: 400, slices: false })
  assert.match(withoutSlices.block, /^- deploy/m)
  assert.equal(withoutSlices.block.includes('·'), false)
  assert.deepEqual(withoutSlices.slices ?? [], [])
})

test('a slice never pushes the block past its budget', () => {
  const topics = [{ slug: 'deploy', summary: '部署与回滚', keywords: ['部署'], body }]
  const tight = selectTopics('出现 5xx 怎么回滚', topics, { topN: 2, budget: 60 })
  assert.ok(tight.block.length <= 60, `block ${tight.block.length} 超过预算`)
  assert.equal(tight.block.includes('·'), false, '预算紧时只留指针')
})
