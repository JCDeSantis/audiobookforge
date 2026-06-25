import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

/* eslint-disable @typescript-eslint/explicit-function-return-type */

/** @returns {string | null} */
function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

/** @returns {string[]} */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/** @returns {string} */
function srtText(content) {
  return content
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return (
        trimmed.length > 0 &&
        !/^\d+$/.test(trimmed) &&
        !/^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}$/.test(trimmed)
      )
    })
    .join(' ')
}

/** @returns {{ edits: number, werPct: number, refWords: number, hypWords: number }} */
function wer(referenceWords, hypothesisWords) {
  let previous = Array.from({ length: hypothesisWords.length + 1 }, (_, index) => index)
  let current = new Array(hypothesisWords.length + 1).fill(0)

  for (let i = 1; i <= referenceWords.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= hypothesisWords.length; j += 1) {
      const cost = referenceWords[i - 1] === hypothesisWords[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    ;[previous, current] = [current, previous]
  }

  const edits = previous[hypothesisWords.length]
  return {
    edits,
    werPct: Number(((edits / Math.max(1, referenceWords.length)) * 100).toFixed(2)),
    refWords: referenceWords.length,
    hypWords: hypothesisWords.length
  }
}

const referencePath = argValue('--reference')
const srtPath = argValue('--srt')

if (!referencePath || !srtPath) {
  console.error('Usage: node scripts/score-srt-wer.mjs --reference reference.txt --srt transcript.srt')
  process.exit(1)
}

const result = wer(
  normalize(readFileSync(referencePath, 'utf-8')),
  normalize(srtText(readFileSync(srtPath, 'utf-8')))
)

console.log(
  JSON.stringify(
    {
      reference: basename(referencePath),
      srt: basename(srtPath),
      ...result
    },
    null,
    2
  )
)
