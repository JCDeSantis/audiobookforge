import React, { useCallback, useEffect, useState } from 'react'
import type { AbsBook } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'

type BookSortOption = 'title' | 'author' | 'missing-srt' | 'has-srt'

const SORT_OPTIONS: Array<{ value: BookSortOption; label: string }> = [
  { value: 'title', label: 'Book name' },
  { value: 'author', label: 'Author' },
  { value: 'missing-srt', label: 'No SRT first' },
  { value: 'has-srt', label: 'Has SRT first' }
]

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function sortBooks(books: AbsBook[], sortBy: BookSortOption): AbsBook[] {
  return [...books].sort((left, right) => {
    if (sortBy === 'author') {
      return (
        compareText(left.authorName, right.authorName) ||
        compareText(left.title, right.title)
      )
    }

    if (sortBy === 'missing-srt') {
      return (
        Number(left.hasSubtitles) - Number(right.hasSubtitles) ||
        compareText(left.title, right.title)
      )
    }

    if (sortBy === 'has-srt') {
      return (
        Number(right.hasSubtitles) - Number(left.hasSubtitles) ||
        compareText(left.title, right.title)
      )
    }

    return (
      compareText(left.title, right.title) ||
      compareText(left.authorName, right.authorName)
    )
  })
}

function formatBookCount(count: number): string {
  return `${count} ${count === 1 ? 'title' : 'titles'}`
}

