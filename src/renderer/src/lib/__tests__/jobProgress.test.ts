import { describe, expect, it } from 'vitest'
import { createJobProgressPlan, mapOverallProgressEvent } from '../../../../shared/jobProgress'

describe('job progress mapping', () => {
  it('maps progress across the whole local job when downloads are already ready', () => {
    const plan = createJobProgressPlan({
      needsBinary: false,
      needsModel: false,
      needsUpload: false
    })

    const preparing = mapOverallProgressEvent(plan, {
      jobId: 'job-1',
      phase: 'preparing',
      percent: 100
    })
    const segmenting = mapOverallProgressEvent(plan, {
      jobId: 'job-1',
      phase: 'segmenting',
      percent: 100
    })
    const transcribing = mapOverallProgressEvent(plan, {
      jobId: 'job-1',
      phase: 'transcribing',
      percent: 50
    })

    expect(preparing.percent).toBe(100)
    expect(preparing.overallPercent).toBe(13)
    expect(segmenting.percent).toBe(100)
    expect(segmenting.overallPercent).toBe(19)
    expect(transcribing.percent).toBe(50)
    expect(transcribing.overallPercent).toBe(59)
  })

  it('leaves room for upload progress on ABS jobs', () => {
    const plan = createJobProgressPlan({
      needsBinary: false,
      needsModel: false,
      needsUpload: true
    })

    const transcribing = mapOverallProgressEvent(plan, {
      jobId: 'job-1',
      phase: 'transcribing',
      percent: 100
    })
    const uploading = mapOverallProgressEvent(plan, {
      jobId: 'job-1',
      phase: 'uploading',
      percent: 50
    })

    expect(transcribing.percent).toBe(100)
    expect(transcribing.overallPercent).toBe(94)
    expect(uploading.percent).toBe(50)
    expect(uploading.overallPercent).toBe(97)
  })
})
