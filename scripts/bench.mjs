/**
 * Benchmark adapter: run retrieval over any labelled question file.
 *
 * What this measures is **retrieval**, not answer quality: does the right topic come
 * first, how many characters does the block cost, how long does it take. Answer-level
 * scoring needs a judge model and a dataset licence, which is a separate decision.
 *
 *   node scripts/bench.mjs --file=bench.jsonl --persona=验证角色
 *   node scripts/bench.mjs --file=bench.jsonl --persona=验证角色 --split=test
 *
 * JSONL, one object per line:
 *   { "q": "发布窗口是什么时候", "expect": ["deploy-runbook"], "split": "test" }
 * `expect` may be a string (single gold slug) or an array; omit it for a negative case.
 */
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { listTopicsSync } from '../lib/topics.js'
import { rankTopics, selectTopics } from '../lib/recall.js'

const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=')[1]
const file = arg('file')
const persona = arg('persona')
const split = arg('split')
const topN = Number(arg('topN') ?? 3)
const budget = Number(arg('budget') ?? 400)
const threshold = Number(arg('threshold') ?? 0.35)

const target = file ? (path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)) : null

/** Parse JSONL, skipping blank lines and reporting bad ones instead of crashing. */
export function parseRows(text) {
  const rows = []
  let bad = 0
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed || typeof parsed.q !== 'string' || !parsed.q.trim()) {
        bad += 1
        continue
      }
      rows.push(parsed)
    } catch {
      bad += 1
    }
  }
  return { rows, bad }
}

/** One question against a library: which slug came first, and what it cost. */
export function scoreRow(row, topics, options = {}) {
  const startedAt = performance.now()
  const ranked = rankTopics(row.q, topics, options.topN ?? 3)
  const picked = selectTopics(row.q, topics, { topN: options.topN ?? 3, budget: options.budget ?? 400 })
  const ms = performance.now() - startedAt
  const expected = row.expect == null ? null : Array.isArray(row.expect) ? row.expect : [row.expect]
  const slugs = ranked.map((item) => item.topic.slug)
  const topScore = ranked[0]?.score ?? 0
  const threshold = Number(options.threshold ?? 0.35)
  // 负例与 probe 用同一套判据：没有主题、或最高分低于阈值，才算"正确地没召回"。
  const negativeOk = !ranked.length || topScore < threshold
  const at1 = expected ? slugs.slice(0, 1).some((slug) => expected.includes(slug)) : negativeOk
  const atN = expected ? slugs.slice(0, options.topN ?? 3).some((slug) => expected.includes(slug)) : negativeOk
  return { at1, atN, ms, chars: picked.block.length, got: slugs[0] ?? '(none)', topScore, expected }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  if (!file) {
    console.error('缺少 --file=<questions.jsonl>')
    process.exit(1)
  }
  if (!existsSync(target)) {
    console.error(`找不到文件：${target}`)
    process.exit(1)
  }
  const { rows, bad } = parseRows(readFileSync(target, 'utf8'))
  const filtered = split ? rows.filter((row) => (row.split ?? 'test') === split) : rows
  if (!filtered.length) {
    console.error(`没有可评测的题目（文件内 ${rows.length} 行${bad ? `，坏行 ${bad}` : ''}）`)
    process.exit(1)
  }
  const personas = persona ? [persona] : ['验证角色', 'default'].filter((id) => listTopicsSync(id).length)
  if (!personas.length) {
    console.error('没有可用的主题库（先给角色写入主题，或指定 --persona）')
    process.exit(1)
  }

  const results = []
  for (const id of personas) {
    const topics = listTopicsSync(id)
    if (!topics.length) continue
    console.log(`\n== ${id}（${topics.length} 个主题）==`)
    for (const row of filtered) {
      const result = scoreRow(row, topics, { topN, budget, threshold })
      results.push({ persona: id, ...row, ...result })
      const mark = result.at1 ? '✓' : result.atN ? '~' : '✗'
      console.log(`  ${mark} ${row.q}\n      → ${result.got}（期望 ${(result.expected ?? ['(负例)']).join('|')}，注入 ${result.chars} 字符）`)
    }
  }

  const total = results.length
  const hit1 = results.filter((row) => row.at1).length
  const hitN = results.filter((row) => row.atN).length
  const chars = total ? Math.round(results.reduce((sum, row) => sum + row.chars, 0) / total) : 0
  const ms = total ? results.reduce((sum, row) => sum + row.ms, 0) / total : 0
  console.log(`\n== 汇总（${path.basename(target)}${split ? `，split=${split}` : ''}）==`)
  console.log(`  题数 ${total}｜hit@1 ${Math.round((hit1 / total) * 100)}%（${hit1}/${total}）｜hit@${topN} ${Math.round((hitN / total) * 100)}%（${hitN}/${total}）｜平均注入 ${chars} 字符｜平均耗时 ${ms.toFixed(2)}ms`)
  if (bad) console.log(`  跳过坏行 ${bad} 条`)
  console.log('\n注意：这里测的是检索（对不对、贵不贵、快不快），不是端到端答案正确率。')
  process.exit(hit1 / total >= 0.5 ? 0 : 1)
}
