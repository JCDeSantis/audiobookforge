import { writeFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vbf-'))
}

export async function createConcatListFile(
  filePaths: string[],
  tempDir: string
): Promise<string> {
  const listPath = join(tempDir, 'concat_list.txt')
  // ffmpeg concat demuxer requires forward slashes and escaped single quotes
  const content = filePaths
    .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n')
  await writeFile(listPath, content, 'utf-8')
  return listPath
}

export function cleanupTempDir(tempDir: string): void {
  rm(tempDir, { recursive: true, force: true }).catch(() => {})
}
