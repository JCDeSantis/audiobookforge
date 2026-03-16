import React, { useCallback, useEffect, useState } from 'react'
import type { AbsBook } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

function SubtitleBadge({ book, inQueue }: { book: AbsBook; inQueue: boolean }): React.JSX.Element {
  if (inQueue) {
    return (
      <span className="rounded-full bg-[#1c2b52] px-2.5 py-1 text-[11px] font-medium text-[#c8daff]">
        In Queue
      </span>
    )
  }

  if (book.hasSubtitles) {
    return (
      <span className="rounded-full bg-[#183824] px-2.5 py-1 text-[11px] font-medium text-[#9fe0bb]">
        Has SRT
      </span>
    )
  }

  return (
    <span className="rounded-full bg-[#251010] px-2.5 py-1 text-[11px] font-medium text-[#d3abab]">
      No SRT
    </span>
  )
}

export function AbsLibraryModal(): React.JSX.Element {
  const {
    settings,
    absLibrary,
    queue,
    setAbsLibraries,
    setAbsBooks,
    setAbsConnected,
    selectAbsItem,
    setAbsModalOpen,
    setSettingsOpen
  } = useAppStore()

  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)

  const queuedAbsIds = new Set(
    queue.jobs
      .filter(
        (job) => job.source === 'abs' && (job.status === 'queued' || job.status === 'running')
      )
      .map((job) => job.absItemId)
      .filter(Boolean) as string[]
  )

  const handleOpenSettings = (): void => {
    setAbsModalOpen(false)
    setSettingsOpen(true)
  }

  const loadLibraries = useCallback(async (): Promise<void> => {
    if (!settings.absUrl) {
      setError('Add your AudioBookShelf URL in Settings before browsing the library.')
      setAbsConnected(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const libraries = await window.electron.abs.getLibraries()
      setAbsLibraries(libraries)
      setAbsConnected(true)
      if (libraries.length > 0 && !selectedLibraryId) {
        setSelectedLibraryId(libraries[0].id)
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to connect to AudioBookShelf.'
      )
      setAbsConnected(false)
    } finally {
      setLoading(false)
    }
  }, [selectedLibraryId, setAbsConnected, setAbsLibraries, settings.absUrl])

  const loadBooks = useCallback(
    async (libraryId: string): Promise<void> => {
      if (absLibrary.books[libraryId]) {
        return
      }

      setLoading(true)
      setError(null)
      try {
        const books = await window.electron.abs.getBooks(libraryId)
        setAbsBooks(libraryId, books)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load books.')
      } finally {
        setLoading(false)
      }
    },
    [absLibrary.books, setAbsBooks]
  )

  const handleRefresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const libraries = await window.electron.abs.getLibraries()
      setAbsLibraries(libraries)

      if (selectedLibraryId) {
        const books = await window.electron.abs.getBooks(selectedLibraryId)
        setAbsBooks(selectedLibraryId, books)
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Refresh failed.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!settings.absUrl) {
      setError('Add your AudioBookShelf URL in Settings before browsing the library.')
      return
    }

    if (absLibrary.libraries.length === 0) {
      void loadLibraries()
      return
    }

    if (!selectedLibraryId && absLibrary.libraries.length > 0) {
      setSelectedLibraryId(absLibrary.libraries[0].id)
    }
  }, [settings.absUrl, absLibrary.libraries, loadLibraries, selectedLibraryId])

  useEffect(() => {
    if (selectedLibraryId) {
      void loadBooks(selectedLibraryId)
    }
  }, [loadBooks, selectedLibraryId])

  const currentBooks = selectedLibraryId ? (absLibrary.books[selectedLibraryId] ?? []) : []
  const filteredBooks = search
    ? currentBooks.filter(
        (book) =>
          book.title.toLowerCase().includes(search.toLowerCase()) ||
          book.authorName.toLowerCase().includes(search.toLowerCase())
      )
    : currentBooks

  const handleSelectBook = async (book: AbsBook): Promise<void> => {
    setSelecting(book.id)
    try {
      const fullBook = await window.electron.abs.getBook(book.id)
      selectAbsItem({
        id: fullBook.id,
        libraryId: fullBook.libraryId,
        folderId: fullBook.folderId,
        relPath: fullBook.relPath,
        isFile: fullBook.isFile,
        title: fullBook.title,
        authorName: fullBook.authorName,
        duration: fullBook.duration,
        cover: fullBook.cover,
        hasSubtitles: fullBook.hasSubtitles,
        ebookPath: fullBook.ebookPath,
        audioFiles: fullBook.audioFiles
      })
      setAbsModalOpen(false)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load book details.')
    } finally {
      setSelecting(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        aria-labelledby="abs-library-title"
        aria-modal="true"
        className="flex h-[min(760px,calc(100vh-48px))] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-[#452020] bg-[linear-gradient(180deg,#150808_0%,#0d0404_100%)] shadow-[0_30px_90px_rgba(0,0,0,0.55)]"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#351616] px-6 py-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b78787]">
              Source Browser
            </div>
            <h2 id="abs-library-title" className="mt-3 text-2xl font-semibold text-[#fff4f4]">
              AudioBookShelf Library
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#d9b7b7]">
              Pick a book from your library, keep duplicate work visible, and send the selection
              straight back into the composer.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="rounded-full border border-[#4b2222] px-4 py-2 text-sm text-[#f0d0d0] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading || !settings.absUrl}
              onClick={handleRefresh}
              type="button"
            >
              Refresh
            </button>
            <button
              className="rounded-full border border-[#4b2222] px-4 py-2 text-sm text-[#f0d0d0] transition-colors hover:border-[#dc2626] hover:text-[#fff4f4]"
              onClick={() => setAbsModalOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-[#4d1f1f] bg-[#180909] px-6 py-4 text-sm leading-6 text-[#ffb0b0]">
            <div>{error}</div>
            {!settings.absUrl && (
              <button
                className="mt-3 rounded-full border border-[#7f1d1d] px-4 py-2 text-sm font-medium text-[#ffe1e1] transition-colors hover:border-[#dc2626] hover:text-white"
                onClick={handleOpenSettings}
                type="button"
              >
                Open Settings
              </button>
            )}
          </div>
        )}

        {absLibrary.libraries.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-[#351616] px-6 py-4">
            {absLibrary.libraries.map((library) => (
              <button
                key={library.id}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  library.id === selectedLibraryId
                    ? 'border-[#dc2626] bg-[#220c0c] text-[#fff1f1]'
                    : 'border-[#3d1d1d] bg-[#120707] text-[#d3aaaa] hover:border-[#dc2626] hover:text-[#fff1f1]'
                }`}
                onClick={() => setSelectedLibraryId(library.id)}
                type="button"
              >
                {library.name}
              </button>
            ))}
          </div>
        )}

        <div className="border-b border-[#351616] px-6 py-4">
          <input
            className="w-full rounded-[18px] border border-[#482020] bg-[#170909] px-4 py-3 text-sm text-[#fff4f4] outline-none transition-colors placeholder:text-[#8c5d5d] focus:border-[#dc2626]"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or author"
            value={search}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-[#cba8a8]">
              Loading library data...
            </div>
          )}

          {!loading && filteredBooks.length === 0 && (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-[#3a1b1b] bg-[#110606] px-6 text-center text-sm leading-6 text-[#a77d7d]">
              {absLibrary.libraries.length === 0
                ? 'Once your AudioBookShelf connection is set, your libraries will show up here.'
                : 'No books matched this search.'}
            </div>
          )}

          {!loading && filteredBooks.length > 0 && (
            <div className="grid gap-3">
              {filteredBooks.map((book) => (
                <button
                  key={book.id}
                  className={`flex items-center gap-4 rounded-[24px] border px-4 py-4 text-left transition-colors ${
                    selecting === book.id
                      ? 'cursor-wait border-[#5b2626] bg-[#1a0a0a] opacity-75'
                      : selecting !== null
                        ? 'cursor-not-allowed border-[#2a1515] bg-[#100606] opacity-45'
                        : 'border-[#301717] bg-[#120707] hover:border-[#dc2626] hover:bg-[#190909]'
                  }`}
                  disabled={selecting !== null}
                  onClick={() => void handleSelectBook(book)}
                  type="button"
                >
                  {book.cover ? (
                    <img
                      alt={book.title}
                      className="h-16 w-12 flex-shrink-0 rounded-[12px] object-cover"
                      onError={(event) => {
                        ;(event.target as HTMLImageElement).style.display = 'none'
                      }}
                      src={book.cover}
                    />
                  ) : (
                    <div className="flex h-16 w-12 flex-shrink-0 items-center justify-center rounded-[12px] border border-[#3a1d1d] bg-[#1b0b0b] text-lg text-[#d8b6b6]">
                      BK
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-6 text-[#fff1f1]">
                      {book.title}
                    </div>
                    <div className="text-sm text-[#c7a2a2]">
                      {book.authorName} - {formatDuration(book.duration)}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    {selecting === book.id ? (
                      <span className="rounded-full bg-[#251010] px-2.5 py-1 text-[11px] font-medium text-[#d3abab]">
                        Loading...
                      </span>
                    ) : (
                      <SubtitleBadge book={book} inQueue={queuedAbsIds.has(book.id)} />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
