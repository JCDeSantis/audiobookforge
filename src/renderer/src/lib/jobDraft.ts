import type { AbsBookSummary, WhisperModel } from '../../../shared/types'

export interface JobDraft {
  step: 1 | 2 | 3
  source: 'local' | 'abs' | null
  audioFiles: string[]
  absItem: AbsBookSummary | null
  epubPath: string | null
  model: WhisperModel
  outputFolder: string | null
}

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
  const title =
    draft.source === 'abs' && draft.absItem
      ? draft.absItem.title
      : draft.audioFiles[0]
        ? getFilename(draft.audioFiles[0])
        : 'Untitled'

  const epubPath =
    draft.source === 'abs' && draft.absItem?.ebookPath ? draft.absItem.ebookPath : draft.epubPath

  return [
    { label: 'Title', value: title },
    { label: 'Source', value: draft.source === 'abs' ? 'AudioBookShelf' : 'Local file(s)' },
    { label: 'Model', value: draft.model },
    {
      label: 'Output',
      value: draft.source === 'abs' ? 'Upload to ABS automatically' : (draft.outputFolder ?? 'None')
    },
    { label: 'EPUB', value: epubPath ? getFilename(epubPath) : 'None' }
  ]
}

function getFilename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}
