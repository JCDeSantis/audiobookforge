import type {
  AbsBookSummary,
  AppSettings,
  TranscriptionJob,
  WhisperModel
} from '../../../shared/types'
import { getLocalSourceTitle } from './sourceTitle'

export interface JobDraft {
  source: 'local' | 'abs' | null
  audioFiles: string[]
  absItem: AbsBookSummary | null
  absItems: AbsBookSummary[]
  epubPath: string | null
  model: WhisperModel
  outputFolder: string | null
}

export type QueueAddPayload = Omit<
  TranscriptionJob,
  'id' | 'status' | 'progress' | 'srtPath' | 'srtPaths' | 'error' | 'createdAt' | 'startedAt' | 'completedAt'
>

export function selectLocalFiles(draft: JobDraft, audioFiles: string[]): JobDraft {
  return {
    ...draft,
    source: 'local',
    audioFiles,
    absItem: null,
    absItems: []
  }
}

export function selectAbsItem(draft: JobDraft, absItem: AbsBookSummary): JobDraft {
  return selectAbsItems(draft, [absItem])
}

export function selectAbsItems(draft: JobDraft, absItems: AbsBookSummary[]): JobDraft {
  return {
    ...draft,
    source: 'abs',
    absItem: absItems[0] ?? null,
    absItems,
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
    absItems: [],
    epubPath: null,
    outputFolder: null
  }
}

export function canContinue(draft: JobDraft): boolean {
  if (draft.source === 'local') {
    return draft.audioFiles.length > 0 && Boolean(draft.outputFolder)
  }

  if (draft.source === 'abs') {
    return getSelectedAbsItems(draft).length > 0
  }

  return false
}

export function buildConfirmationRows(draft: JobDraft): Array<{ label: string; value: string }> {
  const selectedAbsItems = getSelectedAbsItems(draft)
  const isMultiAbsSelection = draft.source === 'abs' && selectedAbsItems.length > 1

  return [
    { label: isMultiAbsSelection ? 'Books' : 'Title', value: getDraftTitle(draft) },
    { label: 'Source', value: draft.source === 'abs' ? 'AudioBookShelf' : 'Local file(s)' },
    { label: 'Model', value: draft.model },
    {
      label: 'Output',
      value: draft.source === 'abs' ? 'Upload to ABS automatically' : (draft.outputFolder ?? 'None')
    },
    { label: 'EPUB', value: getDraftEpubSummary(draft) }
  ]
}

export function buildQueueJobData(draft: JobDraft, settings: AppSettings): QueueAddPayload {
  const [firstPayload] = buildQueueJobPayloads(draft, settings)

  if (!firstPayload) {
    throw new Error('Cannot build queue job data without a selected source')
  }

  return firstPayload
}

export function buildQueueJobPayloads(draft: JobDraft, _settings: AppSettings): QueueAddPayload[] {
  if (draft.source === 'local') {
    return [
      {
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
    ]
  }

  const selectedAbsItems = getSelectedAbsItems(draft)
  if (draft.source === 'abs' && selectedAbsItems.length > 0) {
    return selectedAbsItems.map((absItem) => ({
      source: 'abs',
      title: absItem.title,
      audioFiles: [],
      outputPath: null,
      absItemId: absItem.id,
      absLibraryId: absItem.libraryId,
      absFolderId: absItem.folderId,
      absAuthorName: absItem.authorName,
      epubPath: absItem.ebookPath ?? draft.epubPath,
      model: draft.model
    }))
  }

  throw new Error('Cannot build queue job data without a selected source')
}

function getDraftTitle(draft: JobDraft): string {
  const selectedAbsItems = getSelectedAbsItems(draft)

  if (draft.source === 'abs' && selectedAbsItems.length > 1) {
    return `${selectedAbsItems.length} selected books`
  }

  if (draft.source === 'abs' && selectedAbsItems[0]) {
    return selectedAbsItems[0].title
  }

  const localTitle = getLocalSourceTitle(draft.audioFiles)
  return localTitle || 'Untitled'
}

function getFilename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function getSelectedAbsItems(draft: JobDraft): AbsBookSummary[] {
  if (draft.absItems.length > 0) {
    return draft.absItems
  }

  return draft.absItem ? [draft.absItem] : []
}

function getDraftEpubSummary(draft: JobDraft): string {
  if (draft.source !== 'abs') {
    return draft.epubPath ? getFilename(draft.epubPath) : 'None'
  }

  const selectedAbsItems = getSelectedAbsItems(draft)
  const linkedEpubCount = selectedAbsItems.filter((item) => item.ebookPath).length

  if (selectedAbsItems.length <= 1) {
    const epubPath = selectedAbsItems[0]?.ebookPath ?? draft.epubPath
    return epubPath ? getFilename(epubPath) : 'None'
  }

  if (linkedEpubCount === selectedAbsItems.length) {
    return `Linked from ABS for all ${selectedAbsItems.length} books`
  }

  if (linkedEpubCount > 0) {
    const manualFallback = draft.epubPath ? `, plus ${getFilename(draft.epubPath)}` : ''
    return `${linkedEpubCount} of ${selectedAbsItems.length} linked from ABS${manualFallback}`
  }

  return draft.epubPath ? getFilename(draft.epubPath) : 'None'
}
