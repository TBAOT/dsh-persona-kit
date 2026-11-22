/**
 * Deleting a persona must not silently destroy its memory.
 *
 * The directory is moved into `~/.dsh/trash/<date>-<kind>-<id>/`, so "delete the role"
 * means "off the roster, recoverable on disk" — the same rule the rest of this plugin
 * follows for invalidated entries and overwritten files.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, cpSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function trashRoot(env = process.env) {
  const home = env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'trash')
}

function uniqueDir(parent, name) {
  let candidate = path.join(parent, name)
  let suffix = 2
  while (existsSync(candidate)) {
    candidate = path.join(parent, `${name}-${suffix}`)
    suffix += 1
  }
  return candidate
}

/**
 * Everything a persona can be recovered from: `<date>-persona-<id>/` directories, with the
 * index snapshot the delete path leaves inside (`.persona-entry.json`).
 */
export function listTrash(env = process.env) {
  const root = trashRoot(env)
  if (!existsSync(root)) return []
  const out = []
  for (const name of readdirSync(root)) {
    const match = /^(\d{4}-\d{2}-\d{2})-persona-(.+?)(?:-\d+)?$/.exec(name)
    if (!match) continue
    const dir = path.join(root, name)
    let isDir = false
    try {
      isDir = statSync(dir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) continue
    let entry = null
    let deletedAt = null
    try {
      const snapshot = JSON.parse(readFileSync(path.join(dir, '.persona-entry.json'), 'utf8'))
      entry = snapshot?.entry ?? null
      deletedAt = snapshot?.deletedAt ?? null
    } catch {
      /* 旧条目没有快照，恢复时按目录名重建 */
    }
    out.push({
      name,
      path: dir,
      id: entry?.id ?? match[2],
      deletedAt: deletedAt ?? match[1],
      entry,
    })
  }
  return out.sort((left, right) => String(right.name).localeCompare(String(left.name)))
}

export function moveToTrash(source, { kind = 'persona', id = 'item', env = process.env } = {}) {
  if (!existsSync(source)) return { moved: false, reason: 'source-missing' }
  const stamp = new Date().toISOString().slice(0, 10)
  const base = `${stamp}-${kind}-${id}`
  mkdirSync(trashRoot(env), { recursive: true })
  const target = uniqueDir(trashRoot(env), base)
  try {
    renameSync(source, target)
    return { moved: true, to: target }
  } catch (error) {
    // A rename can fail across volumes or while a handle is open; copying keeps the data.
    try {
      cpSync(source, target, { recursive: true })
      rmSync(source, { recursive: true, force: true })
      return { moved: true, to: target, via: 'copy' }
    } catch (copyError) {
      return { moved: false, reason: String(copyError?.code ?? copyError) }
    }
  }
}
