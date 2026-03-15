# AudioBook Forge — Design Spec
**Date:** 2026-03-15
**Status:** Approved

---

## Overview

AudioBook Forge is a standalone Electron desktop app that transcribes audiobooks to SRT subtitle files using a local whisper.cpp pipeline. It is a focused sibling to [videobookforge](https://github.com/JCDeSantis/videobookforge) — all video generation is removed, and two new systems are added: a persistent job queue and AudioBookShelf (ABS) integration.

**Core capabilities:**
- Transcribe `.m4b` / `.mp3` audiobooks (local or from ABS) to `.srt` using whisper.cpp
- Persistent job queue — add multiple books, process one at a time, survives app restarts
- AudioBookShelf integration — browse library, check subtitle status, pull books, auto-upload finished SRTs
- Black + red accent UI (dark theme, Tailwind v4)

---

## Stack

Identical to videobookforge:
- **Runtime:** Electron 36
- **UI:** React 19 + TypeScript + Vite (electron-vite)
- **Styling:** Tailwind v4
- **State:** Zustand 5
- **Build tooling:** electron-vite

New dependency:
- **`keytar`** — OS credential store for ABS API key (Windows Credential Manager / macOS Keychain / Linux Secret Service)

---

## Application Layout

The main window is split into two persistent regions:

### Left — 3-Step Wizard
Used to configure and queue each book. Resets to Step 1 after a job is queued.

**Step 1 — Source**
- Drag-and-drop zone for local `.m4b` / `.mp3` files (multi-part supported)
- "Browse AudioBookShelf" button → opens ABS Library Modal
- Shows selected file(s) or selected ABS book with title + duration once chosen

**Step 2 — Settings**
- Whisper model selector (same model list as videobookforge: Large V3 Turbo default)
- Output folder picker — local files only; hidden for ABS books (SRT uploads back to ABS automatically)
- EPUB display — for ABS books, shows auto-linked ebook title if available; for local files, optional manual EPUB import for vocabulary prompting

**Step 3 — Transcribe**
- Summary of the job (title, model, source, output destination)
- "Add to Queue" button — adds job and resets wizard to Step 1
- If queue is idle (no active job), job starts immediately

### Right — Queue Panel (always visible)
- Header: "Queue" label + job count badge
- Job list, scrollable:
  - **Running:** book title, progress bar + %, estimated time remaining, cancel button
  - **Queued:** book title, source (ABS/local), model name
  - **Done:** book title, outcome ("Saved to /path/book.srt" or "Uploaded to ABS"), dimmed
  - **Failed:** book title, error summary in red, retry button
- Bottom: "ABS Connection Settings" link → opens Settings panel

---

## ABS Library Modal

Opened from Step 1 when the user clicks "Browse AudioBookShelf".

- Lists all ABS libraries, then books within the selected library
- Each book shows: cover art, title, author, duration, subtitle status badge:
  - **No subtitles** — available to queue
  - **Has subtitles** — already done (can still re-queue)
  - **Queued** — already in the local queue
- Search/filter bar
- Click a book → closes modal, populates Step 1 with book details

Status is checked via the ABS item metadata API. The app caches the library listing for the session; a manual refresh button re-fetches.

---

## AudioBookShelf Integration

### Connection
- ABS server URL and API key configured in Settings
- URL stored in `userData/settings.json` (not sensitive)
- API key stored in OS credential store via `keytar` — never written to disk as plaintext
- Connection test button in Settings verifies reachability + auth before saving

### API usage
| Action | ABS API endpoint |
|---|---|
| List libraries | `GET /api/libraries` |
| List books in library | `GET /api/libraries/:id/items` |
| Get book details (incl. ebook/EPUB) | `GET /api/items/:id` |
| Get audio file path / stream | `GET /api/items/:id/play` or direct file path if local |
| Upload subtitle | `POST /api/items/:id/media` with SRT as multipart |

### EPUB auto-linking
When an ABS book has a linked ebook, the ABS item detail response includes the ebook file path. The app reads it directly (same machine) and passes vocabulary terms to whisper as a prompt — no user action required.

### Audio access
- **Same-machine ABS:** audio file path used directly, no copy needed
- **Remote ABS:** audio streamed to a temp directory before transcription begins

---

## Queue System

### Job model
```typescript
interface TranscriptionJob {
  id: string                      // uuid
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  source: 'local' | 'abs'
  title: string
  audioFiles: string[]            // absolute paths
  outputPath: string | null       // null for ABS jobs (uploads back)
  absItemId: string | null        // ABS item ID, null for local
  epubPath: string | null         // optional vocabulary source
  model: WhisperModel
  progress: TranscriptionProgress | null
  srtPath: string | null          // set on completion
  error: string | null
  createdAt: number
  completedAt: number | null
}
```

### Persistence
- Queue saved to `userData/queue.json` on every state change
- On app launch, queue is rehydrated from disk
- Jobs that were `running` at shutdown are reset to `queued`
- `done` and `failed` jobs persist for the session (cleared on app restart or manual clear)

### Execution
- One job runs at a time
- When active job completes or is cancelled, next `queued` job starts automatically
- Cancel: sends cancel signal to whisper process, marks job `cancelled`, advances queue

---

## Whisper Pipeline (transplanted from videobookforge)

The following files are copied verbatim from videobookforge with no modification:

| File | Purpose |
|---|---|
| `src/main/whisper/transcribe.ts` | Orchestrates full pipeline: binary check → model check → WAV conversion → silence segmentation → segmented transcription → SRT merge |
| `src/main/whisper/segments.ts` | Silence detection + greedy segment builder (min 60s, max 1200s, ±0.35s padding) |
| `src/main/whisper/binary.ts` | whisper.cpp binary download + GPU detection |
| `src/main/whisper/models.ts` | Model list + download URLs (includes Large V3 Turbo Q5) |
| `src/main/ffmpeg/probe.ts` | ffprobe wrapper + duration extraction |
| `src/main/ffmpeg/concat.ts` | Multi-part audio concatenation via ffmpeg concat demuxer |

**Dropped from videobookforge:**
- `src/main/ffmpeg/background.ts` — background video stream generation
- `src/main/ffmpeg/convert.ts` — video encoding pipeline
- `src/main/metadata/musicbrainz.ts`, `openlibrary.ts`, `googlebooks.ts` — online metadata lookup

---

## IPC Architecture

### Main process modules

| Module | Key channels |
|---|---|
| `whisper.ipc.ts` | `whisper:transcribe`, `whisper:cancel`, `whisper:progress` (event), `whisper:storage` |
| `files.ipc.ts` | `files:pick-audio`, `files:pick-epub`, `files:pick-output-folder`, `files:show-in-explorer` |
| `queue.ipc.ts` | `queue:add`, `queue:remove`, `queue:reorder`, `queue:cancel`, `queue:get-all` |
| `abs.ipc.ts` | `abs:test-connection`, `abs:get-libraries`, `abs:get-books`, `abs:get-book`, `abs:upload-subtitle` |
| `settings.ipc.ts` | `settings:get`, `settings:set` (URL), `settings:set-api-key`, `settings:get-api-key` |

### Preload bridge
All channels exposed through typed IPC wrappers in `src/preload/index.ts`, same pattern as videobookforge.

---

## State (Zustand)

```typescript
// App-level settings (persisted)
interface AppSettings {
  absUrl: string
  defaultModel: WhisperModel
}

// Wizard state (ephemeral, resets after queue)
interface WizardState {
  step: 1 | 2 | 3
  source: 'local' | 'abs' | null
  audioFiles: string[]
  absItem: AbsBookSummary | null
  epubPath: string | null
  model: WhisperModel
  outputFolder: string | null
}

// Queue (persisted via queue.ipc)
interface QueueState {
  jobs: TranscriptionJob[]
  activeJobId: string | null
}

// ABS library cache (session only)
interface AbsLibraryState {
  connected: boolean
  libraries: AbsLibrary[]
  books: Record<string, AbsBook[]>   // keyed by libraryId
  lastFetched: number | null
}
```

---

## Security

- **ABS API key** stored exclusively via `keytar` in the OS credential store
- Key is never written to `settings.json`, log files, or IPC event payloads
- `settings:get-api-key` IPC channel returns key only to the renderer for the connection test; not stored in Zustand state after initial load
- ABS URL is non-sensitive and stored in `userData/settings.json`

---

## Project Structure

```
audiobookforge/
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc/
│   │   │   ├── whisper.ipc.ts      # transplanted + adapted
│   │   │   ├── files.ipc.ts        # transplanted + adapted
│   │   │   ├── queue.ipc.ts        # new
│   │   │   ├── abs.ipc.ts          # new
│   │   │   └── settings.ipc.ts     # new
│   │   ├── whisper/                # transplanted verbatim
│   │   │   ├── transcribe.ts
│   │   │   ├── segments.ts
│   │   │   ├── binary.ts
│   │   │   └── models.ts
│   │   └── ffmpeg/
│   │       ├── probe.ts            # transplanted verbatim
│   │       └── concat.ts           # transplanted verbatim
│   ├── renderer/src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── SourcePage.tsx      # Step 1
│   │   │   ├── SettingsPage.tsx    # Step 2
│   │   │   └── TranscribePage.tsx  # Step 3
│   │   ├── components/
│   │   │   ├── QueuePanel.tsx
│   │   │   ├── AbsLibraryModal.tsx
│   │   │   └── AppSettingsPanel.tsx
│   │   ├── store/
│   │   │   └── useAppStore.ts
│   │   └── lib/
│   │       ├── ipc.ts
│   │       └── whisperModels.ts    # transplanted
│   ├── preload/
│   │   └── index.ts
│   └── shared/
│       └── types.ts
├── docs/
│   └── superpowers/specs/
│       └── 2026-03-15-audiobookforge-design.md
└── package.json
```

---

## Out of Scope (v1)

- Background video generation (removed entirely)
- Online metadata lookup (MusicBrainz, Open Library, Google Books)
- Subtitle burn-in or any video output format
- Multiple simultaneous transcription jobs
- ABS webhook / push notifications
- Automatic re-transcription when ABS library changes
