# AudioBook Forge UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the renderer into a cleaner desktop workspace with a single job composer, a persistent but quieter queue rail, a header-level settings entry point, and a compact confirmation modal while preserving existing queue and ABS behavior.

**Architecture:** Keep all main-process IPC, queue orchestration, and ABS integration intact. Replace the page-based renderer flow with a draft-driven shell backed by small pure helper functions and minimal Zustand changes so source switching, validation, confirmation summaries, and queue payload construction are testable without the full UI.

**Tech Stack:** React 19, TypeScript 5, Tailwind v4, Zustand 5, Vitest 4, Testing Library React, Electron IPC bridge

---

## File Map

### Create
- `vitest.config.ts` - renderer test config with `jsdom` and a shared setup file
- `src/renderer/src/test/setup.ts` - `jest-dom` setup and reusable `window.electron` mocks
- `src/renderer/src/lib/jobDraft.ts` - pure draft helpers for source switching, validation, review rows, and queue payload building
- `src/renderer/src/lib/__tests__/jobDraft.test.ts` - unit tests for draft helper behavior
- `src/renderer/src/store/__tests__/useAppStore.test.ts` - store tests for draft/reset/settings interactions
- `src/renderer/src/components/AppHeader.tsx` - top app bar with brand, settings trigger, and queue count context
- `src/renderer/src/components/JobComposer.tsx` - left workspace that replaces the old page-based wizard
- `src/renderer/src/components/SourceSelector.tsx` - source card plus selected-source summary row and `Change` action
- `src/renderer/src/components/JobOptionsCard.tsx` - model, output folder, and EPUB controls
- `src/renderer/src/components/QueueConfirmationModal.tsx` - short review modal for `Add to Queue`
- `src/renderer/src/components/__tests__/JobComposer.test.tsx` - focused UI tests for composer flow
- `src/renderer/src/components/__tests__/QueueConfirmationModal.test.tsx` - focused UI tests for confirmation output and actions
- `src/renderer/src/components/__tests__/QueuePanel.test.tsx` - queue rail tests for active counts and finished-section behavior
- `src/renderer/src/components/__tests__/AppSettingsPanel.test.tsx` - settings tests for header-driven configuration flow

### Modify
- `package.json` - add UI test dependencies and test scripts
- `src/renderer/src/App.tsx` - replace page switching with the new shell, header, composer, queue rail, and modal mounts
- `src/renderer/src/store/useAppStore.ts` - simplify draft state, remove page navigation dependency, and add modal state/actions
- `src/renderer/src/assets/main.css` - rebalance black/red theme tokens and improve readable text defaults
- `src/renderer/src/components/QueuePanel.tsx` - evolve into the slimmer queue rail and remove the settings link from the footer
- `src/renderer/src/components/AppSettingsPanel.tsx` - restyle, keep default model, and align with the new header entry point
- `src/renderer/src/components/AbsLibraryModal.tsx` - improve spacing/contrast and align source selection handoff with the composer

### Delete
- `src/renderer/src/pages/SourcePage.tsx`
- `src/renderer/src/pages/SettingsPage.tsx`
- `src/renderer/src/pages/TranscribePage.tsx`

---

## Chunk 1: Draft Logic And Store Simplification

### Task 1: Add renderer test support and a pure draft helper

**Files:**
- Create: `vitest.config.ts`
- Create: `src/renderer/src/test/setup.ts`
- Create: `src/renderer/src/lib/jobDraft.ts`
- Create: `src/renderer/src/lib/__tests__/jobDraft.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install the renderer test dependencies**

Run:
```bash
npm install -D @testing-library/react @testing-library/jest-dom jsdom
```

Expected: install completes without changing runtime dependencies.

- [ ] **Step 2: Add test scripts and a jsdom Vitest config**

Update `package.json` scripts to include:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Create `vitest.config.ts` with a `jsdom` test environment and `setupFiles: ['src/renderer/src/test/setup.ts']`.

Create `src/renderer/src/test/setup.ts` to import `@testing-library/jest-dom/vitest` and define a minimal default `window.electron` mock object that component tests can override per test.

- [ ] **Step 3: Write the failing draft helper tests**

Create `src/renderer/src/lib/__tests__/jobDraft.test.ts` with tests for:
- selecting local files clears ABS item and keeps the current model
- selecting an ABS item clears local audio files and local output folder dependency
- `canContinue` returns `false` for local drafts without an output folder and `true` once required fields exist
- `buildConfirmationRows` returns `Upload to ABS automatically` for ABS jobs and the output folder path for local jobs

Use this test skeleton:
```ts
import { describe, expect, it } from 'vitest'
import {
  selectLocalFiles,
  selectAbsItem,
  canContinue,
  buildConfirmationRows
} from '../jobDraft'

