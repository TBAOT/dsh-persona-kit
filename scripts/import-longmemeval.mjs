/**
 * LongMemEval → 我们的主题库 + bench 题集。
 *
 * 数据集（MIT，xiaowu0162/longmemeval-cleaned）每个实例包含：
 *   question_id / question_type / question / answer
 *   haystack_session_ids[] / haystack_dates[] / haystack_sessions[][{role,content,has_answer?}]
 *   answer_session_ids[]        ← 证据会话，用于"会话级召回"判定
 * question_id 以 `_abs` 结尾的是拒答题。
 *
 * 转换规则（刻意简单，不替你做判断）：
 *   1. 每题一个临时 persona：`<home>/personas/<qid>/topics/s<index>.md`，一段会话 = 一篇主题；
 *   2. 题集的 expect = 证据会话对应的 slug 列表；拒答题 expect = null；
 *   3. split = question_type，方便按题型看数字。
 *
 *   node scripts/import-longmemeval.mjs --file=bench-data/longmemeval_s_cleaned.json --limit=50
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SLUG_PREFIX = 's'

/** 会话 → 主题正文。保留角色区分，去掉空消息。 */
export function renderSession(turns) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      const role = turn?.role === 'assistant' ? 'assistant' : 'user'
      const text = String(turn?.content ?? '').trim()
      return text ? `${role}: ${text}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

/** 摘要取第一句用户话的前 40 字——索引行只需要"这篇讲什么"。 */
export function summarise(turns) {
  const first = (Array.isArray(turns) ? turns : []).find((turn) => String(turn?.content ?? '').trim())
  return String(first?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
}

/** 一个实例 → { persona, topics: [{slug, summary, body, updated}], row } */
export function convertInstance(instance) {
  const qid = String(instance?.question_id ?? '').trim()
  const sessions = Array.isArray(instance?.haystack_sessions) ? instance.haystack_sessions : []
  const sessionIds = Array.isArray(instance?.haystack_session_ids) ? instance.haystack_session_ids : []
  const dates = Array.isArray(instance?.haystack_dates) ? instance.haystack_dates : []
  const answerIds = Array.isArray(instance?.answer_session_ids) ? instance.answer_session_ids : []

  const topics = sessions.map((turns, index) => ({
    slug: `${SLUG_PREFIX}${index}`,
    summary: summarise(turns) || `session ${sessionIds[index] ?? index}`,
    body: renderSession(turns),
    updated: String(dates[index] ?? '').slice(0, 10) || undefined,
    keywords: [String(sessionIds[index] ?? ''), String(dates[index] ?? '').slice(0, 10)]
      .filter(Boolean)
      .join(','),
  }))

  const goldSlugs = answerIds
    .map((id) => sessionIds.indexOf(id))
    .filter((index) => index >= 0)
    .map((index) => `${SLUG_PREFIX}${index}`)

  const abstention = qid.endsWith('_abs')
  return {
    qid,
    persona: qid,
    topics,
    row: {
      q: String(instance?.question ?? '').trim(),
      expect: abstention ? null : goldSlugs.length ? goldSlugs : null,
      split: String(instance?.question_type ?? 'unknown'),
      qid,
      // 每题的语料库是它自己的 haystack：bench 见到 persona 就只用这一份。
      persona: qid,
    },
  }
}

const invokedDirectly = Boolean(process.argv[1]) && process.argv[1].endsWith('import-longmemeval.mjs')
if (invokedDirectly) {
  const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=')[1]
  const file = arg('file')
  const limit = Number(arg('limit') ?? 50)
  const home = arg('home') ?? path.join(process.cwd(), 'bench-data', `home-${path.basename(String(file ?? 's')).replace(/[^\w-]+/g, '-')}`)
  const out = arg('out') ?? path.join(process.cwd(), 'bench-data', 'longmemeval.jsonl')

  if (!file || !existsSync(file)) {
    console.error('用法：node scripts/import-longmemeval.mjs --file=bench-data/longmemeval_s_cleaned.json [--limit=50] [--home=…] [--out=…]')
    process.exit(1)
  }

  const data = JSON.parse(readFileSync(file, 'utf8'))
  const instances = Array.isArray(data) ? data : []
  if (!instances.length) {
    console.error('数据集为空或格式不对（期望一个 JSON 数组）')
    process.exit(1)
  }
  const picked = instances.slice(0, Number.isFinite(limit) && limit > 0 ? limit : instances.length)

  // 重建临时 home：只放 persona 目录，不碰 ~/.dsh
  const personasDir = path.join(home, 'personas')
  rmSync(home, { recursive: true, force: true })
  mkdirSync(personasDir, { recursive: true })

  const rows = []
  let skipped = 0
  for (const instance of picked) {
    const converted = convertInstance(instance)
    if (!converted.qid || !converted.row.q) {
      skipped += 1
      continue
    }
    const topicsDir = path.join(personasDir, converted.persona, 'topics')
    mkdirSync(topicsDir, { recursive: true })
    for (const topic of converted.topics) {
      const front = [
        '---',
        `slug: ${topic.slug}`,
        `summary: ${topic.summary}`,
        ...(topic.keywords ? [`keywords: ${topic.keywords}`] : []),
        ...(topic.updated ? [`updated: ${topic.updated}`] : []),
        '---',
        '',
      ].join('\n')
      writeFileSync(path.join(topicsDir, `${topic.slug}.md`), `${front}${topic.body}\n`, 'utf8')
    }
    rows.push(converted.row)
  }

  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')

  const topicTotal = picked.reduce((sum, instance) => sum + (instance?.haystack_sessions?.length ?? 0), 0)
  console.log(`题数 ${rows.length}（跳过 ${skipped}）｜主题 ${topicTotal} 篇｜临时库 ${home}`)
  console.log(`题集 → ${out}`)
  console.log(`下一步：pnpm bench --home=${path.relative(process.cwd(), home)} --file=${path.relative(process.cwd(), out)} --topN=5`)
  console.log('注意：数据集是英文，我们的分词以 CJK 2-gram 为主，数字会偏低——这是结论，不是 bug。')
}
