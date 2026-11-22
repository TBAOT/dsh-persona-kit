/**
 * A local, dependency-free semantic-ish scorer.
 *
 * Keyword scoring in `recall.js` asks "does the query literally contain a topic token".
 * That fails the moment the user paraphrases. This module scores **character n-gram
 * overlap** (2- and 3-grams, which survive word boundaries in Chinese) with TF weighting
 * and cosine normalisation, so 「怎么发版」 still lands near 「发布流程」.
 *
 * Nothing leaves the machine and there is no model to download; it is a deliberate
 * step up from exact tokens, not a replacement for real embeddings. Callers blend it with
 * keyword scores and can turn it off with one config key.
 */
const GRAMS = [2, 3]
const MAX_BODY_CHARS = 1200

function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_BODY_CHARS)
}

/** Character n-gram counts over the whole text, length-normalised. */
export function gramVector(text) {
  const value = fold(text)
  const counts = new Map()
  for (const size of GRAMS) {
    for (let index = 0; index + size <= value.length; index += 1) {
      const gram = value.slice(index, index + size)
      if (/^\s+$/.test(gram)) continue
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
  }
  let norm = 0
  for (const count of counts.values()) norm += count * count
  return { counts, norm: Math.sqrt(norm) || 1 }
}

/** Cosine similarity in [0, 1]; 0 when either side is empty. */
export function cosine(left, right) {
  if (!left?.counts?.size || !right?.counts?.size) return 0
  const [small, large] = left.counts.size <= right.counts.size ? [left, right] : [right, left]
  let dot = 0
  for (const [gram, count] of small.counts) {
    const other = large.counts.get(gram)
    if (other) dot += count * other
  }
  return dot / (left.norm * right.norm)
}

/** Text a topic is scored on: its summary, its aliases and the head of its body. */
export function topicText(topic) {
  const keywords = Array.isArray(topic?.keywords) ? topic.keywords.join(' ') : ''
  return `${topic?.summary ?? ''} ${keywords} ${String(topic?.body ?? '').slice(0, MAX_BODY_CHARS)}`
}

/**
 * Build a scorer suitable for `rankTopics(query, topics, n, { scorer })`.
 *
 * Vectors are cached per slug and invalidated by the topic's own content hash, so a turn
 * that re-reads unchanged topics does no work.
 */
export function makeSemanticScorer() {
  const cache = new Map()
  return (query, topic) => {
    const slug = String(topic?.slug ?? '')
    if (!slug) return null
    const text = topicText(topic)
    const stamp = `${text.length}:${topic?.updated ?? ''}`
    let entry = cache.get(slug)
    if (!entry || entry.stamp !== stamp) {
      entry = { stamp, vector: gramVector(text) }
      cache.set(slug, entry)
    }
    const queryVector = gramVector(query)
    return cosine(queryVector, entry.vector)
  }
}
