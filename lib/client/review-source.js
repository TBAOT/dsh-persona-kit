/**
 * Read model for one review record's provenance.
 *
 * Since 0.13.4 every review entry records *how* the owning persona was decided:
 * `via: 'cwd'` (workspace binding), `pool` (workspace unclaimed), `no-cwd` (session had
 * no working directory) or `index-error` (roster unreadable). The panel shows it so
 * "this memory came from nowhere" becomes "this came from that directory, in that turn".
 *
 * Kept out of the component so it can be tested without a DOM.
 */
const LABELS = {
  cwd: { text: '工作区', tone: '', hint: '按会话的工作目录认领到角色' },
  pool: { text: '未认领池', tone: 'warn', hint: '工作区还没有绑定角色，记忆落进未认领池' },
  'no-cwd': { text: '无工作目录', tone: 'warn', hint: '会话没有工作目录，只能落进未认领池' },
  'index-error': { text: '名册错误', tone: 'warn', hint: '角色名册读取失败，这一轮没有写入' },
}

/** `{ text, tone, title }` for one log record; `null` fields never throw. */
export function sourceLabel(record) {
  if (!record || typeof record !== 'object') return { text: '未知', tone: '', title: '' }
  const via = typeof record.via === 'string' ? record.via : ''
  const known = LABELS[via]
  const cwd = typeof record.cwd === 'string' ? record.cwd : ''
  const session = typeof record.sessionId === 'string' ? record.sessionId : ''
  const parts = []
  if (cwd) parts.push(cwd)
  if (session) parts.push(`会话 ${session}`)
  if (known) {
    return {
      text: known.text,
      tone: known.tone,
      title: [known.hint, ...parts].filter(Boolean).join('\n'),
    }
  }
  // 0.13.4 之前的记录没有 via 字段：说清楚，而不是假装知道。
  return { text: '旧记录', tone: '', title: ['这一条写在 0.13.4 之前，没有记录归属依据', ...parts].filter(Boolean).join('\n') }
}

/** Last 8 characters of a session id, enough to tell rows apart in a list. */
export function sessionShort(id) {
  const text = typeof id === 'string' ? id : ''
  return text.length > 8 ? text.slice(-8) : text
}
