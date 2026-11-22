/**
 * 检索质量探针：14 道真实题、四种题型，三数同报（命中率 / 注入字符 / 耗时）。
 *
 *   node scripts/probe.mjs --persona=验证角色 --split=tune|verify
 *   node scripts/probe.mjs --persona=验证角色 --mode=all      # keyword / semantic / hybrid 对比
 *
 * 只测「打分能否把对的主题排到第一」，不代替真实会话里模型是否去读文件。
 * 题目原文不得写进主题库（有测试守着），否则等于自己泄题。
 */
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listTopicsSync } from '../lib/topics.js'
import { rankTopics, selectTopics } from '../lib/recall.js'
import { makeSemanticScorer } from '../lib/semantic.js'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=')[1]
const personaArg = arg('persona')
const split = arg('split') ?? 'all'
const budget = Number(arg('budget') ?? 400)
const topN = Number(arg('topN') ?? 3)
const mode = arg('mode') ?? 'keyword'
const slices = arg('slices') !== 'off'
const alphaArg = arg('alpha')

const MODES = {
  keyword: { scorer: null, alpha: 1 },
  semantic: { scorer: () => makeSemanticScorer(), alpha: 0 },
  hybrid: { scorer: () => makeSemanticScorer(), alpha: 0.5 },
}
if (alphaArg !== undefined) {
  // 手调混合比例：`--mode=hybrid --alpha=0.8`
  const value = Math.min(1, Math.max(0, Number(alphaArg)))
  if (Number.isFinite(value) && MODES.hybrid) MODES.hybrid.alpha = value
}
const chosen = mode === 'all' ? Object.keys(MODES) : [mode]
for (const name of chosen) {
  if (!MODES[name]) {
    console.error(`不认识的 --mode=${name}（可选 keyword | semantic | hybrid | all）`)
    process.exit(1)
  }
}

const file = path.join(import.meta.dirname, '..', 'test', 'probe', 'questions.json')
const suite = JSON.parse(readFileSync(file, 'utf8'))
const threshold = Number(suite.threshold ?? 0.35)

const questions = suite.questions.filter((item) =>
  split === 'tune' ? !item.holdout : split === 'verify' ? item.holdout : true,
)
if (!questions.length) {
  console.error(`没有符合 --split=${split} 的题目`)
  process.exit(1)
}

const personas = personaArg ? [personaArg] : ['slot-1', 'slot-2', 'slot-3', 'default'].filter((id) => listTopicsSync(id).length)
const types = ['single-hop', 'multi-hop', 'temporal', 'negative']

/** One question against one persona's library, under one scoring mode. */
export function judge(question, topics, options = {}) {
  const startedAt = performance.now()
  const scorer = options.scorer ?? undefined
  const alpha = options.alpha ?? 1
  const ranked = rankTopics(question.q, topics, topN, { scorer, alpha })
  const picked = selectTopics(question.q, topics, { topN, budget, scorer, alpha, slices })
  const ms = performance.now() - startedAt
  const top = ranked[0]
  const topSlug = top?.topic?.slug ?? '(无)'
  const expected = question.expect
  const ok = expected === null || expected === undefined
    ? !top || top.score < threshold
    : Array.isArray(expected)
      ? Boolean(top && expected.includes(topSlug))
      : topSlug === expected
  return {
    ok,
    ms,
    chars: picked.block.length,
    got: topSlug,
    score: top?.score ?? 0,
    expected,
    reason: !ok && (expected === null || expected === undefined) ? '误召回' : '未命中',
  }
}

const width = 12
const pad = (text, size = width) => String(text).padEnd(size)
const padStart = (text, size = width) => String(text).padStart(size)