function SubtitleBadge({ book, inQueue }: { book: AbsBook; inQueue: boolean }): React.JSX.Element {
  if (inQueue) {
    return (
      <span className="rounded-full border border-[#3558a8] bg-[#132347]/95 px-2.5 py-1 text-[11px] font-medium text-[#dbe7ff]">
        In Queue
      </span>
    )
  }

  if (book.hasSubtitles) {
    return (
      <span className="rounded-full border border-[#245335] bg-[#102417]/95 px-2.5 py-1 text-[11px] font-medium text-[#9fe0bb]">
        Has SRT
      </span>
    )
  }

  return (
    <span className="rounded-full border border-[#5a2828] bg-[#251010]/95 px-2.5 py-1 text-[11px] font-medium text-[#ffd2d2]">
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
    selectAbsItems,
    setAbsModalOpen,
    setSettingsOpen
  } = useAppStore()

  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<BookSortOption>('missing-srt')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false)
  const [selectedBooks, setSelectedBooks] = useState<AbsBook[]>([])

  const queuedAbsIds = new Set(
    queue.jobs
      .filter(
        (job) => job.source === 'abs' && (job.status === 'queued' || job.status === 'running')
      )
      .map((job) => job.absItemId)
      .filter(Boolean) as string[]
  )
  const selectedBookIds = new Set(selectedBooks.map((book) => book.id))
  const selectedBookOrder = new Map(selectedBooks.map((book, index) => [book.id, index + 1]))

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
  const normalizedSearch = search.trim().toLowerCase()
  const filteredBooks = normalizedSearch
    ? currentBooks.filter(
        (book) =>
          book.title.toLowerCase().includes(normalizedSearch) ||
          book.authorName.toLowerCase().includes(normalizedSearch)
      )
    : currentBooks
  const visibleBooks = sortBooks(filteredBooks, sortBy)

  const handleToggleMultiSelect = (): void => {
    setMultiSelectEnabled((current) => {
      if (current) {
        setSelectedBooks([])
      }

      return !current
    })
  }

  const handleSelectBook = (book: AbsBook): void => {
    selectAbsItems([book])
    setAbsModalOpen(false)
  }

  const handleToggleBookSelection = (book: AbsBook): void => {
    setSelectedBooks((current) =>
      current.some((selected) => selected.id === book.id)
        ? current.filter((selected) => selected.id !== book.id)
        : [...current, book]
    )
  }

  const handleUseSelectedBooks = (): void => {
    if (selectedBooks.length === 0) {
      return
    }

    selectAbsItems(selectedBooks)
    setSelectedBooks([])
    setMultiSelectEnabled(false)
    setAbsModalOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        aria-labelledby="abs-library-title"
        aria-modal="true"
        className="flex h-[min(780px,calc(100vh-48px))] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-[#452020] bg-[linear-gradient(180deg,#150808_0%,#0d0404_100%)] shadow-[0_30px_90px_rgba(0,0,0,0.55)]"
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
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {multiSelectEnabled && (
              <button
                className="rounded-full border border-[#8a2d2d] bg-[#2a0f0f] px-4 py-2 text-sm font-medium text-[#fff0f0] shadow-[0_10px_24px_rgba(120,20,20,0.18)] transition-colors hover:border-[#dc2626] hover:bg-[#341212] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={selectedBooks.length === 0}
                onClick={handleUseSelectedBooks}
                type="button"
              >
                Add Selected ({selectedBooks.length})
              </button>
            )}
            <button
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                multiSelectEnabled
                  ? 'border-[#8a2d2d] bg-[#2a0f0f] text-[#fff1f1] shadow-[0_10px_24px_rgba(120,20,20,0.18)] hover:border-[#dc2626] hover:bg-[#341212]'
                  : 'border-[#5a2626] bg-[#170909] text-[#f0d0d0] hover:border-[#dc2626] hover:bg-[#210c0c] hover:text-[#fff4f4]'
              }`}
              disabled={loading || !settings.absUrl}
              onClick={handleToggleMultiSelect}
              type="button"
            >
              {multiSelectEnabled ? 'Exit Batch Select' : 'Batch Select'}
            </button>
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <label className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b78787]">
                Search
              </div>
              <input
                className="w-full rounded-[18px] border border-[#482020] bg-[#170909] px-4 py-3 text-sm text-[#fff4f4] outline-none transition-colors placeholder:text-[#8c5d5d] focus:border-[#dc2626]"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by title or author"
                value={search}
              />
            </label>

            <label className="w-full lg:w-[240px]">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b78787]">
                Sort by
              </div>
              <select
                className="w-full rounded-[18px] border border-[#482020] bg-[#170909] px-4 py-3 text-sm text-[#fff4f4] outline-none transition-colors focus:border-[#dc2626]"
                onChange={(event) => setSortBy(event.target.value as BookSortOption)}
                value={sortBy}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-[#9f7373]">
            <span>{formatBookCount(visibleBooks.length)}</span>
            <span>
              {multiSelectEnabled
                ? `${selectedBooks.length} selected${selectedLibraryId ? ' - click titles to toggle them' : ''}`
                : selectedLibraryId
                  ? 'Click any title to load it into the composer'
                  : ''}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-[#cba8a8]">
              Loading library data...
            </div>
          )}

          {!loading && visibleBooks.length === 0 && (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-[#3a1b1b] bg-[#110606] px-6 text-center text-sm leading-6 text-[#a77d7d]">
              {absLibrary.libraries.length === 0
                ? 'Once your AudioBookShelf connection is set, your libraries will show up here.'
                : 'No books matched this search.'}
            </div>
          )}

          {!loading && visibleBooks.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {visibleBooks.map((book) => {
                const isQueued = queuedAbsIds.has(book.id)
                const isSelected = selectedBookIds.has(book.id)
                const selectionNumber = selectedBookOrder.get(book.id)

                return (
                  <button
                    key={book.id}
                    className={`flex h-full flex-col rounded-[22px] border px-4 py-3.5 text-left transition-all ${
                      isSelected
                        ? 'border-[#dc2626] bg-[#1c0a0a] shadow-[0_16px_40px_rgba(120,20,20,0.22)]'
                        : 'border-[#301717] bg-[linear-gradient(180deg,#150808_0%,#100505_100%)] hover:border-[#dc2626] hover:bg-[#190909]'
                    }`}
                    aria-pressed={multiSelectEnabled ? isSelected : undefined}
                    onClick={() =>
                      multiSelectEnabled ? handleToggleBookSelection(book) : handleSelectBook(book)
                    }
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold leading-6 text-[#fff1f1]">
                          {book.title}
                        </h3>
                        <div className="mt-1 text-sm leading-5 text-[#d4afaf]">{book.authorName}</div>
                      </div>

                      <div className="flex-shrink-0">
                        {isSelected && selectionNumber ? (
                          <div className="rounded-full border border-[#7f1d1d] bg-[#2a0f0f]/95 px-2.5 py-1 text-[11px] font-medium text-[#ffe2e2]">
                            Selected {selectionNumber}
                          </div>
                        ) : (
                          <SubtitleBadge book={book} inQueue={isQueued} />
                        )}
                      </div>
                    </div>

                    <div className="mt-3 border-t border-[#341616] pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b98a8a]">
                          Audiobook Length
                        </span>
                        <span className="text-sm text-[#f2d6d6]">{formatDuration(book.duration)}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
