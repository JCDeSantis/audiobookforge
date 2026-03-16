# AudioBook Forge UI Cleanup Design
**Date:** 2026-03-15
**Status:** Approved

---

## Overview

This spec defines a focused UI cleanup pass for AudioBook Forge. The goal is not to redesign the app into a new product, but to keep the existing desktop structure and make it feel simpler, clearer, and easier to scan for an end user.

The current app already has the right core pieces:
- a left-side job setup flow
- a right-side queue/status area
- AudioBookShelf browsing and app settings modals

The cleanup pass should reduce unnecessary step changes, move settings into a more natural location, and improve readability across the black-and-red visual style.

---

## Product Goals

### Primary goals
- Reduce the setup flow from a 3-step wizard to a lighter 2-step experience
- Make the main job creation flow feel direct and uncluttered
- Move ABS connection and default configuration into a clear settings home
- Preserve the persistent queue visibility without letting it dominate the UI
- Improve text contrast and scanning speed before adding any extra polish

### Non-goals
- No change to the transcription pipeline, queue execution model, or ABS API behavior
- No feature expansion beyond the cleanup pass
- No large architectural rewrite of the Electron app

---

## UX Direction

The app should feel like a focused desktop workspace rather than a step-by-step wizard. The user should be able to open the app, choose a source, verify a few options, and queue a job with minimal navigation.

The chosen shell direction is:
- **Left:** a single setup workspace for building a new transcription job
- **Right:** a slimmer queue rail that remains visible at all times
- **Top/header action:** a clear `Settings` entry point
- **Confirmation:** a short modal review step instead of a dedicated full page

This keeps the app alive and informative while removing the feeling of paging through setup screens.

---

## Information Architecture

### App shell
The main window remains a two-column layout:
- **Composer workspace:** primary area for source selection and job options
- **Queue rail:** secondary area for running, queued, and finished jobs

The queue rail should be visually quieter than it is today. It remains persistent, but the composer is the dominant surface.

### Header
Add a small app-level header above the composer/queue layout with:
- app title or compact brand label
- `Settings` button
- optional lightweight queue count indicator if helpful

The header should replace the current pattern where settings are hidden at the bottom of the queue panel.

### Navigation model
The user flow becomes:
1. Select source and options in the composer workspace
2. Open a short confirmation modal
3. Add to queue and return to a reset composer

There should be no separate full-page `Settings` step and no separate full-page `Review` step.

---

## Main Composer Workspace

### Intent
The composer should combine the current `SourcePage` and `SettingsPage` into one calm, readable setup surface.

### Layout
The composer should be organized as a small stack of cards/sections:
- headline area
- source selection card
- processing options card
- primary action row

Each section should be visually grouped, with fewer borders and less dense micro-text than the current UI.

### Headline area
At the top of the composer:
- title such as `New Transcription`
- one short sentence explaining the flow

This replaces the current step indicator as the main orientation device.

### Source selection card
The first card should present the two source paths clearly:
- local audio files
- AudioBookShelf library

Requirements:
- local drag/drop and file picking remain supported
- ABS opens the existing library modal
- once a source is selected, the card should collapse into a compact summary row
- the summary row should show the selected book/title and provide a clear `Change` action

This keeps the screen tidy after a selection is made.

### Processing options card
The second card contains only the settings that matter for the chosen source.

Requirements:
- whisper model is always visible
- model defaults from app settings
- output folder appears only for local jobs
- EPUB row is optional and conditional:
  - ABS item with linked ebook: show the linked EPUB clearly as read-only context
  - local source or ABS without linked ebook: allow optional manual EPUB selection

The options card should avoid long explanatory copy. Helper text should only appear where it resolves confusion.

### Primary action row
The composer ends with a single primary action:
- `Continue`

The button opens the confirmation modal instead of changing pages.

Validation rules:
- local jobs require at least one audio file
- local jobs require an output folder before continuing
- ABS jobs require a selected ABS item
- EPUB must remain optional

### Source switching rules
Because the composer now holds the full setup flow in one surface, source-specific state must reset predictably.

Requirements:
- switching from local to ABS clears local audio file selection and local-only output folder dependency
- switching from ABS to local clears the selected ABS item
- manual EPUB selection should remain editable, but an ABS-linked EPUB should take precedence when an ABS item provides one
- the currently selected whisper model should remain unchanged while the user is editing the same draft job
- saving a new default model in app settings should apply to the next fresh composer state, not silently overwrite an in-progress draft

---

## Confirmation Modal

### Intent
The current `TranscribePage` becomes a short confirmation modal instead of a dedicated screen.

### Content
The modal should present a concise review of the pending job:
- title
- source
- whisper model
- output behavior
- EPUB status

The modal should not reintroduce a long form. It is a checkpoint, not another workspace.

### Actions
The footer should provide:
- `Back` to close the modal and return to the composer
- `Add to Queue` to submit the job

After queueing:
- close the modal
- reset the composer
- keep the queue rail visible with the new job added

---

## Settings Location And Scope

### Location
ABS configuration and default behavior move into a dedicated settings entry point in the app header.

### Settings content
The settings panel/modal should contain:
- ABS server URL
- ABS API key
- default whisper model

This is the correct place for values that affect the app globally rather than one specific job.