describe('jobDraft', () => {
  it('clears ABS state when local files are selected', () => {
    // arrange draft with absItem
    // act with selectLocalFiles
    // assert absItem is null and files are set
  })
})
```

- [ ] **Step 4: Implement the pure helper functions**

Create `src/renderer/src/lib/jobDraft.ts` with focused helpers:
```ts
export function selectLocalFiles(draft: WizardStateLike, audioFiles: string[]): WizardStateLike
export function selectAbsItem(draft: WizardStateLike, absItem: AbsBookSummary): WizardStateLike
export function canContinue(draft: WizardStateLike): boolean
export function buildConfirmationRows(draft: WizardStateLike): Array<{ label: string; value: string }>
```

Implementation rules:
- preserve the current model while the same draft is being edited
- clear source-specific values when switching source
- treat ABS-linked EPUB as the displayed value when present
- keep these functions free of `window.electron` or React concerns

- [ ] **Step 5: Run the helper test suite**

Run:
```bash
npx vitest run src/renderer/src/lib/__tests__/jobDraft.test.ts
```

Expected: PASS for all new tests.

- [ ] **Step 6: Commit the draft helper slice**

```bash
git add package.json package-lock.json vitest.config.ts src/renderer/src/test/setup.ts src/renderer/src/lib/jobDraft.ts src/renderer/src/lib/__tests__/jobDraft.test.ts
git commit -m "test: add renderer draft helper coverage"
```

---

### Task 2: Simplify the Zustand store around a single draft and modal state

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`
- Create: `src/renderer/src/store/__tests__/useAppStore.test.ts`

- [ ] **Step 1: Write failing store tests for the new draft rules**

Create `src/renderer/src/store/__tests__/useAppStore.test.ts` covering:
- `setSettings` only applies the new default model to a fresh composer state, not an in-progress draft
- switching from local to ABS clears `audioFiles` and `outputFolder`
- switching from ABS to local clears `absItem`
- opening and closing the confirmation modal updates store state without resetting the draft
- `resetWizard` closes the modal and restores the default model from settings

Start from this shape:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../useAppStore'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(/* reset to defaults */)
  })
})
```

- [ ] **Step 2: Refactor `useAppStore.ts` to remove page-step dependency**

Update the store toward the new model while keeping the current app runnable during this chunk:
- add a single draft object for source/audio/ABS item/model/output/EPUB
- add a small UI state for `settingsOpen` and `confirmationOpen`
- add source-selection actions that delegate to `jobDraft.ts`
- add a reset path that rehydrates the model from `settings.defaultModel`
- keep `wizard.step` temporarily as a compatibility field until Chunk 2 swaps out the old page renderer

Keep:
- queue state and queue subscription behavior
- ABS library cache behavior
- existing settings load behavior on mount

- [ ] **Step 3: Run the store tests**

Run:
```bash
npx vitest run src/renderer/src/store/__tests__/useAppStore.test.ts
```

Expected: PASS for all store transitions.

- [ ] **Step 4: Run typecheck to catch renderer fallout early**

Run:
```bash
npm run typecheck
```

Expected: PASS. The temporary compatibility field should keep the old page flow compiling until the new shell replaces it in Chunk 2.

- [ ] **Step 5: Commit the store refactor**

```bash
git add src/renderer/src/store/useAppStore.ts src/renderer/src/store/__tests__/useAppStore.test.ts src/renderer/src/lib/jobDraft.ts
git commit -m "refactor: simplify renderer draft state for ui cleanup"
```

---

## Chunk 2: App Shell, Composer, And Confirmation Modal

### Task 3: Replace the page-based wizard with the new shell and composer

**Files:**
- Create: `src/renderer/src/components/AppHeader.tsx`
- Create: `src/renderer/src/components/JobComposer.tsx`
- Create: `src/renderer/src/components/SourceSelector.tsx`
- Create: `src/renderer/src/components/JobOptionsCard.tsx`
- Create: `src/renderer/src/components/__tests__/JobComposer.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing composer test**

Create `src/renderer/src/components/__tests__/JobComposer.test.tsx` to verify:
- the header renders a `Settings` trigger
- the composer shows both source actions on first render
- selecting a local source reveals the output folder row
- `Continue` stays disabled until the draft satisfies `canContinue`

Use Testing Library and a real store instance seeded through `useAppStore.setState(...)`.

- [ ] **Step 2: Implement the new shell**

Create `AppHeader.tsx` for:
- compact brand/title
- settings button
- optional active queue count badge

Create `SourceSelector.tsx` for:
- local drag/drop and browse action
- ABS browse action
- compact selected-source summary with `Change`

