import { describe, expect, it, vi } from 'vitest'
import type { IAudioMetadata } from 'music-metadata'

vi.mock('music-metadata', () => ({
  parseFile: vi.fn()
}))

vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }))
vi.mock('ffprobe-static', () => ({ default: null }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
// Keep metadata unit tests independent of installed native tools and Rosetta prompts.
vi.mock('fs', () => {
  const existsSync = vi.fn(() => false)
  return { existsSync, default: { existsSync } }
})

import { parseFile as mmParseFile } from 'music-metadata'
import { probeFile, parseChaptersFromFfprobeOutput } from '../probe'

const mockParseFile = vi.mocked(mmParseFile)

function makeMetadata(overrides: Partial<IAudioMetadata> = {}): IAudioMetadata {
  return {
    format: {
      duration: 3600,
      container: 'M4A',
      chapters: [],
      ...overrides.format
    },
    common: {
      title: 'My Book',
      artist: 'Author Name',
      album: 'Series One',
      picture: undefined,
      ...overrides.common
    },
    native: {},
    quality: { warnings: [] },
    ...overrides
  } as IAudioMetadata
}

describe('probeFile', () => {
  it('returns duration, format, and tags from music-metadata', async () => {
    mockParseFile.mockResolvedValueOnce(makeMetadata())

    const result = await probeFile('/some/file.m4b')

    expect(result.duration).toBe(3600)
    expect(result.format).toBe('M4A')
    expect(result.tags).toEqual({ title: 'My Book', artist: 'Author Name', album: 'Series One' })
  })

  it('detects cover art when picture array is present', async () => {
    mockParseFile.mockResolvedValueOnce(
      makeMetadata({
        common: {
          picture: [{ data: Buffer.from('img'), format: 'image/jpeg' }]
        } as unknown as IAudioMetadata['common']
      })
    )

    const result = await probeFile('/some/file.mp3')

    expect(result.hasCoverArt).toBe(true)
  })

  it('reports no cover art when picture array is absent', async () => {
    mockParseFile.mockResolvedValueOnce(makeMetadata())

    const result = await probeFile('/some/file.mp3')

    expect(result.hasCoverArt).toBe(false)
  })

  it('throws when duration is not finite', async () => {
    mockParseFile.mockResolvedValueOnce(
      makeMetadata({
        format: {
          duration: NaN,
          container: 'M4A',
          chapters: []
        } as unknown as IAudioMetadata['format']
      })
    )

    await expect(probeFile('/some/file.m4b')).rejects.toThrow('Could not read duration')
  })

  it('omits tags with missing values', async () => {
    mockParseFile.mockResolvedValueOnce(
      makeMetadata({
        common: { title: undefined, artist: 'Author', album: undefined } as IAudioMetadata['common']
      })
    )

    const result = await probeFile('/some/file.mp3')

    expect(result.tags).toEqual({ artist: 'Author' })
  })

  it('returns empty chapters when ffprobe is unavailable', async () => {
    mockParseFile.mockResolvedValueOnce(makeMetadata())

    const result = await probeFile('/some/file.m4b')

    expect(result.chapters).toEqual([])
  })
})

describe('parseChaptersFromFfprobeOutput', () => {
  it('parses two chapters with explicit start_time and end_time', () => {
    const stdout = JSON.stringify({
      chapters: [
        { start_time: '0.000000', end_time: '50.000000', tags: { title: 'Part One' } },
        { start_time: '50.000000', end_time: '100.000000', tags: { title: 'Part Two' } }
      ]
    })

    const result = parseChaptersFromFfprobeOutput(stdout, 100)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ startSec: 0, endSec: 50, title: 'Part One' })
    expect(result[1]).toEqual({ startSec: 50, endSec: 100, title: 'Part Two' })
  })

  it('uses next chapter start_time as end when end_time is absent', () => {
    const stdout = JSON.stringify({
      chapters: [
        { start_time: '0.000000', tags: { title: 'Ch 1' } },
        { start_time: '100.000000', tags: { title: 'Ch 2' } }
      ]
    })

    const result = parseChaptersFromFfprobeOutput(stdout, 200)

    expect(result[0].endSec).toBe(100)
    expect(result[1].endSec).toBe(200)
  })

  it('uses total duration as end for last chapter when end_time is absent', () => {
    const stdout = JSON.stringify({
      chapters: [{ start_time: '0.000000', tags: { title: 'Only' } }]
    })

    const result = parseChaptersFromFfprobeOutput(stdout, 3600)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ startSec: 0, endSec: 3600, title: 'Only' })
  })

  it('filters zero-duration and negative-duration chapters', () => {
    const stdout = JSON.stringify({
      chapters: [
        { start_time: '0.000000', end_time: '0.000000', tags: { title: 'Empty' } },
        { start_time: '10.000000', end_time: '5.000000', tags: { title: 'Reversed' } },
        { start_time: '20.000000', end_time: '40.000000', tags: { title: 'Good' } }
      ]
    })

    const result = parseChaptersFromFfprobeOutput(stdout, 100)

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Good')
  })

  it('trims whitespace from chapter titles', () => {
    const stdout = JSON.stringify({
      chapters: [{ start_time: '0.000000', end_time: '50.000000', tags: { title: '  Intro  ' } }]
    })

    const result = parseChaptersFromFfprobeOutput(stdout, 50)

    expect(result[0].title).toBe('Intro')
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseChaptersFromFfprobeOutput('not json', 100)).toEqual([])
  })

  it('returns empty array when chapters key is absent', () => {
    expect(parseChaptersFromFfprobeOutput('{}', 100)).toEqual([])
  })

  it('handles null chapter title as null', () => {
    const stdout = JSON.stringify({
      chapters: [{ start_time: '0.000000', end_time: '10.000000' }]
    })

    const result = parseChaptersFromFfprobeOutput(stdout, 10)

    expect(result[0].title).toBeNull()
  })

  it('start_time and end_time are already seconds — no timeScale division applied', () => {
    // ffprobe divides by the track timeScale internally before outputting start_time/end_time.
    // Verify we use the decimal values directly without any further division.
    const stdout = JSON.stringify({
      chapters: [
        { start_time: '0.000000', end_time: '2.000000', tags: { title: 'Ch 1' } },
        { start_time: '2.000000', end_time: '3600.000000', tags: { title: 'Ch 2' } }
      ]
    })

    const result = parseChaptersFromFfprobeOutput(stdout, 3600)

    expect(result[0].startSec).toBeCloseTo(0)
    expect(result[0].endSec).toBeCloseTo(2)
    expect(result[1].startSec).toBeCloseTo(2)
    expect(result[1].endSec).toBeCloseTo(3600)
  })
})
