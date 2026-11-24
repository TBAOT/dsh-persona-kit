import assert from 'node:assert/strict'
import test from 'node:test'
import { convertInstance, renderSession, summarise } from '../scripts/import-longmemeval.mjs'

const instance = {
  question_id: 'q1',
  question_type: 'multi-session',
  question: '我上次说的发布窗口是几点？',
  haystack_session_ids: ['sess-a', 'sess-b'],
  haystack_dates: ['2026-11-01T10:00:00Z', '2026-11-05T10:00:00Z'],
  haystack_sessions: [
    [
      { role: 'user', content: '我们周四 18:00 之后不发版' },
      { role: 'assistant', content: '记住了' },
    ],
    [{ role: 'user', content: '周末要不要热修？' }],
  ],
  answer_session_ids: ['sess-a'],
}

test('a session becomes one topic with a readable summary', () => {
  const body = renderSession(instance.haystack_sessions[0])
  assert.equal(body, 'user: 我们周四 18:00 之后不发版\nassistant: 记住了')
  assert.equal(summarise(instance.haystack_sessions[0]), '我们周四 18:00 之后不发版')
  assert.equal(renderSession([]), '')
})

test('the gold evidence session maps to its topic slug', () => {
  const converted = convertInstance(instance)
  assert.equal(converted.persona, 'q1')
  assert.equal(converted.topics.length, 2)
  assert.deepEqual(converted.topics.map((topic) => topic.slug), ['s0', 's1'])
  assert.equal(converted.topics[0].updated, '2026-11-01')
  assert.deepEqual(converted.row.expect, ['s0'], 'answer_session_ids → s0')
  assert.equal(converted.row.split, 'multi-session')
})

test('an abstention question has no expected topic', () => {
  const abstention = convertInstance({ ...instance, question_id: 'q2_abs', answer_session_ids: [] })
  assert.equal(abstention.row.expect, null)
})
