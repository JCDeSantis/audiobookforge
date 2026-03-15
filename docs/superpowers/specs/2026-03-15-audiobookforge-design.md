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
  - **Has subtitles** — already done; user can still re-queue (app will overwrite/replace the existing SRT on upload)
  - **Queued** — already in the local queue
- Search/filter bar
- Click a book → closes modal, populates Step 1 with book details

Status is checked via the ABS item metadata API (`audioFiles[].subtitleTracks` or equivalent field in the item response). The app caches the library listing for the session; a manual refresh button re-fetches.

---

## AudioBookShelf Integration

### Connection
- ABS server URL and API key configured in Settings
- URL stored in `userData/settings.json` (not sensitive)
- API key stored in OS credential store via `keytar` — never written to disk as plaintext
- Connection test button in Settings verifies reachability + auth before saving

### API usage

All ABS HTTP calls are made from the **main process** only. The API key is retrieved from `keytar` in the main process per-call and never sent to the renderer.

| Action | ABS API endpoint |
|---|---|
| List libraries | `GET /api/libraries` |
| List books in library | `GET /api/libraries/:id/items?limit=100&page=0` |
| Get book details (incl. ebook/audio paths) | `GET /api/items/:id?expanded=1` |
| Upload subtitle | `POST /api/items/:id/upload` — multipart form; field `files` = SRT file. **Verify exact field names and response shape against target ABS version before implementation.** |

> **Note on subtitle upload:** The ABS REST API for file attachment to a library item is `POST /api/items/:id/upload`. The multipart field name and accepted file types must be confirmed against the running ABS instance version during implementation. If the endpoint returns a conflict for existing subtitles, the app should first attempt deletion of the existing subtitle track via `DELETE /api/items/:id/audio-tracks/:index` (if applicable) before re-uploading. Treat this endpoint as "verify-first" in implementation.

### EPUB auto-linking
When an ABS book has a linked ebook, the `GET /api/items/:id?expanded=1` response includes the ebook file path. The app reads it directly (same-machine ABS) and passes vocabulary terms to whisper as a prompt — no user action required. For remote ABS, EPUB auto-linking is skipped (v1 limitation).

### Audio access
- **Same-machine ABS:** audio file path from the item response used directly — no copy needed
- **Remote ABS:** full audio download to `userData/temp/<jobId>/` before transcription begins. Download uses the ABS audio stream URL from the item's `audioFiles` array. Temp directory is created when the job starts and deleted after the job completes (success, failure, or cancel).

**Restart recovery for remote ABS jobs:** On app launch, any job found in `queue.json` with `status: 'running'` is reset to `'queued'`. For remote ABS jobs, the associated `userData/temp/<jobId>/` directory (if it exists) is deleted on reset, forcing a clean re-download when the job runs again.

---

## Queue System

### Job model
```typescript
interface TranscriptionJob {
  id: string                      // uuid
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  source: 'local' | 'abs'
  title: string
  audioFiles: string[]            // absolute paths (local files or downloaded temp paths)
  outputPath: string | null       // output folder for local jobs; null for ABS jobs
  absItemId: string | null        // ABS item ID; null for local jobs
  epubPath: string | null         // optional vocabulary source
  model: WhisperModel
  progress: TranscriptionProgress | null
  srtPath: string | null          // temp SRT path during/after transcription;
                                  // for ABS jobs: set during transcription, deleted after upload
                                  // for local jobs: final saved path
  error: string | null
  createdAt: number
  completedAt: number | null
}
```

### Persistence
- Queue saved to `userData/queue.json` on every state change
- On app launch, queue is rehydrated from disk
- Jobs that were `running` at shutdown are reset to `queued` (see remote ABS restart recovery above)
- `done` and `failed` jobs persist until manually cleared by the user (no auto-clear on restart)

### Execution
- One job runs at a time
- When active job completes or is cancelled, next `queued` job starts automatically
- Cancel: sends cancel signal to whisper process, marks job `cancelled`, cleans up temp files, advances queue

---

## Whisper Pipeline (transplanted from videobookforge)

The following files are **copied verbatim** from videobookforge:

| File | Purpose |
|---|---|
| `src/main/whisper/segments.ts` | Silence detection + greedy segment builder (min 60s, max 1200s, ±0.35s padding) |
| `src/main/whisper/binary.ts` | whisper.cpp binary download + GPU detection |
| `src/main/whisper/models.ts` | Model list + download URLs (includes Large V3 Turbo Q5) |
| `src/main/ffmpeg/probe.ts` | ffprobe wrapper + duration extraction |
| `src/main/ffmpeg/concat.ts` | Multi-part audio concatenation via ffmpeg concat demuxer |

