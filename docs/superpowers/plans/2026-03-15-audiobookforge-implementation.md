# AudioBook Forge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AudioBook Forge — a standalone Electron app that transcribes audiobooks to SRT files, with a persistent job queue and AudioBookShelf (ABS) integration.

**Architecture:** Fresh electron-vite scaffold (React 19 + TypeScript + Tailwind v4 + Zustand 5). Whisper pipeline transplanted verbatim from videobookforge (`C:\Users\Jacob\Projects\videobookforge`), with a thin adapter for job-scoped progress events. Queue and ABS integration built from scratch.

**Tech Stack:** Electron 36, React 19, TypeScript 5, electron-vite, Tailwind v4, Zustand 5, keytar (OS credential store), ffmpeg-static, ffprobe-static, whisper.cpp (downloaded at runtime)

---

## File Map

```
src/
├── main/
│   ├── index.ts                    # App entry, BrowserWindow, IPC registration
│   ├── ipc/
│   │   ├── whisper.ipc.ts          # whisper:transcribe, whisper:cancel, whisper:storage-info
│   │   ├── files.ipc.ts            # files:pick-audio, files:pick-epub, files:pick-output-folder, files:show-in-explorer
│   │   ├── queue.ipc.ts            # queue:add/remove/reorder/cancel/get-all/clear-done + orchestration loop
│   │   ├── abs.ipc.ts              # abs:test-connection, abs:get-libraries, abs:get-books, abs:get-book, abs:upload-subtitle
│   │   └── settings.ipc.ts         # settings:get, settings:set-url, settings:set-api-key (keytar)
│   ├── whisper/
│   │   ├── transcribe.ts           # Adapted: accepts progressCallback instead of BrowserWindow
│   │   ├── segments.ts             # Verbatim from videobookforge
│   │   ├── binary.ts               # Verbatim from videobookforge
│   │   └── models.ts               # Verbatim from videobookforge
│   └── ffmpeg/
│       ├── probe.ts                # Verbatim from videobookforge
│       └── concat.ts               # Verbatim from videobookforge
├── renderer/src/
│   ├── App.tsx                     # Root layout: left wizard + right queue panel
│   ├── pages/
│   │   ├── SourcePage.tsx          # Step 1: local drop or ABS browse
│   │   ├── SettingsPage.tsx        # Step 2: model, output folder, EPUB
│   │   └── TranscribePage.tsx      # Step 3: job summary + "Add to Queue" button
│   ├── components/
│   │   ├── QueuePanel.tsx          # Right-side persistent queue panel
│   │   ├── AbsLibraryModal.tsx     # ABS library browser modal
│   │   └── AppSettingsPanel.tsx    # ABS URL + API key settings overlay
│   ├── store/
│   │   └── useAppStore.ts          # Zustand: wizard + queue + abs library + app settings
│   └── lib/
│       ├── ipc.ts                  # Typed IPC wrappers for all channels
│       └── whisperModels.ts        # Model definitions (verbatim from videobookforge)
├── preload/
│   └── index.ts                    # contextBridge for all IPC channels
└── shared/
    └── types.ts                    # Shared TS interfaces (TranscriptionJob, WhisperProgressEvent, ABS types, etc.)
```

---

## Chunk 1: Project Scaffold + Transplanted Core

### Task 1: Scaffold the electron-vite project

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/src/main.tsx`

- [ ] **Step 1: Create the project using electron-vite**

From `C:\Users\Jacob\Projects` (Git Bash or cmd):
```bash
cd "C:\Users\Jacob\Projects"
npm create @quick-start/electron@latest audiobookforge -- --template react-ts
```
When prompted, confirm the project name `audiobookforge`.

- [ ] **Step 2: Install base dependencies**

```bash
cd audiobookforge
npm install
```

- [ ] **Step 3: Install app-specific runtime dependencies**

```bash
npm install zustand@5 keytar ffmpeg-static ffprobe-static music-metadata axios epub2 form-data uuid
```

- [ ] **Step 4: Install dev dependencies**

```bash
npm install -D tailwindcss @tailwindcss/vite vitest @types/uuid @types/form-data
```

- [ ] **Step 5: Verify dev server starts**

```bash
npm run dev
```
Expected: Electron window opens with the default React template. Close it after confirming.

- [ ] **Step 6: Commit scaffold**

```bash
git add -A
git commit -m "chore: scaffold electron-vite react-ts project"
```

---

### Task 2: Configure Tailwind v4 + base theme

**Files:**
- Modify: `electron.vite.config.ts`
- Modify: `src/renderer/src/assets/main.css` (or equivalent global CSS entry)

- [ ] **Step 1: Add Tailwind plugin to vite config**

Open `electron.vite.config.ts`. Add the Tailwind plugin to the renderer config:

```typescript
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { /* existing */ },
  preload: { /* existing */ },
  renderer: {
    plugins: [react(), tailwindcss()],
  }
})
```

- [ ] **Step 2: Add Tailwind import to global CSS**

Replace the contents of the renderer's global CSS file (likely `src/renderer/src/assets/main.css`) with:

```css
@import "tailwindcss";

:root {
  --color-accent: #dc2626;
  --color-accent-hover: #b91c1c;
  --color-accent-dim: #7f1d1d;
  --color-surface: #0a0000;
  --color-surface-raised: #120000;
  --color-surface-border: #2a0000;
  --color-text-primary: #fef2f2;
  --color-text-secondary: #fca5a5;
  --color-text-muted: #6b2222;
}

body {
  background-color: var(--color-surface);
  color: var(--color-text-primary);
  font-family: system-ui, sans-serif;
  margin: 0;
  overflow: hidden;
}
```

- [ ] **Step 3: Verify Tailwind works**

```bash
npm run dev
```
Expected: Window opens, no CSS errors in the dev console.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: configure Tailwind v4 with black/red theme tokens"
```

---

### Task 3: Define shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write the shared types file**

Create `src/shared/types.ts`:

```typescript
// ─── Whisper ────────────────────────────────────────────────────────────────

export type WhisperModel =
  | 'tiny'
  | 'base'
  | 'small'
  | 'medium'
  | 'large-v2'
  | 'large-v3'
  | 'large-v3-turbo'

export interface WhisperProgressEvent {
  jobId: string
  phase: 'preparing' | 'segmenting' | 'transcribing' | 'done' | 'error'
  percent: number
  segmentIndex?: number
  segmentCount?: number
  liveText?: string
  error?: string
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TranscriptionJob {
  id: string
  status: JobStatus
  source: 'local' | 'abs'
  title: string
  audioFiles: string[]
  outputPath: string | null      // output folder for local jobs; null for ABS
  absItemId: string | null
  epubPath: string | null
  model: WhisperModel
  progress: WhisperProgressEvent | null
  srtPath: string | null         // temp path during/after transcription
  error: string | null
  createdAt: number
  completedAt: number | null
}

// ─── ABS ─────────────────────────────────────────────────────────────────────

export interface AbsLibrary {
  id: string
  name: string
  mediaType: string
}

export interface AbsBook {
  id: string
  title: string
  authorName: string
  duration: number               // seconds
  cover: string | null           // cover URL relative to ABS server
  hasSubtitles: boolean
  ebookPath: string | null       // absolute path if same-machine ABS
  audioFiles: AbsAudioFile[]
}

export interface AbsAudioFile {
  index: number
  metadata: { filename: string }
  path: string                   // absolute path on ABS server
}

// Minimal ABS book summary stored in the wizard (subset of AbsBook)
export interface AbsBookSummary {
  id: string
  title: string
  authorName: string
  duration: number
  ebookPath: string | null
  audioFiles: { path: string }[]
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  absUrl: string
  defaultModel: WhisperModel
}

// ─── IPC channel names ────────────────────────────────────────────────────────

export const IPC = {
  // Whisper
  WHISPER_TRANSCRIBE: 'whisper:transcribe',
  WHISPER_CANCEL: 'whisper:cancel',
  WHISPER_PROGRESS: 'whisper:progress',
  WHISPER_STORAGE_INFO: 'whisper:storage-info',

  // Files
  FILES_PICK_AUDIO: 'files:pick-audio',
  FILES_PICK_EPUB: 'files:pick-epub',
  FILES_PICK_OUTPUT_FOLDER: 'files:pick-output-folder',
  FILES_SHOW_IN_EXPLORER: 'files:show-in-explorer',

  // Queue
  QUEUE_ADD: 'queue:add',
  QUEUE_REMOVE: 'queue:remove',
  QUEUE_REORDER: 'queue:reorder',
  QUEUE_CANCEL: 'queue:cancel',
  QUEUE_GET_ALL: 'queue:get-all',
  QUEUE_CLEAR_DONE: 'queue:clear-done',
  QUEUE_UPDATED: 'queue:updated',  // main → renderer push event

  // ABS
  ABS_TEST_CONNECTION: 'abs:test-connection',
  ABS_GET_LIBRARIES: 'abs:get-libraries',
  ABS_GET_BOOKS: 'abs:get-books',
  ABS_GET_BOOK: 'abs:get-book',
  ABS_UPLOAD_SUBTITLE: 'abs:upload-subtitle',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET_URL: 'settings:set-url',
  SETTINGS_SET_API_KEY: 'settings:set-api-key',
} as const
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared types (TranscriptionJob, WhisperProgressEvent, ABS, IPC constants)"
```

