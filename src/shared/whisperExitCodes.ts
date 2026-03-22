export const WINDOWS_MISSING_DEPENDENCY_EXIT_CODE = 3221225781

export function isMissingWindowsDependencyExitCode(
  code: number | null | undefined
): boolean {
  return code === WINDOWS_MISSING_DEPENDENCY_EXIT_CODE
}