The following file is **transplanted and adapted** (not verbatim):

| File | Changes required |
|---|---|
| `src/main/whisper/transcribe.ts` | The original emits progress via `win.webContents.send(IPC.WHISPER_PROGRESS, data)`. In AudioBook Forge, `queue.ipc.ts` is the orchestrator. It calls `transcribeAudio(win, ...)` and the progress events are intercepted/re-emitted tagged with the active `jobId` so the renderer can update the correct queue entry. This requires a thin adapter in `queue.ipc.ts` that wraps the `BrowserWindow` send or passes a job-scoped emitter. |

**Dropped from videobookforge:**
- `src/main/ffmpeg/background.ts` — background video stream generation
- `src/main/ffmpeg/convert.ts` — video encoding pipeline
- `src/main/metadata/musicbrainz.ts`, `openlibrary.ts`, `googlebooks.ts` — online metadata lookup

---

## IPC Architecture

### Main process modules

| Module | Key channels |
|---|---|
| `whisper.ipc.ts` | `whisper:transcribe`, `whisper:cancel`, `whisper:progress` (event), `whisper:storage-info` |
| `files.ipc.ts` | `files:pick-audio`, `files:pick-epub`, `files:pick-output-folder`, `files:show-in-explorer` — newly designed channels (not transplanted verbatim from videobookforge) |
| `queue.ipc.ts` | `queue:add`, `queue:remove`, `queue:reorder`, `queue:cancel`, `queue:get-all`, `queue:clear-done` |
| `abs.ipc.ts` | `abs:test-connection`, `abs:get-libraries`, `abs:get-books`, `abs:get-book`, `abs:upload-subtitle` |
| `settings.ipc.ts` | `settings:get`, `settings:set-url`, `settings:set-api-key` — API key write-only from renderer; read only in main process |

### Progress events and job ID tagging
`whisper:progress` events emitted during transcription are wrapped by `queue.ipc.ts` to include the active `jobId`. The renderer listens on `whisper:progress` and routes the update to the matching job in the queue store. Shape:
```typescript
interface WhisperProgressEvent {
  jobId: string
  phase: 'preparing' | 'segmenting' | 'transcribing' | 'done'
  percent: number
  segmentIndex?: number
  segmentCount?: number
  liveText?: string
}
```

### Preload bridge
All channels exposed through typed IPC wrappers in `src/preload/index.ts`, same pattern as videobookforge.

---

## State (Zustand)

```typescript
// App-level settings (persisted via settings.ipc)
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

// Queue (persisted via queue.ipc / userData/queue.json)
interface QueueState {
  jobs: TranscriptionJob[]
  activeJobId: string | null
}

// ABS library cache (session only, not persisted)
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
- Key is retrieved in the main process per-call; never sent to the renderer, never stored in Zustand, never written to any file
- `settings:set-api-key` is write-only from the renderer's perspective; there is no `get-api-key` channel exposed to the renderer
- All ABS HTTP requests (including auth headers) are made in the main process only
- ABS URL is non-sensitive and stored in `userData/settings.json`

---

## Project Structure

```
audiobookforge/
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc/
│   │   │   ├── whisper.ipc.ts      # transplanted + adapted (jobId tagging)
│   │   │   ├── files.ipc.ts        # new (newly designed channels)
│   │   │   ├── queue.ipc.ts        # new
│   │   │   ├── abs.ipc.ts          # new
│   │   │   └── settings.ipc.ts     # new
│   │   ├── whisper/
│   │   │   ├── transcribe.ts       # transplanted + adapted (see above)
│   │   │   ├── segments.ts         # transplanted verbatim
│   │   │   ├── binary.ts           # transplanted verbatim
│   │   │   └── models.ts           # transplanted verbatim
│   │   └── ffmpeg/
│   │       ├── probe.ts            # transplanted verbatim
│   │       └── concat.ts           # transplanted verbatim
│   ├── renderer/src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── SourcePage.tsx      # Step 1
│   │   │   ├── SettingsPage.tsx    # Step 2
│   │   │   └── TranscribePage.tsx  # Step 3 (review + queue button)
│   │   ├── components/
│   │   │   ├── QueuePanel.tsx
│   │   │   ├── AbsLibraryModal.tsx
│   │   │   └── AppSettingsPanel.tsx
│   │   ├── store/
│   │   │   └── useAppStore.ts
│   │   └── lib/
│   │       ├── ipc.ts
│   │       └── whisperModels.ts    # transplanted verbatim
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
- Non-English transcription (language forced to English via `-l en` in v1)
- EPUB auto-linking for remote ABS instances (local/same-machine ABS only)
