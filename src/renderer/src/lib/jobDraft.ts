import type {
  AbsBookSummary,
  AppSettings,
  TranscriptionJob,
  WhisperModel
} from '../../../shared/types'
import { getLocalSourceTitle } from './sourceTitle'

export interface JobDraft {
  step: 1 | 2 | 3
  source: 'local' | 'abs' | null
  audioFiles: string[]
  absItem: AbsBookSummary | null
  epubPath: string | null
  model: WhisperModel
  outputFolder: string | null
}

export type QueueAddPayload = Omit<
  TranscriptionJob,
  'id' | 'status' | 'progress' | 'srtPath' | 'srtPaths' | 'error' | 'createdAt' | 'completedAt'
>

export function selectLocalFiles(draft: JobDraft, audioFiles: string[]): JobDraft {
  return {
    ...draft,
    source: 'local',
    audioFiles,
    absItem: null
  }
}

export function selectAbsItem(draft: JobDraft, absItem: AbsBookSummary): JobDraft {
  return {
    ...draft,
    source: 'abs',
    absItem,
    audioFiles: [],
    outputFolder: null
  }
}

export function clearSelectedSource(draft: JobDraft): JobDraft {
  return {
    ...draft,
    source: null,
    audioFiles: [],
    absItem: null,
    epubPath: null,
    outputFolder: null
  }
}

export function canContinue(draft: JobDraft): boolean {
  if (draft.source === 'local') {
    return draft.audioFiles.length > 0 && Boolean(draft.outputFolder)
  }

  if (draft.source === 'abs') {
    return draft.absItem !== null
  }

  return false
}

export function buildConfirmationRows(draft: JobDraft): Array<{ label: string; value: string }> {
  const epubPath =
    draft.source === 'abs' && draft.absItem?.ebookPath ? draft.absItem.ebookPath : draft.epubPath

  return [
    { label: 'Title', value: getDraftTitle(draft) },
    { label: 'Source', value: draft.source === 'abs' ? 'AudioBookShelf' : 'Local file(s)' },
    { label: 'Model', value: draft.model },
    {
      label: 'Output',
      value: draft.source === 'abs' ? 'Upload to ABS automatically' : (draft.outputFolder ?? 'None')
    },
    { label: 'EPUB', value: epubPath ? getFilename(epubPath) : 'None' }
  ]
}

export function buildQueueJobData(draft: JobDraft, settings: AppSettings): QueueAddPayload {
  if (draft.source === 'local') {
    return {
      source: 'local',
      title: getDraftTitle(draft),
      audioFiles: draft.audioFiles,
      outputPath: draft.outputFolder,
      absItemId: null,
      absLibraryId: null,
      absFolderId: null,
      absAuthorName: null,
      epubPath: draft.epubPath,
      model: draft.model
    }
  }

  if (draft.source === 'abs' && draft.absItem) {
    const absBaseUrl = settings.absUrl.replace(/\/$/, '')

    return {
      source: 'abs',
      title: draft.absItem.title,
      audioFiles: draft.absItem.audioFiles.map((audioFile) => {
        if (audioFile.contentUrl) {
          return new URL(audioFile.contentUrl, `${absBaseUrl}/`).toString()
        }

        return `${absBaseUrl}/api/items/${draft.absItem?.id}/file/${audioFile.ino}/download`
      }),
      outputPath: null,
      absItemId: draft.absItem.id,
      absLibraryId: draft.absItem.libraryId,
      absFolderId: draft.absItem.folderId,
      absAuthorName: draft.absItem.authorName,
      epubPath: draft.absItem.ebookPath ?? draft.epubPath,
      model: draft.model
    }
  }

  throw new Error('Cannot build queue job data without a selected source')
}

function getDraftTitle(draft: JobDraft): string {
  if (draft.source === 'abs' && draft.absItem) {
    return draft.absItem.title
  }

  const localTitle = getLocalSourceTitle(draft.audioFiles)
  return localTitle || 'Untitled'
}

function getFilename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}
