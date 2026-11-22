/**
 * Convert a labelled dataset into the JSONL that `scripts/bench.mjs` reads.
 *
 * The point of keeping this dumb is honesty: every public memory dataset labels answers
 * in its own way, and mapping an answer to *our* topic slugs is a judgement call. So this
 * tool does the mechanical part (field mapping, validation, JSONL out) and leaves the
 * slug mapping to you or to a small script of yours.
 *
 *   node scripts/import-bench.mjs --from=data.json --out=bench.jsonl \
 *        --question-field=question --expect-field=gold --split-field=split
 *
 * Input: a JSON array or JSONL. Output lines: {"q","expect","split"}.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Accepts a JSON array or JSONL; returns objects as-is and counts what it dropped. */
export function readRecords(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return { records: [], dropped: 0 }
  if (trimmed.startsWith('[')) {
    try {
      const list = JSON.parse(trimmed)
      return { records: Array.isArray(list) ? list.filter((item) => item && typeof item === 'object') : [], dropped: 0 }
    } catch {
      return { records: [], dropped: 1 }
    }
  }
  const records = []
  let dropped = 0
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object') records.push(parsed)
      else dropped += 1
    } catch {
      dropped += 1
    }
  }
  return { records, dropped }
}

/** Map one source record to a bench row; `null` when it has no usable question. */
export function toRow(record, fields = {}) {
  const questionKey = fields.question ?? 'q'
  const expectKey = fields.expect ?? 'expect'
  const splitKey = fields.split
  const question = String(record?.[questionKey] ?? '').trim()
  if (!question) return null
  const rawExpect = record?.[expectKey]
  const expect = Array.isArray(rawExpect)
    ? rawExpect.map((item) => String(item).trim()).filter(Boolean)
    : rawExpect == null || String(rawExpect).trim() === ''
      ? null
      : [String(rawExpect).trim()]
  const split = splitKey && record?.[splitKey] ? String(record[splitKey]) : fields.split ?? 'test'
  return { q: question, expect, split }
}

const invokedDirectly = Boolean(process.argv[1]) && process.argv[1].endsWith('import-bench.mjs')
if (invokedDirectly) {
  const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=')[1]
  const from = arg('from')
  const out = arg('out')
  const questionField = arg('question-field') ?? 'q'
  const expectField = arg('expect-field') ?? 'expect'
  const splitField = arg('split-field')
  const defaultSplit = arg('split') ?? 'test'

  if (!from || !out) {
    console.error(
      '用法：node scripts/import-bench.mjs --from=<data.json|jsonl> --out=<bench.jsonl> [--question-field=q] [--expect-field=expect] [--split-field=split]',
    )
    process.exit(1)
  }

  const { records, dropped } = readRecords(readFileSync(path.resolve(from), 'utf8'))
  const rows = []
  let unusable = 0
  for (const record of records) {
    const row = toRow(record, { question: questionField, expect: expectField, split: splitField ?? defaultSplit })
    if (row) rows.push(row)
    else unusable += 1
  }
  writeFileSync(path.resolve(out), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
  console.log(`写入 ${rows.length} 行 → ${path.resolve(out)}`)
  if (dropped) console.log(`  源文件里的坏行：${dropped}`)
  if (unusable) console.log(`  缺问题字段被跳过：${unusable}`)
  console.log('  下一步：把 expect 换成你的主题 slug（ls ~/.dsh/personas/<角色>/topics），再跑 pnpm bench。')
}
