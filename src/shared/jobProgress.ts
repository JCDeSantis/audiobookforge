import type { WhisperProgressEvent, WhisperProgressPhase } from './types'

const STAGE_WEIGHTS: Record<
  Exclude<WhisperProgressPhase, 'done' | 'error'>,
  number
> = {
  'downloading-binary': 5,
  'downloading-model': 10,
  preparing: 10,
  segmenting: 5,
  transcribing: 65,
  uploading: 5
}

export interface JobProgressPlan {
  totalWeight: number
  stageOffsets: Partial<Record<Exclude<WhisperProgressPhase, 'done' | 'error'>, number>>
}

export function createJobProgressPlan({
  needsBinary,
  needsModel,
  needsUpload
}: {
  needsBinary: boolean
  needsModel: boolean
  needsUpload: boolean
}): JobProgressPlan {
  const stages: Array<Exclude<WhisperProgressPhase, 'done' | 'error'>> = []

  if (needsBinary) {
    stages.push('downloading-binary')
  }

  if (needsModel) {
    stages.push('downloading-model')
  }

  stages.push('preparing', 'segmenting', 'transcribing')

  if (needsUpload) {
    stages.push('uploading')
  }

  let offset = 0
  const stageOffsets: JobProgressPlan['stageOffsets'] = {}

  for (const stage of stages) {
    stageOffsets[stage] = offset
    offset += STAGE_WEIGHTS[stage]
  }

  return {
    totalWeight: offset,
    stageOffsets
  }
}

export function mapOverallProgressEvent(
  plan: JobProgressPlan,
  event: WhisperProgressEvent
): WhisperProgressEvent {
  if (event.phase === 'done') {
    return { ...event, percent: 100, overallPercent: 100 }
  }

  if (event.phase === 'error') {
    return event
  }

  const offset = plan.stageOffsets[event.phase] ?? 0
  const weight = STAGE_WEIGHTS[event.phase]
  const phasePercent = Math.max(0, Math.min(event.percent, 100))
  const weightedPercent = Math.round(
    ((offset + (phasePercent / 100) * weight) / plan.totalWeight) * 100
  )

  return {
    ...event,
    overallPercent: Math.min(weightedPercent, 99)
  }
}
