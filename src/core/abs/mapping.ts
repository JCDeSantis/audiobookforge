import { extname } from 'path'
import type { AbsAudioFile, AbsBook } from '../../shared/types'

export interface AbsApiLibrary {
  id: string
  name: string
  mediaType: string
}

interface AbsApiAudioFile {
  index: number
  ino: string
  metadata: { filename: string; ext: string; path: string; relPath: string }
  duration: number
  mimeType: string
  addedAt: number
  updatedAt: number
}

interface AbsApiTrack {
  index?: number
  contentUrl?: string
  metadata?: { path?: string }
}

interface AbsApiLibraryFile {
  relPath?: string
  metadata?: { ext?: string }
}

export interface AbsApiItem {
  id: string
  libraryId?: string
  folderId?: string
  relPath?: string
  isFile?: boolean
  libraryFiles?: AbsApiLibraryFile[]
  media?: {
    metadata?: { title?: string; authorName?: string }
    duration?: number
    coverPath?: string
    audioFiles?: AbsApiAudioFile[]
    ebookFile?: { ino?: string; metadata?: { path?: string } } | null
    tracks?: AbsApiTrack[]
  }
}

function isSubtitleFile(file: AbsApiLibraryFile): boolean {
  const extension = (file.metadata?.ext ?? extname(file.relPath ?? '')).toLowerCase()
  return ['.srt', '.vtt', '.lrc', '.ass', '.ssa', '.sub'].includes(extension)
}

export function mapAbsItemToBook(item: AbsApiItem, baseUrl: string): AbsBook {
  const media = item.media ?? {}
  const metadata = media.metadata ?? {}
  const contentByIndex = new Map<number, string>()
  const contentByPath = new Map<string, string>()
  for (const track of media.tracks ?? []) {
    if (!track.contentUrl) continue
    if (typeof track.index === 'number') contentByIndex.set(track.index, track.contentUrl)
    if (track.metadata?.path) contentByPath.set(track.metadata.path, track.contentUrl)
  }
  const audioFiles: AbsAudioFile[] = [...(media.audioFiles ?? [])]
    .sort((left, right) => left.index - right.index)
    .map((file) => ({
      ...file,
      contentUrl: contentByPath.get(file.metadata.path) ?? contentByIndex.get(file.index) ?? null
    }))
  return {
    id: item.id,
    libraryId: item.libraryId ?? '',
    folderId: item.folderId ?? '',
    relPath: item.relPath ?? '',
    isFile: item.isFile ?? false,
    title: metadata.title ?? 'Unknown',
    authorName: metadata.authorName ?? 'Unknown',
    duration: media.duration ?? 0,
    cover: media.coverPath ? `${baseUrl}/api/items/${item.id}/cover` : null,
    hasSubtitles: (item.libraryFiles ?? []).some(isSubtitleFile),
    ebookPath: media.ebookFile?.metadata?.path ?? null,
    ebookDownloadUrl: media.ebookFile?.ino
      ? `${baseUrl}/api/items/${item.id}/file/${media.ebookFile.ino}/download`
      : null,
    audioFiles
  }
}