Create `JobOptionsCard.tsx` for:
- whisper model select
- conditional output folder row
- conditional EPUB row with ABS-linked precedence

Create `JobComposer.tsx` to compose those pieces and own the `Continue` button.

Modify `src/renderer/src/App.tsx` to render:
- header + left composer
- existing queue component on the right
- `AbsLibraryModal` when open
- `AppSettingsPanel` when header state is open

Once the new shell is wired and compiling, remove the temporary `wizard.step` compatibility field from `useAppStore.ts`. Do not delete the old `pages/` files yet; simply stop importing them.

- [ ] **Step 3: Run the composer test**

Run:
```bash
npx vitest run src/renderer/src/components/__tests__/JobComposer.test.tsx
```

Expected: PASS with the new shell mounted through `App.tsx` or `JobComposer.tsx`.

- [ ] **Step 4: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected: PASS after removing all `wizard.step` usage from the renderer entry path.

- [ ] **Step 5: Commit the shell/composer replacement**

```bash
git add src/renderer/src/App.tsx src/renderer/src/store/useAppStore.ts src/renderer/src/components/AppHeader.tsx src/renderer/src/components/JobComposer.tsx src/renderer/src/components/SourceSelector.tsx src/renderer/src/components/JobOptionsCard.tsx src/renderer/src/components/__tests__/JobComposer.test.tsx
git commit -m "feat: replace page wizard with single job composer"
```

---

### Task 4: Add the confirmation modal and move queue submission out of the old page

**Files:**
- Create: `src/renderer/src/components/QueueConfirmationModal.tsx`
- Create: `src/renderer/src/components/__tests__/QueueConfirmationModal.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/lib/jobDraft.ts`

- [ ] **Step 1: Write the failing confirmation modal tests**

Create `src/renderer/src/components/__tests__/QueueConfirmationModal.test.tsx` to verify:
- local jobs show the output folder in the summary
- ABS jobs show `Upload to ABS automatically`
- clicking `Add to Queue` calls the submission handler with the current draft
- clicking `Back` closes the modal without resetting the draft

- [ ] **Step 2: Extend the draft helper with queue-payload construction**

Add a pure helper in `src/renderer/src/lib/jobDraft.ts`:
```ts
export function buildQueueJobData(
  draft: WizardStateLike,
  settings: AppSettings
): QueueAddPayload
```

Requirements:
- preserve current ABS URL handling for remote `contentUrl` vs item download URL fallback
- reuse the same payload fields currently assembled in `TranscribePage.tsx`
- leave queue IPC shapes unchanged

- [ ] **Step 3: Implement `QueueConfirmationModal.tsx` and wire it into `App.tsx`**

The modal should:
- read summary rows from `buildConfirmationRows`
- offer `Back` and `Add to Queue`
- call `window.electron.queue.add(...)`
- reset the draft after successful add

Move the old queue-submission logic out of `TranscribePage.tsx`; do not duplicate it in multiple components.

- [ ] **Step 4: Run the confirmation modal tests**

Run:
```bash
npx vitest run src/renderer/src/components/__tests__/QueueConfirmationModal.test.tsx
```

Expected: PASS for both local and ABS review states.

- [ ] **Step 5: Delete the no-longer-needed review page**

Delete:
- `src/renderer/src/pages/TranscribePage.tsx`

Confirm there are no remaining imports:
```bash
rg "TranscribePage" src
```

Expected: no matches.

- [ ] **Step 6: Commit the confirmation flow**

```bash
git add -A src/renderer/src/components/QueueConfirmationModal.tsx src/renderer/src/components/__tests__/QueueConfirmationModal.test.tsx src/renderer/src/App.tsx src/renderer/src/lib/jobDraft.ts src/renderer/src/pages/TranscribePage.tsx
git commit -m "feat: add queue confirmation modal"
```

---

## Chunk 3: Queue Rail, Settings, Modal Polish, And Cleanup

### Task 5: Refine the queue panel into a slimmer queue rail and move settings ownership to the header

