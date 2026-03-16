import { describe, expect, it } from 'vitest'
import type { AbsBookSummary, WhisperModel } from '../../../../shared/types'
import {
  buildConfirmationRows,
  buildQueueJobData,
  canContinue,
  type JobDraft,
  selectAbsItem,
  selectLocalFiles
} from '../jobDraft'

function createDraft(
  overrides: Partial<{
    source: 'local' | 'abs' | null
    audioFiles: string[]
    absItem: AbsBookSummary | null
    epubPath: string | null
    model: WhisperModel
    outputFolder: string | null
  }> = {}
): JobDraft {
  return {
    source: null as 'local' | 'abs' | null,
    audioFiles: [] as string[],
    absItem: null as AbsBookSummary | null,
    epubPath: null as string | null,
    model: 'large-v3-turbo' as WhisperModel,
    outputFolder: null as string | null,
    ...overrides
  }
}

function createAbsItem(overrides: Partial<AbsBookSummary> = {}): AbsBookSummary {
  return {
    id: 'abs-1',
    libraryId: 'library-1',
    folderId: 'folder-1',
    relPath: '/books/test',
    isFile: false,
    title: 'Project Hail Mary',
    authorName: 'Andy Weir',
    duration: 7200,
    cover: null,
    hasSubtitles: false,
    ebookPath: 'C:\\Books\\Project Hail Mary.epub',
    audioFiles: [],
    ...overrides
  }
}

describe('jobDraft', () => {
  it('clears ABS state when local files are selected', () => {
    const next = selectLocalFiles(
      createDraft({
        source: 'abs',
        absItem: createAbsItem(),
        audioFiles: [],
        outputFolder: null,
        model: 'medium'
      }),
      ['C:\\Audio\\book.m4b']
    )

    expect(next.source).toBe('local')
    expect(next.audioFiles).toEqual(['C:\\Audio\\book.m4b'])
    expect(next.absItem).toBeNull()
    expect(next.model).toBe('medium')
  })

  it('clears local-only state when an ABS item is selected', () => {
    const next = selectAbsItem(
      createDraft({
        source: 'local',
        audioFiles: ['C:\\Audio\\part1.mp3'],
        outputFolder: 'C:\\Output',
        model: 'large-v3'
      }),
      createAbsItem()
    )

    expect(next.source).toBe('abs')
    expect(next.audioFiles).toEqual([])
    expect(next.outputFolder).toBeNull()
    expect(next.absItem?.title).toBe('Project Hail Mary')
    expect(next.model).toBe('large-v3')
  })

  it('requires an output folder before local drafts can continue', () => {
    const draftWithoutFolder = createDraft({
      source: 'local',
      audioFiles: ['C:\\Audio\\book.m4b']
    })
    const draftWithFolder = createDraft({
      source: 'local',
      audioFiles: ['C:\\Audio\\book.m4b'],
      outputFolder: 'C:\\Output'
    })

    expect(canContinue(draftWithoutFolder)).toBe(false)
    expect(canContinue(draftWithFolder)).toBe(true)
  })

  it('builds the expected confirmation rows for local and ABS jobs', () => {
    const localRows = buildConfirmationRows(
      createDraft({
        source: 'local',
        audioFiles: ['C:\\Audio\\book.m4b'],
        outputFolder: 'C:\\Output',
        epubPath: 'C:\\Books\\book.epub'
      })
    )
    const absRows = buildConfirmationRows(
      createDraft({
        source: 'abs',
        absItem: createAbsItem()
      })
    )

    expect(localRows.find((row) => row.label === 'Output')?.value).toBe('C:\\Output')
    expect(localRows.find((row) => row.label === 'EPUB')?.value).toBe('book.epub')
    expect(absRows.find((row) => row.label === 'Output')?.value).toBe('Upload to ABS automatically')
    expect(absRows.find((row) => row.label === 'EPUB')?.value).toBe('Project Hail Mary.epub')
  })

  it('keeps ABS queue payloads free of renderer-built download URLs', () => {
    const payload = buildQueueJobData(
      createDraft({
        source: 'abs',
        absItem: createAbsItem({
          audioFiles: [
            {
              index: 0,
              ino: '11',
              contentUrl: '/media/project-hail-mary-part-1.mp3',
              metadata: {
                filename: 'project-hail-mary-part-1.mp3',
                ext: '.mp3',
                path: '/books/test/part-1.mp3',
                relPath: 'part-1.mp3'
              },
              duration: 3600,
              mimeType: 'audio/mpeg',
              addedAt: 0,
              updatedAt: 0
            }
          ]
        })
      }),
      {
        absUrl: 'http://abs.local',
        defaultModel: 'large-v3-turbo'
      }
    )

    expect(payload.audioFiles).toEqual([])
    expect(payload.absItemId).toBe('abs-1')
  })
})
