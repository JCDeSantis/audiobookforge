import { describe, expect, it } from 'vitest'
import {
  WINDOWS_MISSING_DEPENDENCY_EXIT_CODE,
  isMissingWindowsDependencyExitCode
} from '../../../../shared/whisperExitCodes'

describe('whisper exit codes', () => {
  it('treats 0xC0000135 as a missing dependency failure', () => {
    expect(isMissingWindowsDependencyExitCode(WINDOWS_MISSING_DEPENDENCY_EXIT_CODE)).toBe(true)
  })

  it('ignores normal process exit codes', () => {
    expect(isMissingWindowsDependencyExitCode(0)).toBe(false)
    expect(isMissingWindowsDependencyExitCode(1)).toBe(false)
    expect(isMissingWindowsDependencyExitCode(null)).toBe(false)
  })
})
