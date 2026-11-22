import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionShort, sourceLabel } from '../lib/client/review-source.js'

test('each provenance maps to a label the panel can show', () => {
  assert.equal(sourceLabel({ via: 'cwd', cwd: 'C:\\proj' }).text, '工作区')
  assert.equal(sourceLabel({ via: 'pool', cwd: 'C:\\x' }).text, '未认领池')
  assert.equal(sourceLabel({ via: 'no-cwd' }).text, '无工作目录')
  assert.equal(sourceLabel({ via: 'index-error' }).text, '名册错误')
})

test('池子与名册错误带 warn tone，工作区不带', () => {
  assert.equal(sourceLabel({ via: 'cwd' }).tone, '')
  assert.equal(sourceLabel({ via: 'pool' }).tone, 'warn')
  assert.equal(sourceLabel({ via: 'index-error' }).tone, 'warn')
})

test('the tooltip carries the directory and the session', () => {
  const label = sourceLabel({ via: 'pool', cwd: 'C:\\A\\work', sessionId: 'session-495e78e2-b0c7-442d-b392-4a6b5b8861e4' })
  assert.match(label.title, /C:\\A\\work/)
  assert.match(label.title, /session-495e78e2/)
  assert.match(label.title, /未认领/)
})

test('records written before 0.13.4 say so instead of pretending to know', () => {
  const label = sourceLabel({ at: '2026-11-01T00:00:00Z', persona: '甲' })
  assert.equal(label.text, '旧记录')
  assert.match(label.title, /0\.13\.4/)
})

test('missing or odd input never throws', () => {
  assert.equal(sourceLabel(null).text, '未知')
  assert.equal(sourceLabel({ via: 42 }).text, '旧记录')
  const id = 'session-495e78e2-b0c7-442d-b392-4a6b5b8861e4'
  assert.equal(sessionShort(id), id.slice(-8))
  assert.equal(sessionShort('short'), 'short')
  assert.equal(sessionShort(undefined), '')
})
