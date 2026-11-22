/**
 * Split a topic body into retrievable slices.
 *
 * A topic file is an append log: dated sections (`## 2026-11-22`) separated by blank
 * lines, each holding a few paragraphs. Recall currently only injects the index line and
 * leaves the reader to open the file — but a single paragraph is often the whole answer.
 * These slices are what `selectTopics` can quote, so the prompt carries the fact instead
 * of a pointer to it.
 */
const HEADING = /^#{1,6}\s+/

/** Rough sentence boundary: CJK punctuation first, then latin sentence ends. */
function cutAt(text, max) {
  const value = String(text ?? '').trim()
  if (value.length <= max) return value
  const window = value.slice(0, max)
  const lastStop = Math.max(window.lastIndexOf('。'), window.lastIndexOf('；'), window.lastIndexOf('！'), window.lastIndexOf('？'), window.lastIndexOf('. '))
  return (lastStop > max * 0.5 ? window.slice(0, lastStop + 1) : window).trim()
}

/**
 * Paragraph-level slices of one topic body, in document order.
 *
 * - drops heading lines (they are dates, not content);
 * - splits on blank lines;
 * - merges fragments shorter than `min` into the previous slice, so a lone bullet does
 *   not become its own "fact";
 * - caps each slice at `max` characters at a sentence boundary.
 */
export function splitChunks(body, { max = 240, min = 12 } = {}) {
  const paragraphs = []
  let buffer = []
  const flush = () => {
    const text = buffer.join('\n').trim()
    buffer = []
    if (text) paragraphs.push(text)
  }
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (HEADING.test(trimmed)) {
      flush()
      continue
    }
    if (!trimmed) {
      flush()
      continue
    }
    buffer.push(trimmed)
  }
  flush()

  const merged = []
  for (const paragraph of paragraphs) {
    // 只有"短且没有句末标点"的碎片才并进上一段；一句完整的短事实要独立成片。
    const fragment = paragraph.length < min && !/[。；！？：:.]$/.test(paragraph)
    if (merged.length && fragment) merged[merged.length - 1] = `${merged[merged.length - 1]}\n${paragraph}`
    else merged.push(paragraph)
  }
  return merged.map((text) => cutAt(text, max)).filter(Boolean)
}
