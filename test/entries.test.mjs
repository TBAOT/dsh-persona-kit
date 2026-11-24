import assert from 'node:assert/strict'
import test from 'node:test'
import { joinEntries, moveEntry, splitEntries, validateEntries } from '../lib/client/entries.js'

const rows = ['第一条事实', '第二条事实', '第三条事实']

test('split and join round-trip without changing the stored text', () => {
  const text = rows.join('\n§\n')
  assert.deepEqual(splitEntries(text), rows)
  assert.equal(joinEntries(splitEntries(text)), text)
  assert.deepEqual(splitEntries(''), [])
  assert.equal(joinEntries(['  ', '有内容 ']), '有内容')
})

test('moving a row stays inside the list and never mutates the input', () => {
  const moved = moveEntry(rows, 0, 1)
  assert.deepEqual(moved, ['第二条事实', '第一条事实', '第三条事实'])
  assert.deepEqual(rows, ['第一条事实', '第二条事实', '第三条事实'], '原数组不能被改')

  assert.deepEqual(moveEntry(rows, 0, -1), rows, '越界不动')
  assert.deepEqual(moveEntry(rows, 2, 1), rows)
  assert.deepEqual(moveEntry(rows, 9, 1), rows)
})

test('validation reports the row that is wrong, not just "invalid"', () => {
  const empty = validateEntries(['好的条目', '   '], { entryMaxChars: 120, limit: 500 })
  assert.equal(empty.ok, false)
  assert.equal(empty.errors[0].index, 1)
  assert.match(empty.errors[0].message, /空/)

  const tooLong = validateEntries(['x'.repeat(130)], { entryMaxChars: 120, limit: 500 })
  assert.match(tooLong.errors[0].message, /超过单条上限/)

  const duplicated = validateEntries(['同样一条', '同样一条'], { entryMaxChars: 120, limit: 500 })
  assert.match(duplicated.errors[0].message, /完全相同/)

  const overLimit = validateEntries(['a'.repeat(100), 'b'.repeat(100)], { entryMaxChars: 120, limit: 150 })
  assert.equal(overLimit.ok, false)
  assert.equal(overLimit.errors.at(-1).index, -1)
  assert.match(overLimit.errors.at(-1).message, /合计/)
  assert.equal(overLimit.used, 200 + '\n§\n'.length)

  assert.equal(validateEntries(rows, { entryMaxChars: 120, limit: 500 }).ok, true)
})
