/**
 * Resident-memory entries as data, for the panel's per-entry editor.
 *
 * The file format stays "\n§\n"-joined text (hand-editable, diffable); this module only
 * turns it into rows and back, so the editor and the textarea can share one draft.
 *
 * Pure functions on purpose: the panel cannot be unit-tested, these can.
 */
export const SEPARATOR = '\n§\n'

/** Stored text → rows. Empty rows are dropped, matching the host's parser. */
export function splitEntries(text) {
  return String(text ?? '')
    .split(/\r?\n§\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Rows → stored text (the inverse of `splitEntries`). */
export function joinEntries(list) {
  return (Array.isArray(list) ? list : []).map((entry) => String(entry ?? '').trim()).filter(Boolean).join(SEPARATOR)
}

/** Move one row by `delta` rows; out-of-range moves return the list unchanged. */
export function moveEntry(list, index, delta) {
  const rows = Array.isArray(list) ? [...list] : []
  const from = Number(index)
  const to = from + Number(delta)
  if (!Number.isInteger(from) || from < 0 || from >= rows.length) return rows
  if (!Number.isInteger(to) || to < 0 || to >= rows.length) return rows
  const [item] = rows.splice(from, 1)
  rows.splice(to, 0, item)
  return rows
}

/**
 * Client-side validation, mirroring the host's rules so the user sees the problem on the
 * row instead of after a round-trip. The host stays authoritative.
 */
export function validateEntries(list, options = {}) {
  const rows = Array.isArray(list) ? list : []
  const entryMaxChars = Number(options.entryMaxChars ?? 120)
  const limit = Number(options.limit ?? 0)
  const errors = []
  const seen = new Map()
  let used = 0

  rows.forEach((raw, index) => {
    const text = String(raw ?? '').trim()
    if (!text) {
      errors.push({ index, message: `第 ${index + 1} 条是空的（删掉它或填写内容）` })
      return
    }
    if (text.length > entryMaxChars) {
      errors.push({ index, message: `第 ${index + 1} 条 ${text.length} 字，超过单条上限 ${entryMaxChars}` })
    }
    if (seen.has(text)) {
      errors.push({ index, message: `第 ${index + 1} 条与第 ${seen.get(text) + 1} 条完全相同` })
    } else {
      seen.set(text, index)
    }
    used += text.length
  })
  if (rows.length > 1) used += (rows.length - 1) * SEPARATOR.length
  if (limit > 0 && used > limit) {
    errors.push({ index: -1, message: `合计 ${used}/${limit} 字符，超出 ${used - limit}` })
  }
  return { ok: errors.length === 0, errors, used, count: rows.length }
}
