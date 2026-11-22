import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRows, scoreRow } from '../scripts/bench.mjs'
import { readRecords, toRow } from '../scripts/import-bench.mjs'

const topics = [
  { slug: 'deploy', summary: '部署步骤与回滚', keywords: ['部署', '回滚'], body: '先 staging 再生产。' },
  { slug: 'oncall', summary: '值班与告警升级', keywords: ['值班'], body: 'P1 五分钟响应。' },
]

test('bench rows skip blank lines, comments and bad JSON instead of crashing', () => {
  const text = [
    '# 注释行',
    '',
    JSON.stringify({ q: '部署怎么做', expect: ['deploy'] }),
    '{"q": ""}',
    '{not json}',
    JSON.stringify({ q: '值班怎么排', expect: 'oncall', split: 'test' }),
  ].join('\n')
  const { rows, bad } = parseRows(text)
  assert.equal(rows.length, 2)
  assert.equal(bad, 2, '空问题与坏 JSON 都要计入坏行')
})

test('scoring reports hit@1, hit@N, injected characters and latency', () => {
  const hit = scoreRow({ q: '部署步骤', expect: ['deploy'] }, topics, { topN: 3, budget: 400 })
  assert.equal(hit.at1, true)
  assert.equal(hit.atN, true)
  assert.equal(hit.got, 'deploy')
  assert.ok(hit.chars > 0)
  assert.ok(hit.ms >= 0)

  const miss = scoreRow({ q: '艺术考级政策', expect: ['deploy'] }, topics, { topN: 3, budget: 400 })
  assert.equal(miss.at1, false)

  // 负例：不该召回任何东西
  const negative = scoreRow({ q: '完全无关的问题', expect: null }, topics, { topN: 3, budget: 400 })
  assert.equal(negative.at1, true, '负例在没有命中时算通过')

  // 负例的判据与 probe 一致：召回了但分数低于阈值，也算"正确地没召回"
  const weak = scoreRow({ q: '值班', expect: null }, topics, { topN: 3, budget: 400, threshold: 0 })
  assert.equal(weak.got, 'oncall', '这条查询确实会召回')
  assert.equal(weak.at1, false, '阈值调到 0 时，任何召回都算误召回')
})

test('the importer maps fields and keeps negative cases', () => {
  const arrayText = JSON.stringify([
    { question: '部署步骤', gold: 'deploy', kind: 'tune' },
    { question: '无关问题', gold: '', kind: 'test' },
    { gold: 'deploy' },
  ])
  const { records, dropped } = readRecords(arrayText)
  assert.equal(records.length, 3)
  assert.equal(dropped, 0)

  const first = toRow(records[0], { question: 'question', expect: 'gold', split: 'kind' })
  assert.deepEqual(first, { q: '部署步骤', expect: ['deploy'], split: 'tune' })
  const second = toRow(records[1], { question: 'question', expect: 'gold', split: 'kind' })
  assert.equal(second.expect, null, '空答案 = 负例')
  assert.equal(toRow(records[2], { question: 'question', expect: 'gold' }), null, '没有问题就丢掉')
})

test('the importer also reads JSONL', () => {
  const jsonl = [JSON.stringify({ q: 'a', expect: ['x'] }), JSON.stringify({ q: 'b' }), 'oops'].join('\n')
  const { records, dropped } = readRecords(jsonl)
  assert.equal(records.length, 2)
  assert.equal(dropped, 1)
})
