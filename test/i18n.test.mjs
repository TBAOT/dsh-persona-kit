import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * The panel is written in Chinese and translated at render time, so the only way to keep
 * English complete is to compare the source literals with the dictionary. A new Chinese
 * string without an `EN` entry fails here instead of shipping half-translated.
 */
const source = readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client', 'panel.js'), 'utf8')

/** Evaluate one `const NAME = <literal>` assignment out of the source (our own file). */
function evaluate(name) {
  const start = source.indexOf(`const ${name} = `)
  assert.ok(start >= 0, `找不到 ${name}`)
  const from = start + `const ${name} = `.length
  let depth = 0
  let end = -1
  for (let index = from; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) {
        end = index + 1
        break
      }
    } else if (char === "'" || char === '"') {
      const quote = char
      index += 1
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') index += 1
        index += 1
      }
    } else if (depth === 0 && char === ';') {
      end = index
      break
    }
  }
  assert.ok(end > from, `${name} 的边界没找到`)
  const literal = source.slice(from, end)
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literal})`)()
}

const EN = evaluate('EN')
const RULES = evaluate('EN_RULES')
const dictionaryEnd = source.indexOf('const EN_RULES')
const code = source.slice(0, source.indexOf('const EN = {')) + source.slice(dictionaryEnd)

/** Strings that stay Chinese on purpose. */
const ALLOWED = new Set(['切换界面语言 / Switch UI language', '中文'])

test('every Chinese UI literal in the panel has an English entry or a rule', () => {
  const literals = new Set()
  for (const match of code.matchAll(/'((?:[^'\\\n]|\\.)*[\u4e00-\u9fa5](?:[^'\\\n]|\\.)*)'/g)) {
    const text = match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    // 模板串里被正则截到的碎片（`${…}` 两侧的引号）不是独立文案，跳过
    if (text.includes('${') || /^[)},]/.test(text.trim())) continue
    literals.add(text)
  }
  const missing = [...literals].filter((text) => !(text in EN) && !ALLOWED.has(text))
  assert.deepEqual(missing, [], `这些中文串没有英文条目：\n${missing.join('\n')}`)
})

test('the dictionary is complete and free of leftover Chinese', () => {
  const entries = Object.entries(EN)
  assert.ok(entries.length > 80, `英文条目数量偏少：${entries.length}`)
  for (const [key, value] of entries) {
    assert.equal(typeof value, 'string', `${key} 的值不是字符串`)
    assert.ok(value.trim().length > 0, `空翻译：${key}`)
    assert.equal(/[\u4e00-\u9fa5]/.test(value), false, `英文条目里还有中文：${key} → ${value}`)
  }
})

test('composed strings are covered by rules', () => {
  assert.ok(RULES.length >= 10, `组合串规则太少：${RULES.length}`)
  for (const sample of ['3 个工作区', '主题 5 个', '已失效 4 条', '回收站 2 个', '共 12 条', '3 个会话']) {
    const covered = sample in EN || RULES.some(([pattern]) => pattern.test(sample))
    assert.ok(covered, `这段文案既没有词条也没有规则：${sample}`)
  }
})

test('a rule never leaves Chinese behind in its output', () => {
  const samples = ['3 个工作区', '主题 5 个', '已失效 4 条', '回收站 2 个', '共 12 条', '3 个会话', '读自 workspace.json']
  for (const sample of samples) {
    for (const [pattern, replacement] of RULES) {
      if (!pattern.test(sample)) continue
      const out = sample.replace(pattern, replacement)
      assert.equal(/[\u4e00-\u9fa5]/.test(out), false, `规则输出还带中文：${sample} → ${out}`)
    }
  }
})