### Interaction requirements
- local-only users should be able to ignore ABS settings entirely
- if ABS is not configured, the composer should still fully support local jobs
- any ABS entry point should direct the user toward `Settings` when configuration is missing or invalid

The settings surface should feel like app configuration, not queue management.

---

## Queue Rail

### Intent
Keep the queue visible, but reduce noise and improve hierarchy.

### Layout
The queue rail remains on the right side, but should be narrower and calmer than the current version.

Sections:
- active/running jobs
- queued jobs
- finished items

Finished items should be visually de-emphasized and may be collapsed by default if that helps reduce clutter.

### Card behavior
Queue cards should remain compact, but improve legibility:
- larger title text than today
- stronger distinction between title, status, and metadata
- running jobs keep the progress bar and current phase
- failed jobs keep error summary and retry action
- completed jobs keep reveal/upload result messaging

The queue rail should no longer host the main route into settings.

---

## AudioBookShelf Library Modal

The ABS library modal remains part of the flow, but should be visually aligned with the new cleaner shell.

Requirements:
- keep library tabs, search, refresh, and subtitle badges
- preserve selection/loading states
- improve text contrast and spacing
- make the selected-book handoff back to the composer feel immediate and clear

No changes are required to the ABS data-loading behavior for this pass.

---

## Visual System And Readability

### Core principle
Readability takes priority over stylistic intensity.

### Color usage
Keep the black-and-red identity, but rebalance it:
- deep black/charcoal surfaces for the base UI
- warm off-white for primary text
- softer rose/pink for secondary text
- muted neutral-red tones for metadata and borders
- bright red reserved for primary actions, selected states, progress, and destructive/error emphasis

Red should no longer carry most text content. The UI should feel black-first with red accents.

### Typography
The current app uses text that is too small in too many places. This pass should:
- raise the baseline text size for labels and queue content
- make titles and important values more prominent
- reduce dependence on tiny uppercase utility text

Typography should support quick scanning on a desktop monitor at normal viewing distance.

### Spacing and density
The app should feel simpler through spacing, not through hiding important information.

Requirements:
- fewer stacked borders
- clearer separation between major sections
- slightly larger click targets
- reduced use of crowded single-line metadata blocks

---

## State And Component Boundaries

The implementation should preserve existing data flow where possible, but simplify the renderer structure.

### Recommended renderer component boundaries
- `AppShell`
  - owns the header and 2-column layout
- `JobComposer`
  - replaces the current multi-page left-side wizard
- `SourceSelector`
  - local files + ABS entry and selected-source summary
- `JobOptionsCard`
  - model, output folder, and EPUB handling
- `QueueRail`
  - replacement/refinement of the current queue panel
- `QueueConfirmationModal`
  - replacement for the current review page
- `AppSettingsPanel`
  - retained but repositioned and restyled
- `AbsLibraryModal`
  - retained and visually updated

### Store changes
The Zustand store should be simplified to match the new flow.

Expected changes:
- remove the need for a 3-step page model in renderer navigation
- either reduce `wizard.step` to a lighter state model or replace it with modal/open state plus validation state
- keep the existing source, selected ABS item, audio files, model, output folder, and EPUB values
- keep queue and ABS cache behavior unchanged unless needed for UI cleanup

The implementation should prefer minimal store churn over a full state rewrite.

---

## Error Handling And Empty States

### Local flow
- local transcription must work even when ABS is unconfigured
- missing output folder should block `Continue` with a clear inline cue

### ABS flow
- if ABS settings are missing, the ABS entry point should direct the user to settings
- if ABS library loading fails, the modal should show a clear error without breaking the rest of the app

### Confirmation modal
- if required fields somehow become invalid before queueing, the modal should not submit silently

### Queue rail
- empty queue should show a calm placeholder state
- failed jobs should remain understandable without opening extra UI

---

## Implementation Strategy

This cleanup pass should favor incremental renderer refactoring over broad churn.

Recommended sequencing:
1. Introduce the new app shell and header with a relocated settings entry point
2. Merge the current source/settings pages into one composer workspace
3. Replace the full review page with a confirmation modal
4. Refine the queue panel into a slimmer queue rail
5. Restyle settings and ABS modals to match the new visual system
6. Apply final readability and spacing polish across shared primitives

This order keeps the app functional through each stage while reducing risk.

---

## Testing Focus

### Functional coverage
- local flow: choose files, set output folder, confirm, queue
- ABS flow: open library modal, select book, confirm, queue
- settings flow: open settings, save ABS values, save default model
- conditional fields: local output folder visibility, ABS-linked EPUB visibility, optional EPUB behavior
- confirmation modal open/close/submit behavior
- queue reset after successful submission

### Visual/UX coverage
- readable text contrast on composer, queue rail, and modals
- selected source summary collapse behavior
- queue rail remains usable at the reduced width
- settings is discoverable from the header
- no unnecessary full-page navigation remains in the setup flow

---

## Out Of Scope

- queue execution changes
- queue reordering or new queue capabilities
- new ABS features
- new transcription settings beyond default model placement
- redesign of backend IPC contracts

---

## Success Criteria

The cleanup pass is successful if:
- a user can prepare a job with fewer screen changes than today
- settings are easier to find and clearly separate from active job setup
- the queue remains visible without overwhelming the interface
- the black-and-red theme feels cleaner and more readable
- the app feels simpler without losing the functionality already in place