**Files:**
- Modify: `src/renderer/src/components/QueuePanel.tsx`
- Create: `src/renderer/src/components/__tests__/QueuePanel.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing queue rail tests**

Create `src/renderer/src/components/__tests__/QueuePanel.test.tsx` to verify:
- the rail shows an active-job count
- finished jobs are visually separated behind a collapsed/expandable section
- the footer no longer contains the old settings entry point

- [ ] **Step 2: Refactor `QueuePanel.tsx` into the quieter rail layout**

Keep the existing job actions and status behavior, but change the presentation to:
- slightly wider readable text
- stronger title/status hierarchy
- separate active/queued section from finished jobs
- collapsed finished section by default

Do not change queue IPC behavior or job action semantics.

- [ ] **Step 3: Ensure settings is opened only from the header**

Modify `App.tsx` so:
- `AppHeader` owns the visible settings trigger
- `AppSettingsPanel` opens from app-level state
- `QueuePanel` no longer renders `AppSettingsPanel` directly

- [ ] **Step 4: Run the queue rail tests and typecheck**

Run:
```bash
npx vitest run src/renderer/src/components/__tests__/QueuePanel.test.tsx
npm run typecheck
```

Expected: PASS for the new queue structure and no renderer type errors.

- [ ] **Step 5: Commit the queue rail slice**

```bash
git add src/renderer/src/components/QueuePanel.tsx src/renderer/src/components/__tests__/QueuePanel.test.tsx src/renderer/src/App.tsx
git commit -m "feat: refine persistent queue rail"
```

---

### Task 6: Restyle settings, ABS modal, and global theme tokens; remove the obsolete wizard pages

**Files:**
- Modify: `src/renderer/src/components/AppSettingsPanel.tsx`
- Modify: `src/renderer/src/components/AbsLibraryModal.tsx`
- Modify: `src/renderer/src/assets/main.css`
- Create: `src/renderer/src/components/__tests__/AppSettingsPanel.test.tsx`
- Delete: `src/renderer/src/pages/SourcePage.tsx`
- Delete: `src/renderer/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Write the failing settings panel test**

Create `src/renderer/src/components/__tests__/AppSettingsPanel.test.tsx` to verify:
- the default model control is still present
- saving with a URL and chosen model calls the settings bridge methods
- the panel can be opened and closed without queue-panel coupling

- [ ] **Step 2: Update the global theme tokens for readability**

Modify `src/renderer/src/assets/main.css` so the base system uses:
- black/charcoal surfaces
- warm off-white primary text
- softer rose secondary text
- muted red borders/metadata
- brighter red only for primary actions and destructive emphasis

Increase default readable text sizing for common labels and queue metadata rather than relying on `10px`/`11px` classes everywhere.

- [ ] **Step 3: Restyle `AppSettingsPanel.tsx` and `AbsLibraryModal.tsx`**

Keep current behavior, but align them with the new shell:
- settings feels like app configuration, not queue management
- ABS modal improves spacing, error readability, and selection clarity
- missing ABS config points users toward header settings

- [ ] **Step 4: Delete the unused wizard pages**

Delete:
- `src/renderer/src/pages/SourcePage.tsx`
- `src/renderer/src/pages/SettingsPage.tsx`

Confirm there are no remaining imports:
```bash
rg "SourcePage|SettingsPage" src
```

Expected: no matches.

- [ ] **Step 5: Run the targeted test, lint, typecheck, and build**

Run:
```bash
npx vitest run src/renderer/src/components/__tests__/AppSettingsPanel.test.tsx
npm run lint
npm run typecheck
npm run build
```

Expected:
- test PASS
- lint with no new errors
- typecheck PASS
- production build completes

- [ ] **Step 6: Manually verify the full UI flow**

Run:
```bash
npm run dev
```

Manual checklist:
- [ ] Header shows a visible `Settings` button
- [ ] New composer opens on launch without any page-step indicator
- [ ] Local file selection reveals output folder and enables `Continue` only after required fields exist
- [ ] ABS selection flows through the library modal and returns to the composer summary row
- [ ] Confirmation modal shows concise summary rows and adds a job to the queue
- [ ] Queue rail keeps active jobs readable and finished jobs de-emphasized
- [ ] Local-only flow still works when ABS settings are empty
- [ ] Saving a new default model affects the next fresh draft, not the one currently being edited

- [ ] **Step 7: Commit the polish and cleanup**

```bash
git add -A src/renderer/src/components/AppSettingsPanel.tsx src/renderer/src/components/AbsLibraryModal.tsx src/renderer/src/assets/main.css src/renderer/src/components/__tests__/AppSettingsPanel.test.tsx src/renderer/src/pages/SourcePage.tsx src/renderer/src/pages/SettingsPage.tsx
git commit -m "feat: polish ui cleanup surfaces and remove old wizard pages"
```

---

## Execution Notes

- Keep all queue IPC and ABS transport logic in place; this is a renderer cleanup, not a backend rewrite.
- If a component starts to absorb both UI and domain logic, move the logic into `jobDraft.ts` or another small pure helper before continuing.
- Prefer deleting the old page files only after the new shell compiles and is wired.
- If Testing Library setup becomes noisy, stop and extract reusable render helpers into `src/renderer/src/test/setup.ts` rather than duplicating mocks across test files.

## Verification Summary

Before calling the work complete, the implementation must have evidence for:
- `npx vitest run`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- manual `npm run dev` verification of both local and ABS flows
