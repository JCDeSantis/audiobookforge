import { describe, expect, it } from 'vitest'
import { createQualityReport } from '../quality'

describe('createQualityReport', () => {
  it('summarizes clean subtitle coverage', () => {
    const report = createQualityReport(
      [
        { startSec: 0, endSec: 4, text: 'First line' },
        { startSec: 5, endSec: 9, text: 'Second line' }
      ],
      10
    )

    expect(report.cueCount).toBe(2)
    expect(report.coveragePercent).toBe(80)
    expect(report.issueCount).toBe(0)
  })

  it('flags large gaps and repeated text', () => {
    const report = createQualityReport(
      [
        { startSec: 0, endSec: 3, text: 'Same line' },
        { startSec: 20, endSec: 23, text: 'Same line' }
      ],
      60
    )

    expect(report.issues.some((issue) => issue.code === 'large-gap')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'repeated-text')).toBe(true)
  })
})