---

### Task 4: Transplant whisper pipeline verbatim

**Files:**
- Create: `src/main/whisper/segments.ts` (verbatim copy)
- Create: `src/main/whisper/binary.ts` (verbatim copy)
- Create: `src/main/whisper/models.ts` (verbatim copy)
- Create: `src/main/ffmpeg/probe.ts` (verbatim copy)
- Create: `src/main/ffmpeg/concat.ts` (verbatim copy)
- Create: `src/renderer/src/lib/whisperModels.ts` (verbatim copy)

- [ ] **Step 1: Copy verbatim files from videobookforge**

From Git Bash:
```bash
SRC="C:/Users/Jacob/Projects/videobookforge/src"
DEST="C:/Users/Jacob/Projects/audiobookforge/src"

mkdir -p "$DEST/main/whisper" "$DEST/main/ffmpeg"
cp "$SRC/main/whisper/segments.ts" "$DEST/main/whisper/segments.ts"
cp "$SRC/main/whisper/binary.ts" "$DEST/main/whisper/binary.ts"
cp "$SRC/main/whisper/models.ts" "$DEST/main/whisper/models.ts"
cp "$SRC/main/ffmpeg/probe.ts" "$DEST/main/ffmpeg/probe.ts"
cp "$SRC/main/ffmpeg/concat.ts" "$DEST/main/ffmpeg/concat.ts"
mkdir -p "$DEST/renderer/src/lib"
cp "$SRC/renderer/src/lib/whisperModels.ts" "$DEST/renderer/src/lib/whisperModels.ts"
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: No errors from the copied files (they may reference IPC constants — if so, update imports to point to `../../../shared/types` as needed).

Fix any import path errors (the shared `IPC` import path will differ from videobookforge).

- [ ] **Step 3: Commit transplanted files**

```bash
git add src/main/whisper/ src/main/ffmpeg/ src/renderer/src/lib/whisperModels.ts
git commit -m "feat: transplant whisper pipeline + ffmpeg probe/concat from videobookforge"
```

---

### Task 5: Adapt transcribe.ts to use progressCallback

**Files:**
- Create: `src/main/whisper/transcribe.ts` (adapted from videobookforge)

- [ ] **Step 1: Copy transcribe.ts from videobookforge**

```bash
cp "C:/Users/Jacob/Projects/videobookforge/src/main/whisper/transcribe.ts" \
   "C:/Users/Jacob/Projects/audiobookforge/src/main/whisper/transcribe.ts"
```

- [ ] **Step 2: Replace BrowserWindow progress emission with a callback**

Open `src/main/whisper/transcribe.ts` in your editor.

**2a. Update the function signature.** Find the exported `transcribeAudio` function — it starts with:
```typescript
export async function transcribeAudio(
  win: BrowserWindow,
```
Change the first parameter from `win: BrowserWindow` to `onProgress: (progress: Omit<WhisperProgressEvent, 'jobId'>) => void`. The full updated signature:
```typescript
export async function transcribeAudio(
  onProgress: (progress: Omit<WhisperProgressEvent, 'jobId'>) => void,
  audioPaths: string[],
  model: WhisperModel,
  promptText?: string
): Promise<string>
```

**2b. Replace all progress send calls.** Use your editor's find-all to search for `win.webContents.send`. Each occurrence will look like:
```typescript
win.webContents.send(IPC.WHISPER_PROGRESS, { phase: '...', percent: N, ... })
```
Replace each one by calling the callback with the same object (minus the IPC channel name):
```typescript
onProgress({ phase: '...', percent: N, ... })
```
The object payload is identical — you are only removing `win.webContents.send(IPC.WHISPER_PROGRESS,` and the closing `)`.

**2c. Remove unused imports.** Remove the `BrowserWindow` import from the top of the file. Also remove the `IPC` import if it is only used for `IPC.WHISPER_PROGRESS` (check whether any other IPC constant is referenced in this file before removing).

Add the `WhisperProgressEvent` import from `../../shared/types` if it is not already imported.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: No errors in `transcribe.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/main/whisper/transcribe.ts
git commit -m "feat: adapt transcribe.ts to use progressCallback instead of BrowserWindow"
```

---

## Chunk 2: Main Process — Settings, Files, and Queue IPC

### Task 6: Settings IPC (keytar + app settings)

**Files:**
- Create: `src/main/ipc/settings.ipc.ts`

- [ ] **Step 1: Write a failing test**

Create `src/main/ipc/__tests__/settings.ipc.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock keytar before importing settings
vi.mock('keytar', () => ({
  setPassword: vi.fn().mockResolvedValue(undefined),
  getPassword: vi.fn().mockResolvedValue('test-api-key'),
  deletePassword: vi.fn().mockResolvedValue(true),
}))

// Mock electron app.getPath
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/test-userdata') },
  ipcMain: { handle: vi.fn() },
}))

import * as keytar from 'keytar'
import { saveApiKey, loadApiKey } from '../settings.ipc'

describe('settings.ipc', () => {
  it('saves API key to keytar', async () => {
    await saveApiKey('my-secret-key')
    expect(keytar.setPassword).toHaveBeenCalledWith(
      'audiobookforge', 'abs-api-key', 'my-secret-key'
    )
  })

  it('loads API key from keytar', async () => {
    const key = await loadApiKey()
    expect(key).toBe('test-api-key')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/main/ipc/__tests__/settings.ipc.test.ts
```
Expected: FAIL — `saveApiKey` and `loadApiKey` are not defined.

- [ ] **Step 3: Implement settings.ipc.ts**

Create `src/main/ipc/settings.ipc.ts`:

```typescript
import { ipcMain, app } from 'electron'
import * as keytar from 'keytar'
import * as fs from 'fs'
import * as path from 'path'
import { IPC, AppSettings, WhisperModel } from '../../shared/types'

const KEYTAR_SERVICE = 'audiobookforge'
const KEYTAR_ACCOUNT = 'abs-api-key'

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { absUrl: '', defaultModel: 'large-v3-turbo' }
  }
}

function saveSettings(settings: AppSettings): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2))
}

export async function saveApiKey(key: string): Promise<void> {
  await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, key)
}

export async function loadApiKey(): Promise<string | null> {
  return keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => loadSettings())

  ipcMain.handle(IPC.SETTINGS_SET_URL, (_event, url: string) => {
    const settings = loadSettings()
    settings.absUrl = url
    saveSettings(settings)
  })

  ipcMain.handle(IPC.SETTINGS_SET_API_KEY, async (_event, key: string) => {
    await saveApiKey(key)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/main/ipc/__tests__/settings.ipc.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/settings.ipc.ts src/main/ipc/__tests__/settings.ipc.test.ts
git commit -m "feat: settings IPC with keytar API key storage"
```

---

### Task 7: Files IPC

**Files:**
- Create: `src/main/ipc/files.ipc.ts`

- [ ] **Step 1: Implement files.ipc.ts**

Create `src/main/ipc/files.ipc.ts`:

```typescript
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'

export function registerFilesIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC.FILES_PICK_AUDIO, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select audiobook file(s)',
      filters: [{ name: 'Audiobooks', extensions: ['m4b', 'mp3'] }],
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.FILES_PICK_EPUB, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select EPUB for vocabulary prompting',
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.FILES_PICK_OUTPUT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select output folder for SRT',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.FILES_SHOW_IN_EXPLORER, (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/ipc/files.ipc.ts
git commit -m "feat: files IPC — audio picker, EPUB picker, output folder picker, show in explorer"
```

---

### Task 8: Queue IPC — persistence + orchestration

**Files:**
- Create: `src/main/ipc/queue.ipc.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/ipc/__tests__/queue.ipc.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/test-userdata') },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('[]'),
    existsSync: vi.fn().mockReturnValue(false),
    rmSync: vi.fn(),
  }
})

import { loadQueue, persistQueue, addJob, removeJob } from '../queue.ipc'
import { TranscriptionJob } from '../../../shared/types'

const makeJob = (overrides: Partial<TranscriptionJob> = {}): TranscriptionJob => ({
  id: 'test-id',
  status: 'queued',
  source: 'local',
  title: 'Test Book',
  audioFiles: ['/path/to/book.m4b'],
  outputPath: '/output',
  absItemId: null,
  epubPath: null,
  model: 'large-v3-turbo',
  progress: null,
  srtPath: null,
  error: null,
  createdAt: Date.now(),
  completedAt: null,
  ...overrides,
})