function runMode(name) {
  const definition = MODES[name]
  const scorer = definition.scorer ? definition.scorer() : null
  const options = { scorer, alpha: definition.alpha }
  const rows = []
  if (chosen.length === 1) console.log(`\n== 打分模式：${name}（split=${split}）==`)
  for (const persona of personas) {
    const topics = listTopicsSync(persona)
    if (!topics.length) continue
    if (chosen.length === 1) console.log(`\n== ${persona}（${topics.length} 个主题）==`)
    for (const question of questions) {
      const result = judge(question, topics, options)
      rows.push({ persona, mode: name, ...question, ...result })
      if (chosen.length === 1) {
        const mark = result.ok ? '✓' : '✗'
        const expectText = Array.isArray(result.expected) ? result.expected.join('|') : (result.expected ?? '(负例)')
        console.log(
          `  ${mark} [${question.type}] ${question.q}\n      → ${result.got} ${result.score}（期望 ${expectText}，注入 ${result.chars} 字符）`,
        )
      }
    }
  }

  const total = rows.length
  const hits = rows.filter((row) => row.ok).length
  const chars = rows.reduce((sum, row) => sum + row.chars, 0)
  const ms = rows.reduce((sum, row) => sum + row.ms, 0)
  const rate = total ? Math.round((hits / total) * 100) : 0

  if (chosen.length === 1) {
    console.log(`\n== 汇总（split=${split}，threshold=${threshold}）==`)
    console.log(`  ${pad('题型')}${padStart('题数', 6)}${padStart('命中', 6)}${padStart('命中率', 8)}${padStart('注入字符', 10)}${padStart('耗时', 9)}`)
    for (const type of types) {
      const bucket = rows.filter((row) => row.type === type)
      if (!bucket.length) continue
      const hit = bucket.filter((row) => row.ok).length
      const charsAvg = Math.round(bucket.reduce((sum, row) => sum + row.chars, 0) / bucket.length)
      const msAvg = bucket.reduce((sum, row) => sum + row.ms, 0) / bucket.length
      console.log(
        `  ${pad(type)}${padStart(bucket.length, 6)}${padStart(hit, 6)}${padStart(`${Math.round((hit / bucket.length) * 100)}%`, 8)}${padStart(charsAvg, 10)}${padStart(`${msAvg.toFixed(2)}ms`, 9)}`,
      )
    }
  }
  return { name, rows, total, hits, rate, chars: total ? Math.round(chars / total) : 0, ms: total ? ms / total : 0 }
}

const results = chosen.map((name) => runMode(name))

if (chosen.length === 1) {
  const one = results[0]
  console.log(
    `  ${pad('合计')}${padStart(one.total, 6)}${padStart(one.hits, 6)}${padStart(`${one.rate}%`, 8)}${padStart(one.chars, 10)}${padStart(`${one.ms.toFixed(2)}ms`, 9)}`,
  )
  console.log(`\n三数同报：命中率 ${one.rate}%（${one.hits}/${one.total}）｜平均注入 ${one.chars} 字符｜平均耗时 ${one.ms.toFixed(2)}ms`)
} else {
  console.log(`\n== 模式对比（split=${split}，threshold=${threshold}）==`)
  console.log(`  ${pad('模式')}${padStart('题数', 6)}${padStart('命中', 6)}${padStart('命中率', 8)}${padStart('相对基线', 12)}${padStart('注入字符', 10)}${padStart('耗时', 9)}`)
  const baseline = results.find((item) => item.name === 'keyword')
  for (const item of results) {
    const delta = item.name === 'keyword' ? '' : ` (${item.rate - baseline.rate >= 0 ? '+' : ''}${item.rate - baseline.rate}pt)`
    console.log(
      `  ${pad(item.name)}${padStart(item.total, 6)}${padStart(item.hits, 6)}${padStart(`${item.rate}%`, 8)}${padStart(delta.trim(), 12)}${padStart(item.chars, 10)}${padStart(`${item.ms.toFixed(2)}ms`, 9)}`,
    )
  }
}

const rows = results.flatMap((item) => item.rows)
const misses = rows.filter((row) => !row.ok)
if (chosen.length === 1 && misses.length) {
  console.log('\n未通过清单：')
  for (const miss of misses) {
    const expected = Array.isArray(miss.expected) ? miss.expected.join('|') : (miss.expected ?? '(负例)')
    console.log(`  - [${miss.persona}/${miss.type}] ${miss.q}：期望 ${expected}，实际 ${miss.got}（${miss.score}）${miss.reason === '误召回' ? '← 负例被误召回' : ''}`)
  }
}

const negativeLeak = rows.some((row) => row.type === 'negative' && !row.ok)
const verifyGate = split === 'verify' ? results.every((item) => item.rate >= 70) : true
if (negativeLeak) console.log('\n失败：负例题被误召回，说明阈值/打分把无关问题也召回了。')
if (verifyGate === false) console.log(`\n失败：留出集命中率低于 70%，不能作为验收通过。`)
console.log('\n注意：这里只测「打分能否把对的主题排到第一」，不代替真实会话里模型是否去读文件；注入字符即该块的提示词成本。')
process.exit(negativeLeak || !verifyGate ? 1 : 0)
