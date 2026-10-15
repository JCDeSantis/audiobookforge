import { describe, expect, it, vi } from 'vitest'

vi.mock('music-metadata', () => ({
  parseFile: vi.fn()
}))

vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }))

import { parseFile as mmParseFile } from 'music-metadata'
import { probeFile } from '../probe'

const mockParseFile = vi.mocked(mmParseFile)

function makeMetadata(overrides: Partial<Parameters<typeof mockParseFile>[0]> = {}) {
  return {
    format: {
      duration: 3600,
      container: 'M4A',
      chapters: [],
      ...((overrides as Record<string, unknown>)['format'] ?? {})
    },
    common: {
      title: 'My Book',
      artist: 'Author Name',
      album: 'Series One',
      picture: undefined,
      ...((overrides as Record<string, unknown>)['common'] ?? {})
    },
    native: {},
    quality: { warnings: [] }
  }
}

describe('probeFile', () => {
  it('returns duration, format, and tags from music-metadata', async () => {
    mockParseFile.mockResolvedValueOnce(makeMetadata() as never)

    const result = await probeFile('/some/file.m4b')

    expect(result.duration).toBe(3600)
    expect(result.format).toBe('M4A')
    expect(result.tags).toEqual({ title: 'My Book', artist: 'Author Name', album: 'Series One' })
  })

  it('detects cover art when picture array is present', async () => {
    mockParseFile.mockResolvedValueOnce({
      ...makeMetadata(),
      common: { picture: [{ data: Buffer.from('img'), format: 'image/jpeg' }] }
    } as never)

    const result = await probeFile('/some/file.mp3')

    expect(result.hasCoverArt).toBe(true)
  })

  it('reports no cover art when picture array is absent', async () => {
    mockParseFile.mockResolvedValueOnce(makeMetadata() as never)

    const result = await probeFile('/some/file.mp3')

    expect(result.hasCoverArt).toBe(false)
  })

  it('maps chapters with start, end, and title', async () => {
    mockParseFile.mockResolvedValueOnce({
      ...makeMetadata(),
      format: {
        duration: 100,
        container: 'M4A',
        chapters: [
          { start: 0, end: 50, title: 'Part One' },
          { start: 50, end: 100, title: 'Part Two' }
        ]
      }
    } as never)

    const result = await probeFile('/some/file.m4b')

    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[0]).toEqual({ startSec: 0, endSec: 50, title: 'Part One' })
    expect(result.chapters[1]).toEqual({ startSec: 50, endSec: 100, title: 'Part Two' })
  })

  it('drops chapters with zero or negative duration', async () => {
    mockParseFile.mockResolvedValueOnce({
      ...makeMetadata(),
      format: {
        duration: 100,
        container: 'M4A',
        chapters: [
          { start: 0, end: 0, title: 'Empty' },
          { start: 10, end: 5, title: 'Reversed' },
          { start: 20, end: 40, title: 'Good' }
        ]
      }
    } as never)

    const result = await probeFile('/some/file.m4b')

    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].title).toBe('Good')
  })

  it('throws when duration is not finite', async () => {
    mockParseFile.mockResolvedValueOnce({
      ...makeMetadata(),
      format: { duration: NaN, container: 'M4A', chapters: [] }
    } as never)

    await expect(probeFile('/some/file.m4b')).rejects.toThrow('Could not read duration')
  })

  it('omits tags with missing values', async () => {
    mockParseFile.mockResolvedValueOnce({
      ...makeMetadata(),
      common: { title: undefined, artist: 'Author', album: undefined, picture: undefined }
    } as never)

    const result = await probeFile('/some/file.mp3')

    expect(result.tags).toEqual({ artist: 'Author' })
  })
})