describe('queue.ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads empty queue when file missing', () => {
    const jobs = loadQueue()
    expect(jobs).toEqual([])
  })

  it('persists queue to disk', () => {
    const jobs = [makeJob()]
    persistQueue(jobs)
    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  it('adds a job to the queue', () => {
    const job = makeJob()
    const result = addJob([], job)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('test-id')
  })

  it('removes a job by id', () => {
    const job = makeJob()
    const result = removeJob([job], 'test-id')
    expect(result).toHaveLength(0)
  })

  it('does not remove a running job', () => {
    const job = makeJob({ status: 'running' })
    const result = removeJob([job], 'test-id')
    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/main/ipc/__tests__/queue.ipc.test.ts
```
Expected: FAIL — exported functions not found.

- [ ] **Step 3: Implement queue.ipc.ts**

Create `src/main/ipc/queue.ipc.ts`:

```typescript
import { ipcMain, app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { IPC, TranscriptionJob, WhisperProgressEvent } from '../../shared/types'
import { transcribeAudio } from '../whisper/transcribe'
import { loadApiKey } from './settings.ipc'
import Epub from 'epub2'

async function extractEpubVocab(epubPath: string): Promise<string> {
  try {
    const epub = await Epub.createAsync(epubPath)
    const chapters = await Promise.all(
      epub.flow.slice(0, 5).map(ch =>
        new Promise<string>(resolve => epub.getChapter(ch.id, (err, text) => resolve(err ? '' : text ?? '')))
      )
    )
    // Extract unique words 6+ chars long as a vocabulary hint for whisper
    const words = chapters.join(' ').match(/\b[A-Z][a-z]{5,}\b/g) ?? []
    return [...new Set(words)].slice(0, 150).join(', ')
  } catch {
    return ''
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function getQueuePath(): string {
  return path.join(app.getPath('userData'), 'queue.json')
}

export function loadQueue(): TranscriptionJob[] {
  try {
    const raw = fs.readFileSync(getQueuePath(), 'utf-8')
    const jobs: TranscriptionJob[] = JSON.parse(raw)
    // Reset any running jobs to queued (crash recovery)
    return jobs.map(j => j.status === 'running' ? { ...j, status: 'queued', progress: null } : j)
  } catch {
    return []
  }
}

export function persistQueue(jobs: TranscriptionJob[]): void {
  fs.writeFileSync(getQueuePath(), JSON.stringify(jobs, null, 2))
}

// ─── Pure queue mutations ─────────────────────────────────────────────────────

export function addJob(jobs: TranscriptionJob[], job: TranscriptionJob): TranscriptionJob[] {
  return [...jobs, job]
}

export function removeJob(jobs: TranscriptionJob[], id: string): TranscriptionJob[] {
  return jobs.filter(j => !(j.id === id && j.status !== 'running'))
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

let jobs: TranscriptionJob[] = []
let cancelRequested = false
let win: BrowserWindow | null = null

export function requestCancel(): void {
  cancelRequested = true
}

function push(): void {
  if (win) win.webContents.send(IPC.QUEUE_UPDATED, jobs)
  persistQueue(jobs)
}

function updateJob(id: string, patch: Partial<TranscriptionJob>): void {
  jobs = jobs.map(j => j.id === id ? { ...j, ...patch } : j)
  push()
}

async function runNext(): Promise<void> {
  const next = jobs.find(j => j.status === 'queued')
  if (!next) return

  cancelRequested = false
  updateJob(next.id, { status: 'running', progress: null, error: null })

  try {
    // Extract EPUB vocabulary before transcription (improves proper noun accuracy)
    const promptText = next.epubPath ? await extractEpubVocab(next.epubPath) : undefined

    const srtPath = await transcribeAudio(
      (progress: Omit<WhisperProgressEvent, 'jobId'>) => {
        const event: WhisperProgressEvent = { ...progress, jobId: next.id }
        updateJob(next.id, { progress: event })
        if (win) win.webContents.send(IPC.WHISPER_PROGRESS, event)
      },
      next.audioFiles,
      next.model,
      promptText
    )

    if (cancelRequested) {
      updateJob(next.id, { status: 'cancelled', completedAt: Date.now() })
    } else if (next.source === 'abs' && next.absItemId) {
      // Upload SRT to ABS
      const apiKey = await loadApiKey()
      await uploadSrtToAbs(next.absItemId, srtPath, apiKey)
      updateJob(next.id, { status: 'done', srtPath, completedAt: Date.now() })
    } else {
      // Save SRT to outputPath
      const dest = path.join(next.outputPath!, path.basename(srtPath))
      fs.copyFileSync(srtPath, dest)
      updateJob(next.id, { status: 'done', srtPath: dest, completedAt: Date.now() })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    updateJob(next.id, { status: 'failed', error: message, completedAt: Date.now() })
  }

  runNext()
}

async function uploadSrtToAbs(itemId: string, srtPath: string, apiKey: string | null): Promise<void> {
  // Deferred to abs.ipc.ts — called here via imported function
  // Import lazily to avoid circular dependency
  const { uploadSubtitleToAbs } = await import('./abs.ipc')
  await uploadSubtitleToAbs(itemId, srtPath, apiKey)
}

// ─── IPC Registration ─────────────────────────────────────────────────────────

export function registerQueueIpc(browserWindow: BrowserWindow): void {
  win = browserWindow
  jobs = loadQueue()

  // Clean up temp dirs for any reset-to-queued remote ABS jobs on startup
  for (const job of jobs) {
    if (job.source === 'abs' && job.status === 'queued') {
      const tmpDir = path.join(app.getPath('userData'), 'temp', job.id)
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    }
  }

  ipcMain.handle(IPC.QUEUE_GET_ALL, () => jobs)

  ipcMain.handle(IPC.QUEUE_ADD, (_event, job: TranscriptionJob) => {
    jobs = addJob(jobs, job)
    push()
    // Start processing if idle
    if (!jobs.find(j => j.status === 'running')) runNext()
    return jobs
  })

  ipcMain.handle(IPC.QUEUE_REMOVE, (_event, id: string) => {
    jobs = removeJob(jobs, id)
    push()
    return jobs
  })

  ipcMain.handle(IPC.QUEUE_CANCEL, (_event, id: string) => {
    const job = jobs.find(j => j.id === id)
    if (job?.status === 'running') {
      cancelRequested = true
    } else {
      jobs = jobs.map(j => j.id === id ? { ...j, status: 'cancelled' } : j)
      push()
    }
    return jobs
  })

  ipcMain.handle(IPC.QUEUE_REORDER, (_event, orderedIds: string[]) => {
    // Reorder queued (not running) jobs to match the given id order
    const running = jobs.filter(j => j.status === 'running')
    const reordered = orderedIds
      .map(id => jobs.find(j => j.id === id && j.status !== 'running'))
      .filter((j): j is TranscriptionJob => j !== undefined)
    const others = jobs.filter(j => j.status !== 'running' && !orderedIds.includes(j.id))
    jobs = [...running, ...reordered, ...others]
    push()
    return jobs
  })

  ipcMain.handle(IPC.QUEUE_CLEAR_DONE, () => {
    jobs = jobs.filter(j => j.status !== 'done' && j.status !== 'cancelled' && j.status !== 'failed')
    push()
    return jobs
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/ipc/__tests__/queue.ipc.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/queue.ipc.ts src/main/ipc/__tests__/queue.ipc.test.ts
git commit -m "feat: queue IPC with persistence, crash recovery, and orchestration loop"
```

---

## Chunk 3: Main Process — ABS Integration + Whisper IPC

### Task 9: ABS IPC

**Files:**
- Create: `src/main/ipc/abs.ipc.ts`

- [ ] **Step 1: Write a failing test**

Create `src/main/ipc/__tests__/abs.ipc.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import axios from 'axios'

vi.mock('axios')
const mockedAxios = vi.mocked(axios, true)

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

import { testAbsConnection, mapAbsItemToBook } from '../abs.ipc'

describe('abs.ipc', () => {
  it('testAbsConnection returns true on 200', async () => {
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { user: { id: '1' } } })
    const result = await testAbsConnection('http://localhost:13378', 'my-key')
    expect(result.ok).toBe(true)
  })

  it('testAbsConnection returns false on network error', async () => {
    mockedAxios.get = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await testAbsConnection('http://localhost:13378', 'my-key')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('mapAbsItemToBook extracts title, author, and duration', () => {
    const item = {
      id: 'item-1',
      media: {
        metadata: { title: 'Dune', authorName: 'Frank Herbert' },
        duration: 72000,
        audioFiles: [],
        ebookFile: null,
        tracks: [],
      },
      coverPath: null,
    }
    const book = mapAbsItemToBook(item, 'http://localhost:13378')
    expect(book.title).toBe('Dune')
    expect(book.authorName).toBe('Frank Herbert')
    expect(book.duration).toBe(72000)
    expect(book.hasSubtitles).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/main/ipc/__tests__/abs.ipc.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement abs.ipc.ts**

Create `src/main/ipc/abs.ipc.ts`:

```typescript
import { ipcMain } from 'electron'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import FormData from 'form-data'
import { IPC, AbsLibrary, AbsBook } from '../../shared/types'
import { loadApiKey } from './settings.ipc'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function absHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` }
}

// ─── Exported for queue.ipc.ts ────────────────────────────────────────────────

export async function uploadSubtitleToAbs(
  itemId: string,
  srtPath: string,
  apiKey: string | null
): Promise<void> {
  if (!apiKey) throw new Error('No ABS API key configured')
  const { app } = await import('electron')
  const { absUrl } = JSON.parse(
    fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8')
  )

  const form = new FormData()
  form.append('files', fs.createReadStream(srtPath), {
    filename: path.basename(srtPath),
    contentType: 'application/x-subrip',
  })

  try {
    await axios.post(`${absUrl}/api/items/${itemId}/upload`, form, {
      headers: { ...absHeaders(apiKey), ...form.getHeaders() },
    })
  } catch (err: unknown) {
    // NOTE: Verify exact upload endpoint and field names against your ABS version.
    // If this returns 409 (conflict), the existing subtitle track may need to be
    // deleted first via the ABS admin UI or API before re-uploading.
    throw new Error(
      `ABS subtitle upload failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export function mapAbsItemToBook(item: Record<string, unknown>, absUrl: string): AbsBook {
  const media = item.media as Record<string, unknown>
  const metadata = media.metadata as Record<string, unknown>
  const audioFiles = (media.audioFiles as unknown[]) ?? []
  const tracks = (media.tracks as unknown[]) ?? []
  const ebookFile = (media.ebookFile as Record<string, unknown> | null) ?? null

  return {
    id: item.id as string,
    title: (metadata.title as string) ?? 'Unknown',
    authorName: (metadata.authorName as string) ?? 'Unknown',
    duration: (media.duration as number) ?? 0,
    cover: item.coverPath ? `${absUrl}${item.coverPath}` : null,
    hasSubtitles: tracks.length > 0,
    ebookPath: ebookFile ? (ebookFile.metadata as Record<string, unknown>)?.path as string ?? null : null,
    audioFiles: (audioFiles as Record<string, unknown>[]).map((f, i) => ({
      index: i,
      metadata: { filename: (f.metadata as Record<string, unknown>)?.filename as string ?? '' },
      path: (f.metadata as Record<string, unknown>)?.path as string ?? '',
    })),
  }
}

// ─── Connection test ──────────────────────────────────────────────────────────

export async function testAbsConnection(
  absUrl: string,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await axios.get(`${absUrl}/api/authorize`, { headers: absHeaders(apiKey) })
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── IPC Registration ─────────────────────────────────────────────────────────

export function registerAbsIpc(): void {
  async function getUrlAndKey(): Promise<{ absUrl: string; apiKey: string }> {
    const { app } = await import('electron')
    const settingsPath = path.join(app.getPath('userData'), 'settings.json')
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const apiKey = await loadApiKey()
    if (!apiKey) throw new Error('No ABS API key configured')
    return { absUrl: settings.absUrl, apiKey }
  }

  ipcMain.handle(IPC.ABS_TEST_CONNECTION, async (_event, absUrl: string, apiKey: string) => {
    return testAbsConnection(absUrl, apiKey)
  })

  ipcMain.handle(IPC.ABS_GET_LIBRARIES, async (): Promise<AbsLibrary[]> => {
    const { absUrl, apiKey } = await getUrlAndKey()
    const res = await axios.get(`${absUrl}/api/libraries`, { headers: absHeaders(apiKey) })
    return (res.data.libraries as Record<string, unknown>[]).map(l => ({
      id: l.id as string,
      name: l.name as string,
      mediaType: l.mediaType as string,
    }))
  })

  ipcMain.handle(IPC.ABS_GET_BOOKS, async (_event, libraryId: string): Promise<AbsBook[]> => {
    const { absUrl, apiKey } = await getUrlAndKey()
    const res = await axios.get(
      `${absUrl}/api/libraries/${libraryId}/items?limit=100&page=0`,
      { headers: absHeaders(apiKey) }
    )
    return (res.data.results as Record<string, unknown>[]).map(item =>
      mapAbsItemToBook(item, absUrl)
    )
  })

  ipcMain.handle(IPC.ABS_GET_BOOK, async (_event, itemId: string): Promise<AbsBook> => {
    const { absUrl, apiKey } = await getUrlAndKey()
    const res = await axios.get(`${absUrl}/api/items/${itemId}?expanded=1`, {
      headers: absHeaders(apiKey),
    })
    return mapAbsItemToBook(res.data, absUrl)
  })

  ipcMain.handle(IPC.ABS_UPLOAD_SUBTITLE, async (_event, itemId: string, srtPath: string) => {
    const apiKey = await loadApiKey()
    await uploadSubtitleToAbs(itemId, srtPath, apiKey)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/ipc/__tests__/abs.ipc.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/abs.ipc.ts src/main/ipc/__tests__/abs.ipc.test.ts
git commit -m "feat: ABS IPC — library browse, book details, subtitle upload, connection test"
```

---

### Task 10: Whisper IPC + main index wiring

**Files:**
- Create: `src/main/ipc/whisper.ipc.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Implement whisper.ipc.ts**

Create `src/main/ipc/whisper.ipc.ts`:

```typescript
import { ipcMain, app, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { IPC } from '../../shared/types'
import { getBinaryStorageInfo } from '../whisper/binary'
import { requestCancel } from './queue.ipc'

export function registerWhisperIpc(win: BrowserWindow): void {
  // Transcription is driven by queue.ipc.ts — this module only exposes
  // storage info and the cancel signal channel.

  ipcMain.handle(IPC.WHISPER_STORAGE_INFO, async () => {
    return getBinaryStorageInfo()
  })

  // Route cancel through queue.ipc's requestCancel() so the flag is set correctly.
  ipcMain.handle(IPC.WHISPER_CANCEL, () => {
    requestCancel()
  })
}
```

- [ ] **Step 2: Wire all IPC modules into main index**

Open `src/main/index.ts`. Replace the scaffold boilerplate with:

```typescript
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerFilesIpc } from './ipc/files.ipc'
import { registerQueueIpc } from './ipc/queue.ipc'
import { registerAbsIpc } from './ipc/abs.ipc'
import { registerWhisperIpc } from './ipc/whisper.ipc'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset',
    title: 'AudioBook Forge',
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const win = createWindow()

  registerSettingsIpc()
  registerFilesIpc(win)
  registerQueueIpc(win)
  registerAbsIpc()
  registerWhisperIpc(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: Implement the preload bridge**

Replace `src/preload/index.ts` with:

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, TranscriptionJob, WhisperModel, WhisperProgressEvent } from '../shared/types'

contextBridge.exposeInMainWorld('electron', {
  // Settings
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    setUrl: (url: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_URL, url),
    setApiKey: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_API_KEY, key),
  },

  // Files
  files: {
    pickAudio: () => ipcRenderer.invoke(IPC.FILES_PICK_AUDIO),
    pickEpub: () => ipcRenderer.invoke(IPC.FILES_PICK_EPUB),
    pickOutputFolder: () => ipcRenderer.invoke(IPC.FILES_PICK_OUTPUT_FOLDER),
    showInExplorer: (p: string) => ipcRenderer.invoke(IPC.FILES_SHOW_IN_EXPLORER, p),
  },

  // Queue
  queue: {
    getAll: () => ipcRenderer.invoke(IPC.QUEUE_GET_ALL),
    add: (job: TranscriptionJob) => ipcRenderer.invoke(IPC.QUEUE_ADD, job),
    remove: (id: string) => ipcRenderer.invoke(IPC.QUEUE_REMOVE, id),
    cancel: (id: string) => ipcRenderer.invoke(IPC.QUEUE_CANCEL, id),
    clearDone: () => ipcRenderer.invoke(IPC.QUEUE_CLEAR_DONE),
    onUpdated: (cb: (jobs: TranscriptionJob[]) => void) => {
      ipcRenderer.on(IPC.QUEUE_UPDATED, (_e, jobs) => cb(jobs))
      return () => ipcRenderer.removeAllListeners(IPC.QUEUE_UPDATED)
    },
  },

  // ABS
  abs: {
    testConnection: (url: string, key: string) =>
      ipcRenderer.invoke(IPC.ABS_TEST_CONNECTION, url, key),
    getLibraries: () => ipcRenderer.invoke(IPC.ABS_GET_LIBRARIES),
    getBooks: (libraryId: string) => ipcRenderer.invoke(IPC.ABS_GET_BOOKS, libraryId),
    getBook: (itemId: string) => ipcRenderer.invoke(IPC.ABS_GET_BOOK, itemId),
    uploadSubtitle: (itemId: string, srtPath: string) =>
      ipcRenderer.invoke(IPC.ABS_UPLOAD_SUBTITLE, itemId, srtPath),
  },

  // Whisper
  whisper: {
    storageInfo: () => ipcRenderer.invoke(IPC.WHISPER_STORAGE_INFO),
    cancel: () => ipcRenderer.invoke(IPC.WHISPER_CANCEL),
    onProgress: (cb: (event: WhisperProgressEvent) => void) => {
      ipcRenderer.on(IPC.WHISPER_PROGRESS, (_e, event) => cb(event))
      return () => ipcRenderer.removeAllListeners(IPC.WHISPER_PROGRESS)
    },
  },

  // Electron utils — use the real webUtils from electron (Electron 32+, replaces deprecated file.path)
  webUtils: {
    getPathForFile: (file: File) => {
      const { webUtils } = require('electron')
      return webUtils.getPathForFile(file)
    },
  },
})
```

> **Note:** For drag-and-drop file path resolution in the renderer, use `window.electron.webUtils.getPathForFile(file)` — NOT `file.path` (deprecated in Electron 32+).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/whisper.ipc.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: wire all IPC modules into main process + preload bridge"
```

---

## Chunk 4: Renderer — Store, IPC Wrappers, App Shell

### Task 11: Typed IPC wrappers + Zustand store

**Files:**
- Create: `src/renderer/src/lib/ipc.ts`
- Create: `src/renderer/src/store/useAppStore.ts`

- [ ] **Step 1: Create typed IPC wrapper**

Create `src/renderer/src/lib/ipc.ts`:

```typescript
import { TranscriptionJob, AppSettings, AbsLibrary, AbsBook, WhisperProgressEvent } from '../../../shared/types'

// Type for the electron API exposed via contextBridge
type ElectronAPI = {
  settings: {
    get: () => Promise<AppSettings>
    setUrl: (url: string) => Promise<void>
    setApiKey: (key: string) => Promise<void>
  }
  files: {
    pickAudio: () => Promise<string[]>
    pickEpub: () => Promise<string | null>
    pickOutputFolder: () => Promise<string | null>
    showInExplorer: (p: string) => Promise<void>
  }
  queue: {
    getAll: () => Promise<TranscriptionJob[]>
    add: (job: TranscriptionJob) => Promise<TranscriptionJob[]>
    remove: (id: string) => Promise<TranscriptionJob[]>
    cancel: (id: string) => Promise<TranscriptionJob[]>
    clearDone: () => Promise<TranscriptionJob[]>
    onUpdated: (cb: (jobs: TranscriptionJob[]) => void) => () => void
  }
  abs: {
    testConnection: (url: string, key: string) => Promise<{ ok: boolean; error?: string }>
    getLibraries: () => Promise<AbsLibrary[]>
    getBooks: (libraryId: string) => Promise<AbsBook[]>
    getBook: (itemId: string) => Promise<AbsBook>
    uploadSubtitle: (itemId: string, srtPath: string) => Promise<void>
  }
  // NOTE: whisper:transcribe is intentionally NOT exposed to the renderer.
  // Transcription is driven by queue.ipc.ts in the main process.
  // The renderer only observes progress events and can cancel.
  whisper: {
    storageInfo: () => Promise<unknown>
    cancel: () => Promise<void>
    onProgress: (cb: (event: WhisperProgressEvent) => void) => () => void
  }

  // Electron 32+: use this instead of file.path (deprecated)
  webUtils: {
    getPathForFile: (file: File) => string
  }
}

export const ipc: ElectronAPI = (window as unknown as { electron: ElectronAPI }).electron
```

- [ ] **Step 2: Create Zustand store**

Create `src/renderer/src/store/useAppStore.ts`:

```typescript
import { create } from 'zustand'
import {
  TranscriptionJob, WhisperModel, AppSettings,
  AbsLibrary, AbsBook, AbsBookSummary
} from '../../../shared/types'

interface WizardState {
  step: 1 | 2 | 3
  source: 'local' | 'abs' | null
  audioFiles: string[]
  absItem: AbsBookSummary | null
  epubPath: string | null
  model: WhisperModel
  outputFolder: string | null
}

interface QueueState {
  jobs: TranscriptionJob[]
  activeJobId: string | null
}

interface AbsLibraryState {
  connected: boolean
  libraries: AbsLibrary[]
  books: Record<string, AbsBook[]>
  lastFetched: number | null
}

interface AppState {
  settings: AppSettings
  wizard: WizardState
  queue: QueueState
  absLibrary: AbsLibraryState

  // Settings actions
  setSettings: (s: Partial<AppSettings>) => void

  // Wizard actions
  setWizardStep: (step: 1 | 2 | 3) => void
  setWizardSource: (source: 'local' | 'abs') => void
  setWizardAudioFiles: (files: string[]) => void
  setWizardAbsItem: (item: AbsBookSummary | null) => void
  setWizardEpub: (path: string | null) => void
  setWizardModel: (model: WhisperModel) => void
  setWizardOutputFolder: (folder: string | null) => void
  resetWizard: () => void

  // Queue actions
  setJobs: (jobs: TranscriptionJob[]) => void

  // ABS library actions
  setAbsConnected: (connected: boolean) => void
  setAbsLibraries: (libraries: AbsLibrary[]) => void
  setAbsBooks: (libraryId: string, books: AbsBook[]) => void
}

const defaultWizard: WizardState = {
  step: 1,
  source: null,
  audioFiles: [],
  absItem: null,
  epubPath: null,
  model: 'large-v3-turbo',
  outputFolder: null,
}

export const useAppStore = create<AppState>((set) => ({
  settings: { absUrl: '', defaultModel: 'large-v3-turbo' },
  wizard: defaultWizard,
  queue: { jobs: [], activeJobId: null },
  absLibrary: { connected: false, libraries: [], books: {}, lastFetched: null },

  setSettings: (s) => set(state => ({ settings: { ...state.settings, ...s } })),

  setWizardStep: (step) => set(state => ({ wizard: { ...state.wizard, step } })),
  setWizardSource: (source) => set(state => ({ wizard: { ...state.wizard, source } })),
  setWizardAudioFiles: (audioFiles) => set(state => ({ wizard: { ...state.wizard, audioFiles } })),
  setWizardAbsItem: (absItem) => set(state => ({ wizard: { ...state.wizard, absItem } })),
  setWizardEpub: (epubPath) => set(state => ({ wizard: { ...state.wizard, epubPath } })),
  setWizardModel: (model) => set(state => ({ wizard: { ...state.wizard, model } })),
  setWizardOutputFolder: (outputFolder) => set(state => ({ wizard: { ...state.wizard, outputFolder } })),
  resetWizard: () => set({ wizard: defaultWizard }),

  setJobs: (jobs) => set({ queue: { jobs, activeJobId: jobs.find(j => j.status === 'running')?.id ?? null } }),

  setAbsConnected: (connected) => set(state => ({ absLibrary: { ...state.absLibrary, connected } })),
  setAbsLibraries: (libraries) => set(state => ({ absLibrary: { ...state.absLibrary, libraries } })),
  setAbsBooks: (libraryId, books) => set(state => ({
    absLibrary: {
      ...state.absLibrary,
      books: { ...state.absLibrary.books, [libraryId]: books },
      lastFetched: Date.now(),
    }
  })),
}))
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/ipc.ts src/renderer/src/store/useAppStore.ts
git commit -m "feat: typed IPC wrappers and Zustand store"
```

---

### Task 12: App shell layout

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Build the App shell**

Replace `src/renderer/src/App.tsx` with:

```tsx
import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import { ipc } from './lib/ipc'
import { SourcePage } from './pages/SourcePage'
import { SettingsPage } from './pages/SettingsPage'
import { TranscribePage } from './pages/TranscribePage'
import { QueuePanel } from './components/QueuePanel'

// AppSettingsPanel is owned by QueuePanel (opened from its footer link).
// Do NOT render it here — duplicate instances would conflict.

export default function App() {
  const step = useAppStore(s => s.wizard.step)
  const setJobs = useAppStore(s => s.setJobs)
  const setSettings = useAppStore(s => s.setSettings)

  // Load initial state from main process
  useEffect(() => {
    ipc.queue.getAll().then(setJobs)
    ipc.settings.get().then(setSettings)

    const unsub = ipc.queue.onUpdated(setJobs)
    return unsub
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-surface)]">
      {/* Left: Wizard */}
      <div className="flex flex-1 flex-col min-w-0 border-r border-[var(--color-surface-border)]">
        <header className="flex items-center px-5 py-3 border-b border-[var(--color-surface-border)]">
          <span className="text-[var(--color-text-secondary)] font-semibold tracking-wide text-sm">
            AudioBook Forge
          </span>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          {step === 1 && <SourcePage />}
          {step === 2 && <SettingsPage />}
          {step === 3 && <TranscribePage />}
        </main>
      </div>

      {/* Right: Queue panel (owns the AppSettingsPanel overlay) */}
      <QueuePanel />
    </div>
  )
}
```

- [ ] **Step 2: Verify the app runs**

```bash
npm run dev
```
Expected: Electron window opens with the split layout (may show empty panels). No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: App shell with wizard/queue split layout"
```

---

## Chunk 5: Renderer — Pages and Components

### Task 13: SourcePage (Step 1)

**Files:**
- Create: `src/renderer/src/pages/SourcePage.tsx`

- [ ] **Step 1: Implement SourcePage**

Create `src/renderer/src/pages/SourcePage.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ipc } from '../lib/ipc'
import { AbsLibraryModal } from '../components/AbsLibraryModal'

export function SourcePage() {
  const [showAbsModal, setShowAbsModal] = useState(false)
  const setStep = useAppStore(s => s.setWizardStep)
  const setSource = useAppStore(s => s.setWizardSource)
  const setAudioFiles = useAppStore(s => s.setWizardAudioFiles)
  const setAbsItem = useAppStore(s => s.setWizardAbsItem)
  const audioFiles = useAppStore(s => s.wizard.audioFiles)
  const absItem = useAppStore(s => s.wizard.absItem)

  const canAdvance = audioFiles.length > 0 || absItem !== null

  // Drag and drop
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.endsWith('.m4b') || f.name.endsWith('.mp3')
    )
    if (files.length === 0) return
    const paths = files.map(f => window.electron.webUtils.getPathForFile(f))
    setSource('local')
    setAbsItem(null)
    setAudioFiles(paths)
  }, [])

  const onDragOver = (e: React.DragEvent) => e.preventDefault()

  const onClickPick = async () => {
    const paths = await ipc.files.pickAudio()
    if (paths.length > 0) {
      setSource('local')
      setAbsItem(null)
      setAudioFiles(paths)
    }
  }

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Step indicator */}
      <StepIndicator current={1} />

      <h2 className="text-[var(--color-text-primary)] font-semibold text-sm">Choose a source</h2>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onClick={onClickPick}
        className="border border-dashed border-[var(--color-surface-border)] rounded-lg p-8 text-center cursor-pointer hover:border-[var(--color-accent-dim)] transition-colors bg-black/20"
      >
        {audioFiles.length > 0 ? (
          <div>
            <p className="text-[var(--color-text-secondary)] text-sm font-medium">
              {audioFiles.length} file{audioFiles.length > 1 ? 's' : ''} selected
            </p>
            <p className="text-[var(--color-text-muted)] text-xs mt-1">
              {audioFiles.map(f => f.split(/[\\/]/).pop()).join(', ')}
            </p>
          </div>
        ) : (
          <>
            <p className="text-[var(--color-text-secondary)] text-sm">Drop .m4b or .mp3 files here</p>
            <p className="text-[var(--color-text-muted)] text-xs mt-1">
              Click to browse · Multi-part books supported
            </p>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-[var(--color-surface-border)]" />
        <span className="text-[var(--color-text-muted)] text-xs">or</span>
        <div className="flex-1 h-px bg-[var(--color-surface-border)]" />
      </div>

      {/* ABS button */}
      <button
        onClick={() => setShowAbsModal(true)}
        className="flex items-center gap-3 border border-[var(--color-accent-dim)] rounded-lg p-3 hover:border-[var(--color-accent)] transition-colors text-left"
      >
        <span className="text-xl">📚</span>
        <div className="flex-1">
          {absItem ? (
            <>
              <p className="text-[var(--color-text-secondary)] text-sm font-semibold">{absItem.title}</p>
              <p className="text-[var(--color-text-muted)] text-xs">{absItem.authorName}</p>
            </>
          ) : (
            <>
              <p className="text-[var(--color-text-secondary)] text-sm font-semibold">Browse AudioBookShelf</p>
              <p className="text-[var(--color-text-muted)] text-xs">Select a book from your library</p>
            </>
          )}
        </div>
        <span className="text-[var(--color-text-muted)]">→</span>
      </button>

      {/* Next button */}
      <div className="mt-auto flex justify-end">
        <button
          disabled={!canAdvance}
          onClick={() => setStep(2)}
          className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors"
        >
          Next →
        </button>
      </div>

      {showAbsModal && <AbsLibraryModal onClose={() => setShowAbsModal(false)} />}
    </div>
  )
}

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps: [1 | 2 | 3, string][] = [[1, 'Source'], [2, 'Settings'], [3, 'Transcribe']]
  return (
    <div className="flex items-center gap-0">
      {steps.map(([n, label], i) => (
        <div key={n} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
            n === current
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]'
          }`}>
            <span>{n}</span><span>{label}</span>
          </div>
          {i < steps.length - 1 && <div className="w-6 h-px bg-[var(--color-surface-border)]" />}
        </div>
      ))}
    </div>
  )
}
```

> **Note:** `StepIndicator` is defined in the same file for now. If it's needed in other pages later, extract to `src/renderer/src/components/StepIndicator.tsx`.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/pages/SourcePage.tsx
git commit -m "feat: SourcePage — local drag-drop and ABS browse button"
```

---

### Task 14: SettingsPage (Step 2)

**Files:**
- Create: `src/renderer/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Implement SettingsPage**

Create `src/renderer/src/pages/SettingsPage.tsx`:

```tsx
import { useAppStore } from '../store/useAppStore'
import { ipc } from '../lib/ipc'
import { WHISPER_MODELS } from '../lib/whisperModels'

export function SettingsPage() {
  const setStep = useAppStore(s => s.setWizardStep)
  const model = useAppStore(s => s.wizard.model)
  const setModel = useAppStore(s => s.setWizardModel)
  const source = useAppStore(s => s.wizard.source)
  const outputFolder = useAppStore(s => s.wizard.outputFolder)
  const setOutputFolder = useAppStore(s => s.setWizardOutputFolder)
  const epubPath = useAppStore(s => s.wizard.epubPath)
  const setEpub = useAppStore(s => s.setWizardEpub)
  const absItem = useAppStore(s => s.wizard.absItem)

  const canAdvance = source === 'abs' || outputFolder !== null

  const pickOutput = async () => {
    const folder = await ipc.files.pickOutputFolder()
    if (folder) setOutputFolder(folder)
  }

  const pickEpub = async () => {
    const path = await ipc.files.pickEpub()
    if (path) setEpub(path)
  }

  return (
    <div className="flex flex-col gap-5 h-full">
      <StepIndicator current={2} />

      <h2 className="text-[var(--color-text-primary)] font-semibold text-sm">Settings</h2>

      {/* Model selector */}
      <div className="flex flex-col gap-2">
        <label className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Whisper Model</label>
        <select
          value={model}
          onChange={e => setModel(e.target.value as typeof model)}
          className="bg-[var(--color-surface-raised)] border border-[var(--color-surface-border)] text-[var(--color-text-primary)] text-sm rounded-md px-3 py-2 focus:outline-none focus:border-[var(--color-accent)]"
        >
          {WHISPER_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Output folder — local only */}
      {source === 'local' && (
        <div className="flex flex-col gap-2">
          <label className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Output Folder</label>
          <button
            onClick={pickOutput}
            className="flex items-center gap-2 border border-[var(--color-surface-border)] hover:border-[var(--color-accent-dim)] rounded-md px-3 py-2 text-sm text-left transition-colors"
          >
            <span className="text-[var(--color-text-muted)]">📁</span>
            <span className={outputFolder ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}>
              {outputFolder ?? 'Select output folder…'}
            </span>
          </button>
        </div>
      )}

      {/* EPUB */}
      <div className="flex flex-col gap-2">
        <label className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
          EPUB Vocabulary{' '}
          <span className="normal-case text-[var(--color-text-muted)] font-normal">(optional — improves proper noun accuracy)</span>
        </label>
        {source === 'abs' && absItem?.epubPath ? (
          <div className="flex items-center gap-2 border border-[var(--color-surface-border)] rounded-md px-3 py-2">
            <span className="text-[var(--color-accent)] text-xs">✓</span>
            <span className="text-[var(--color-text-secondary)] text-sm">Linked from ABS automatically</span>
          </div>
        ) : (
          <button
            onClick={pickEpub}
            className="flex items-center gap-2 border border-[var(--color-surface-border)] hover:border-[var(--color-accent-dim)] rounded-md px-3 py-2 text-sm text-left transition-colors"
          >
            <span className="text-[var(--color-text-muted)]">📖</span>
            <span className={epubPath ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}>
              {epubPath ? epubPath.split(/[\\/]/).pop() : 'Select EPUB…'}
            </span>
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-auto flex justify-between">
        <button
          onClick={() => setStep(1)}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm px-3 py-2 transition-colors"
        >
          ← Back
        </button>
        <button
          disabled={!canAdvance}
          onClick={() => setStep(3)}
          className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

// Re-export StepIndicator from SourcePage or duplicate here
// For now, inline the same component
function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps: [1 | 2 | 3, string][] = [[1, 'Source'], [2, 'Settings'], [3, 'Transcribe']]
  return (
    <div className="flex items-center gap-0">
      {steps.map(([n, label], i) => (
        <div key={n} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
            n === current
              ? 'bg-[var(--color-accent)] text-white'
              : n < current
              ? 'bg-[var(--color-accent-dim)] text-[var(--color-text-secondary)]'
              : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]'
          }`}>
            <span>{n}</span><span>{label}</span>
          </div>
          {i < steps.length - 1 && <div className="w-6 h-px bg-[var(--color-surface-border)]" />}
        </div>
      ))}
    </div>
  )
}
```

> **Note:** `StepIndicator` is duplicated across pages for now. If it needs to change later, extract it. For v1 this is fine — YAGNI.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/pages/SettingsPage.tsx
git commit -m "feat: SettingsPage — model selector, output folder, EPUB picker"
```

---

### Task 15: TranscribePage (Step 3 — queue button)

**Files:**
- Create: `src/renderer/src/pages/TranscribePage.tsx`

- [ ] **Step 1: Install uuid (needed for job ID generation)**

```bash
npm install uuid
npm install -D @types/uuid
```

- [ ] **Step 2: Implement TranscribePage**

Create `src/renderer/src/pages/TranscribePage.tsx`:

```tsx
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppStore } from '../store/useAppStore'
import { ipc } from '../lib/ipc'
import { TranscriptionJob } from '../../../shared/types'

export function TranscribePage() {
  const [adding, setAdding] = useState(false)
  const wizard = useAppStore(s => s.wizard)
  const resetWizard = useAppStore(s => s.resetWizard)
  const setStep = useAppStore(s => s.setWizardStep)

  const title = wizard.source === 'abs'
    ? wizard.absItem?.title ?? 'Unknown'
    : wizard.audioFiles[0]?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Unknown'

  const destination = wizard.source === 'abs'
    ? 'Will be uploaded to AudioBookShelf'
    : wizard.outputFolder ?? 'No output folder selected'

  const addToQueue = async () => {
    setAdding(true)
    try {
      const job: TranscriptionJob = {
        id: uuidv4(),
        status: 'queued',
        source: wizard.source!,
        title,
        audioFiles: wizard.source === 'abs'
          ? (wizard.absItem?.audioFiles.map(f => f.path) ?? [])
          : wizard.audioFiles,
        outputPath: wizard.source === 'local' ? wizard.outputFolder : null,
        absItemId: wizard.source === 'abs' ? wizard.absItem?.id ?? null : null,
        epubPath: wizard.source === 'abs'
          ? (wizard.absItem?.epubPath ?? null)
          : (wizard.epubPath ?? null),
        model: wizard.model,
        progress: null,
        srtPath: null,
        error: null,
        createdAt: Date.now(),
        completedAt: null,
      }
      await ipc.queue.add(job)
      resetWizard()
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 h-full">
      <StepIndicator current={3} />

      <h2 className="text-[var(--color-text-primary)] font-semibold text-sm">Ready to queue</h2>

      {/* Summary */}
      <div className="border border-[var(--color-surface-border)] rounded-lg p-4 flex flex-col gap-3 bg-[var(--color-surface-raised)]">
        <Row label="Title" value={title} />
        <Row label="Model" value={wizard.model} />
        <Row label="Source" value={wizard.source === 'abs' ? 'AudioBookShelf' : `${wizard.audioFiles.length} local file(s)`} />
        <Row label="Output" value={destination} />
        {(wizard.epubPath || wizard.absItem?.epubPath) && (
          <Row label="EPUB" value="Vocabulary prompting enabled" accent />
        )}
      </div>

      {/* Navigation */}
      <div className="mt-auto flex justify-between">
        <button
          onClick={() => setStep(2)}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm px-3 py-2 transition-colors"
        >
          ← Back
        </button>
        <button
          disabled={adding}
          onClick={addToQueue}
          className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors"
        >
          {adding ? 'Adding…' : 'Add to Queue'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider shrink-0">{label}</span>
      <span className={`text-xs text-right ${accent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}>
        {value}
      </span>
    </div>
  )
}

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps: [1 | 2 | 3, string][] = [[1, 'Source'], [2, 'Settings'], [3, 'Transcribe']]
  return (
    <div className="flex items-center gap-0">
      {steps.map(([n, label], i) => (
        <div key={n} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
            n === current
              ? 'bg-[var(--color-accent)] text-white'
              : n < current
              ? 'bg-[var(--color-accent-dim)] text-[var(--color-text-secondary)]'
              : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]'
          }`}>
            <span>{n}</span><span>{label}</span>
          </div>
          {i < steps.length - 1 && <div className="w-6 h-px bg-[var(--color-surface-border)]" />}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/TranscribePage.tsx
git commit -m "feat: TranscribePage — job summary and Add to Queue button"
```

---

### Task 16: QueuePanel component

**Files:**
- Create: `src/renderer/src/components/QueuePanel.tsx`

- [ ] **Step 1: Implement QueuePanel**

Create `src/renderer/src/components/QueuePanel.tsx`:

```tsx
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ipc } from '../lib/ipc'
import { TranscriptionJob } from '../../../shared/types'
import { AppSettingsPanel } from './AppSettingsPanel'

export function QueuePanel() {
  const [showSettings, setShowSettings] = useState(false)
  const jobs = useAppStore(s => s.queue.jobs)
  const setJobs = useAppStore(s => s.setJobs)

  const runningCount = jobs.filter(j => j.status === 'running' || j.status === 'queued').length

  const cancel = async (id: string) => {
    const updated = await ipc.queue.cancel(id)
    setJobs(updated)
  }

  const remove = async (id: string) => {
    const updated = await ipc.queue.remove(id)
    setJobs(updated)
  }

  const clearDone = async () => {
    const updated = await ipc.queue.clearDone()
    setJobs(updated)
  }

  return (
    <div className="w-56 flex flex-col bg-[#060000] border-l border-[var(--color-surface-border)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--color-surface-border)]">
        <span className="text-[var(--color-text-muted)] text-xs font-semibold uppercase tracking-widest">Queue</span>
        {runningCount > 0 && (
          <span className="bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] text-xs rounded-full px-2 py-0.5">
            {runningCount}
          </span>
        )}
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {jobs.length === 0 && (
          <p className="text-[var(--color-text-muted)] text-xs text-center mt-6">No jobs yet</p>
        )}
        {jobs.map(job => (
          <JobCard key={job.id} job={job} onCancel={cancel} onRemove={remove} />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--color-surface-border)] p-2 flex flex-col gap-1">
        {jobs.some(j => j.status === 'done' || j.status === 'cancelled' || j.status === 'failed') && (
          <button
            onClick={clearDone}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-xs px-2 py-1 text-left transition-colors"
          >
            Clear finished
          </button>
        )}
        <button
          onClick={() => setShowSettings(true)}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-xs px-2 py-1 text-left transition-colors flex items-center gap-1.5"
        >
          <span>⚙</span><span>ABS Settings</span>
        </button>
      </div>

      {showSettings && <AppSettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function JobCard({
  job,
  onCancel,
  onRemove,
}: {
  job: TranscriptionJob
  onCancel: (id: string) => void
  onRemove: (id: string) => void
}) {
  const isActive = job.status === 'running'
  const isDone = job.status === 'done'
  const isFailed = job.status === 'failed'
  const isCancelled = job.status === 'cancelled'

  return (
    <div className={`rounded-md p-2 border text-xs flex flex-col gap-1 ${
      isActive
        ? 'bg-[#120000] border-[var(--color-accent-dim)]'
        : 'bg-[#0a0000] border-[var(--color-surface-border)]'
    } ${isDone || isCancelled ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-1">
        <span className={`font-semibold leading-tight ${isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
          {job.title}
        </span>
        <StatusBadge job={job} />
      </div>

      {isActive && job.progress && (
        <>
          <div className="bg-black/40 rounded h-1 overflow-hidden">
            <div
              className="bg-[var(--color-accent)] h-full transition-all duration-300"
              style={{ width: `${job.progress.percent}%` }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[var(--color-text-muted)] capitalize">{job.progress.phase}</span>
            <button
              onClick={() => onCancel(job.id)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {!isActive && (
        <div className="flex justify-between items-center">
          <span className="text-[var(--color-text-muted)]">
            {job.source === 'abs' ? 'ABS' : 'Local'} · {job.model}
          </span>
          {(isDone || isFailed || isCancelled) && (
            <button
              onClick={() => onRemove(job.id)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              ×
            </button>
          )}
        </div>
      )}

      {isFailed && job.error && (
        <p className="text-[var(--color-accent)] text-xs mt-0.5">{job.error}</p>
      )}
    </div>
  )
}

function StatusBadge({ job }: { job: TranscriptionJob }) {
  const map: Record<string, string> = {
    running: 'text-[#93c5fd] bg-[#1d4ed8]/30',
    queued: 'text-[var(--color-text-muted)] bg-[var(--color-surface-raised)]',
    done: 'text-green-400 bg-green-900/30',
    failed: 'text-[var(--color-accent)] bg-[var(--color-accent-dim)]/20',
    cancelled: 'text-[var(--color-text-muted)] bg-[var(--color-surface-raised)]',
  }
  const label: Record<string, string> = {
    running: `▶ ${job.progress?.percent ?? 0}%`,
    queued: '⏳ Queued',
    done: '✓ Done',
    failed: '✗ Failed',
    cancelled: '— Cancelled',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap ${map[job.status]}`}>
      {label[job.status]}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/QueuePanel.tsx
git commit -m "feat: QueuePanel with running/queued/done/failed job cards"
```

---

### Task 17: AbsLibraryModal

**Files:**
- Create: `src/renderer/src/components/AbsLibraryModal.tsx`

- [ ] **Step 1: Implement AbsLibraryModal**

Create `src/renderer/src/components/AbsLibraryModal.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ipc } from '../lib/ipc'
import { AbsLibrary, AbsBook } from '../../../shared/types'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function AbsLibraryModal({ onClose }: { onClose: () => void }) {
  const [libraries, setLibraries] = useState<AbsLibrary[]>([])
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [books, setBooks] = useState<AbsBook[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingBooks, setLoadingBooks] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const setSource = useAppStore(s => s.setWizardSource)
  const setAbsItem = useAppStore(s => s.setWizardAbsItem)
  const setAudioFiles = useAppStore(s => s.setWizardAudioFiles)
  const jobs = useAppStore(s => s.queue.jobs)

  function fetchLibraries() {
    setLoading(true)
    setError(null)
    ipc.abs.getLibraries()
      .then(libs => {
        setLibraries(libs)
        if (libs.length > 0) setSelectedLibraryId(libs[0].id)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchLibraries() }, [])

  function fetchBooks(libraryId: string) {
    setLoadingBooks(true)
    ipc.abs.getBooks(libraryId)
      .then(setBooks)
      .catch(e => setError(e.message))
      .finally(() => setLoadingBooks(false))
  }

  useEffect(() => {
    if (!selectedLibraryId) return
    fetchBooks(selectedLibraryId)
  }, [selectedLibraryId])

  const selectBook = (book: AbsBook) => {
    setSource('abs')
    setAbsItem({
      id: book.id,
      title: book.title,
      authorName: book.authorName,
      duration: book.duration,
      ebookPath: book.ebookPath,
      audioFiles: book.audioFiles.map(f => ({ path: f.path })),
    })
    setAudioFiles([])
    onClose()
  }

  const filteredBooks = books.filter(b =>
    b.title.toLowerCase().includes(search.toLowerCase()) ||
    b.authorName.toLowerCase().includes(search.toLowerCase())
  )

  const queuedIds = new Set(jobs.filter(j => j.status !== 'done' && j.status !== 'cancelled').map(j => j.absItemId))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-surface-border)] rounded-xl w-[640px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-surface-border)]">
          <h3 className="text-[var(--color-text-primary)] font-semibold text-sm">Browse AudioBookShelf</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => selectedLibraryId ? fetchBooks(selectedLibraryId) : fetchLibraries()}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-xs px-2 py-1 transition-colors"
            >
              ↻ Refresh
            </button>
            <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-lg">×</button>
          </div>
        </div>

        {/* Library tabs */}
        {libraries.length > 1 && (
          <div className="flex gap-1 px-4 pt-3">
            {libraries.map(lib => (
              <button
                key={lib.id}
                onClick={() => setSelectedLibraryId(lib.id)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  lib.id === selectedLibraryId
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {lib.name}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="px-4 py-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search books…"
            className="w-full bg-[var(--color-surface)] border border-[var(--color-surface-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
          />
        </div>

        {/* Book list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
          {loading && <p className="text-[var(--color-text-muted)] text-xs text-center mt-6">Loading libraries…</p>}
          {error && <p className="text-[var(--color-accent)] text-xs text-center mt-6">{error}</p>}
          {loadingBooks && <p className="text-[var(--color-text-muted)] text-xs text-center mt-6">Loading books…</p>}

          {!loading && !loadingBooks && filteredBooks.map(book => {
            const isQueued = queuedIds.has(book.id)
            return (
              <button
                key={book.id}
                onClick={() => selectBook(book)}
                disabled={isQueued}
                className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-surface-border)] hover:border-[var(--color-accent-dim)] disabled:opacity-50 disabled:cursor-default text-left transition-colors w-full"
              >
                {/* Cover */}
                <div className="w-10 h-10 rounded bg-[var(--color-surface)] flex-shrink-0 overflow-hidden">
                  {book.cover && <img src={book.cover} alt="" className="w-full h-full object-cover" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--color-text-primary)] text-xs font-semibold truncate">{book.title}</p>
                  <p className="text-[var(--color-text-muted)] text-xs truncate">
                    {book.authorName} · {formatDuration(book.duration)}
                  </p>
                </div>

                {/* Status badge */}
                <div className="flex-shrink-0">
                  {isQueued ? (
                    <span className="text-[var(--color-text-muted)] bg-[var(--color-surface)] text-[10px] rounded px-1.5 py-0.5">Queued</span>
                  ) : book.hasSubtitles ? (
                    <span className="text-green-400 bg-green-900/20 text-[10px] rounded px-1.5 py-0.5">Has subtitles</span>
                  ) : (
                    <span className="text-[var(--color-text-muted)] bg-[var(--color-surface)] text-[10px] rounded px-1.5 py-0.5">No subtitles</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/AbsLibraryModal.tsx
git commit -m "feat: AbsLibraryModal with library browser, book list, and subtitle status badges"
```

---

### Task 18: AppSettingsPanel

**Files:**
- Create: `src/renderer/src/components/AppSettingsPanel.tsx`

- [ ] **Step 1: Implement AppSettingsPanel**

Create `src/renderer/src/components/AppSettingsPanel.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ipc } from '../lib/ipc'

export function AppSettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useAppStore(s => s.settings)
  const setSettings = useAppStore(s => s.setSettings)

  const [absUrl, setAbsUrl] = useState(settings.absUrl)
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const testConnection = async () => {
    if (!absUrl || !apiKey) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await ipc.abs.testConnection(absUrl, apiKey)
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    await ipc.settings.setUrl(absUrl)
    if (apiKey) await ipc.settings.setApiKey(apiKey)
    setSettings({ absUrl })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-surface-border)] rounded-xl w-[440px] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-surface-border)]">
          <h3 className="text-[var(--color-text-primary)] font-semibold text-sm">ABS Connection Settings</h3>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-lg">×</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Server URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Server URL</label>
            <input
              value={absUrl}
              onChange={e => setAbsUrl(e.target.value)}
              placeholder="http://192.168.1.50:13378"
              className="bg-[var(--color-surface)] border border-[var(--color-surface-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
            />
          </div>

          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Leave blank to keep existing key"
              className="bg-[var(--color-surface)] border border-[var(--color-surface-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
            />
            <p className="text-[var(--color-text-muted)] text-xs">
              Stored securely in your OS credential store — never saved to disk.
            </p>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`rounded-md px-3 py-2 text-xs ${
              testResult.ok
                ? 'bg-green-900/20 text-green-400'
                : 'bg-[var(--color-accent-dim)]/20 text-[var(--color-accent)]'
            }`}>
              {testResult.ok ? '✓ Connected successfully' : `✗ ${testResult.error}`}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center pt-1">
            <button
              onClick={testConnection}
              disabled={!absUrl || !apiKey || testing}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40 text-sm transition-colors"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm px-3 py-1.5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-semibold px-4 py-1.5 rounded-md transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/AppSettingsPanel.tsx
git commit -m "feat: AppSettingsPanel — ABS URL + API key with connection test"
```

---

### Task 19: Final integration verification

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```
Expected: No TypeScript errors.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```
Expected: All tests pass.

- [ ] **Step 3: Launch the app and verify end-to-end**

```bash
npm run dev
```

Manually verify:
- [ ] App opens with split layout (wizard left, queue right)
- [ ] Drop a local `.m4b` or `.mp3` file onto the drop zone — file name appears
- [ ] Click Next → Settings page shows model selector and output folder picker
- [ ] Click Next → Transcribe page shows job summary
- [ ] Click "Add to Queue" — job appears in queue panel with "Queued" status
- [ ] Open ABS Settings (queue footer link), enter server URL + API key, click "Test connection" → success or error shown
- [ ] Open ABS modal (with valid connection) → libraries and books list loads, subtitle status badges visible
- [ ] Select an ABS book → wizard pre-fills with book info

- [ ] **Step 4: Build production bundle**

```bash
npm run build
```
Expected: Build completes without errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: AudioBook Forge v1.0 — complete implementation"
```

---

## Dependencies Reference

Full `package.json` additions beyond the electron-vite scaffold:

```json
{
  "dependencies": {
    "zustand": "^5.0.0",
    "keytar": "^7.9.0",
    "ffmpeg-static": "^5.0.0",
    "ffprobe-static": "^3.1.0",
    "music-metadata": "^11.0.0",
    "axios": "^1.0.0",
    "epub2": "^3.0.0",
    "uuid": "^9.0.0",
    "form-data": "^4.0.0"
  },
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vitest": "^2.0.0",
    "@types/uuid": "^9.0.0"
  }
}
```

> **Note:** `keytar` requires native bindings. If the build fails on `npm install`, run:
> ```bash
> npm install --build-from-source keytar
> ```
> You may need Python and Visual Studio Build Tools on Windows.
