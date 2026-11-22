/**
 * Structural audit of one persona's memory.
 *
 * Not a quality score: it only reports things that are provably wrong or provably
 * wasteful — an empty summary (a topic that can barely be recalled), a duplicate
 * fact in two places, a meta map that no longer matches the files. Everything
 * softer is advisory, because a human is the judge of what a fact is worth.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { entryHash, personaDir, readEntriesSync, readMetaSync, similarity, usage } from './store.js'
import { TOPIC_MAX_CHARS, listTopicsSync, overlap } from './topics.js'
import { DEFAULT_POLICY, readPolicySync } from './policy.js'

const NEAR_DUPLICATE_TOPIC = 0.75
const NEAR_DUPLICATE_ENTRY = 0.8
/** 相似但不重复、数字又不同 —— 可能是"改了口径却没作废旧条目"。 */
const CONFLICT_SUSPECT = 0.5

/** 两条条目里的数字集合是否不同（日期、时间、次数、比例都算）。 */
function digitsDiffer(left, right) {
  const digits = (text) => [...new Set(String(text ?? '').match(/\d+/g) ?? [])].sort().join(',')
  return digits(left) !== digits(right)
}
const LONG_ENTRY_CHARS = 220

export function auditPersona(persona, options = {}) {
  const limits = options.limits ?? { user: 1375, memory: 3000 }
  const findings = []
  const add = (level, kind, detail) => findings.push({ level, kind, detail })

  // --- policy: the rules file must be readable, and its numbers must be the ones
  // actually in force (it overrides the roster, so a mismatch confuses everyone).
  const policyInfo = readPolicySync(persona)
  if (policyInfo.warning) add('error', 'policy-unreadable', policyInfo.warning)
  const policyLimits = policyInfo.policy?.limits
  if (policyLimits) {
    for (const [tier, value] of Object.entries(policyLimits)) {
      if (!Number.isFinite(value) || value === null) continue
      if (Number(limits[tier]) && Number(limits[tier]) !== Number(value)) {
        add('advisory', 'policy-limits-differ', `${tier}：policy 写 ${value}，名册写 ${limits[tier]}；实际生效的是 policy`)
      }
    }
  }
  if ((policyInfo.policy?.entryMaxChars ?? DEFAULT_POLICY.entryMaxChars) !== DEFAULT_POLICY.entryMaxChars) {
    add('advisory', 'policy-entry-cap', `单条上限被 policy 改成 ${policyInfo.policy.entryMaxChars} 字（默认 ${DEFAULT_POLICY.entryMaxChars}）`)
  }
  if ((policyInfo.policy?.topicMaxChars ?? DEFAULT_POLICY.topicMaxChars) !== DEFAULT_POLICY.topicMaxChars) {
    add('advisory', 'policy-topic-cap', `主题上限被 policy 改成 ${policyInfo.policy.topicMaxChars} 字符（默认 ${DEFAULT_POLICY.topicMaxChars}）`)
  }
  // Refused writes to a closed tier are worth surfacing: they mean the agent tried.
  try {
    const log = readFileSync(path.join(personaDir(persona), 'review', 'log.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .slice(-200)
    const refused = log.filter((line) => line.includes('"read-only"')).length
    if (refused) add('advisory', 'readonly-rewrites-attempted', `最近 200 条复盘记录里有 ${refused} 次写到只读档被拦（说明模型没看懂只读声明）`)
  } catch {
    /* no log yet */
  }

  const topics = listTopicsSync(persona)
  for (const topic of topics) {
    if (!topic.summary.trim()) add('error', 'topic-empty-summary', `${topic.slug}：摘要为空，索引行只剩 slug`)
    if (topic.chars > TOPIC_MAX_CHARS) add('error', 'topic-over-cap', `${topic.slug}：${topic.chars}/${TOPIC_MAX_CHARS}`)
    if (!topic.keywords.length) add('advisory', 'topic-no-keywords', `${topic.slug}：没有检索别名，只能靠摘要命中`)
  }
  for (let i = 0; i < topics.length; i += 1) {
    for (let j = i + 1; j < topics.length; j += 1) {
      const score = overlap(`${topics[i].summary} ${topics[i].body}`, `${topics[j].summary} ${topics[j].body}`)
      if (score >= NEAR_DUPLICATE_TOPIC) {
        add('error', 'topic-near-duplicate', `${topics[i].slug} ↔ ${topics[j].slug}：${score.toFixed(2)}，像同一件事`)
      }
    }
  }

  const tiers = {}
  for (const target of ['memory', 'user']) {
    const entries = readEntriesSync(persona, target)
    tiers[target] = { entries, usage: usage(entries, Number(limits[target] ?? 0)) }
    const seen = new Set()
    for (const entry of entries) {
      if (seen.has(entry)) add('error', 'entry-duplicate', `${target}：完全重复 — ${entry.slice(0, 30)}…`)
      seen.add(entry)
      if (entry.length > LONG_ENTRY_CHARS) add('advisory', 'entry-long', `${target}：${entry.length} 字 — ${entry.slice(0, 40)}…`)
    }
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const score = similarity(entries[i], entries[j])
        const sameWording = score >= NEAR_DUPLICATE_ENTRY
        const numbersDiffer = digitsDiffer(entries[i], entries[j])
        if (sameWording && numbersDiffer) {
          // 措辞几乎一样、数字却不同：这是"规则改了口径但两条并存"，不是重复。
          // 只提醒：作不作废要人来判断，机器不擅自删除。
          add(
            'advisory',
            'conflict-suspect',
            `${target}：${score.toFixed(2)} 且数字不同 — ${entries[i].slice(0, 24)}… ↔ ${entries[j].slice(0, 24)}…（若确实改了口径，用 add + supersedes 让旧的失效）`,
          )
        } else if (sameWording) {
          add('error', 'entry-near-duplicate', `${target}：${score.toFixed(2)} — ${entries[i].slice(0, 24)}… ↔ ${entries[j].slice(0, 24)}…`)
        } else if (score >= CONFLICT_SUSPECT && numbersDiffer) {
          add(
            'advisory',
            'conflict-suspect',
            `${target}：${score.toFixed(2)} 且数字不同 — ${entries[i].slice(0, 24)}… ↔ ${entries[j].slice(0, 24)}…（若确实改了口径，用 add + supersedes 让旧的失效）`,
          )
        }
      }
    }
    if (tiers[target].usage.used >= tiers[target].usage.limit * 0.9) {
      add('advisory', 'tier-near-full', `${target}：${tiers[target].usage.used}/${tiers[target].usage.limit}（${tiers[target].usage.percent}%），下一次 add 会被转存`)
    }
  }

  for (const memory of tiers.memory.entries) {
    for (const user of tiers.user.entries) {
      const score = similarity(memory, user)
      if (score >= NEAR_DUPLICATE_ENTRY) add('error', 'cross-tier-duplicate', `${score.toFixed(2)} — ${memory.slice(0, 30)}…`)
    }
  }

  const meta = readMetaSync(persona)
  const active = new Set(
    Object.entries(meta.entries ?? {})
      .filter(([, record]) => record?.status === 'active')
      .map(([hash]) => hash),
  )
  const onDisk = new Set([...tiers.memory.entries, ...tiers.user.entries].map((entry) => entryHash(entry)))
  const stale = [...active].filter((hash) => !onDisk.has(hash)).length
  const unrecorded = [...onDisk].filter((hash) => !active.has(hash)).length
  if (stale || unrecorded) {
    add('error', 'meta-drift', `meta 与文件不一致：active 中 ${stale} 条文件里没有，文件里 ${unrecorded} 条 meta 未记（跑 refreshMeta 对齐）`)
  }

  return {
    persona,
    topics: topics.length,
    tiers,
    findings,
    errors: findings.filter((item) => item.level === 'error').length,
    advisories: findings.filter((item) => item.level === 'advisory').length,
  }
}

export function formatAudit(report) {
  const lines = [
    `角色 ${report.persona}：主题 ${report.topics} 篇，memory ${report.tiers.memory.entries.length} 条（${report.tiers.memory.usage.percent}%），user ${report.tiers.user.entries.length} 条（${report.tiers.user.usage.percent}%）`,
  ]
  if (!report.findings.length) {
    lines.push('没有发现问题。')
    return lines.join('\n')
  }
  lines.push(`问题 ${report.errors} 个，提醒 ${report.advisories} 个：`)
  for (const item of report.findings) lines.push(`  [${item.level}] ${item.kind} — ${item.detail}`)
  return lines.join('\n')
}
