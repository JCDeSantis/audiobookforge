import { isMissingWindowsDependencyExitCode } from './whisperExitCodes'

export type CudaFallbackReason =
  | 'missing-runtime'
  | 'initialization-failed'
  | 'out-of-memory'
  | 'device-lost'
  | 'execution-failed'

export function classifyCudaFailure(
  exitCode: number | null | undefined,
  stderr: string
): CudaFallbackReason | null {
  if (isMissingWindowsDependencyExitCode(exitCode)) return 'missing-runtime'

  const output = stderr.toLowerCase()
  if (!/(cuda|cublas|cudart|ggml_cuda|gpu)/.test(output)) return null
  if (/(out of memory|memory allocation|cuda_error_out_of_memory)/.test(output)) {
    return 'out-of-memory'
  }
  if (/(device lost|device unavailable|cuda_error_device_unavailable)/.test(output)) {
    return 'device-lost'
  }
  if (/(driver|library|dll|not found|initializ|no cuda-capable device)/.test(output)) {
    return 'initialization-failed'
  }
  if (/(kernel|launch|execution|cublas|cuda error|ggml_cuda)/.test(output)) {
    return 'execution-failed'
  }
  return null
}
