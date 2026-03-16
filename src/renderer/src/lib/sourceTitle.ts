function getPathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]/).filter(Boolean)
}

function stripAudioExtension(fileName: string): string {
  return fileName.replace(/\.(m4b|mp3|m4a|wav|flac|ogg|aac)$/i, '')
}

function getCommonPrefix(values: string[]): string {
  if (values.length === 0) return ''

  let prefix = values[0]
  for (const value of values.slice(1)) {
    let index = 0
    while (
      index < prefix.length &&
      index < value.length &&
      prefix[index].toLowerCase() === value[index].toLowerCase()
    ) {
      index += 1
    }
    prefix = prefix.slice(0, index)
    if (!prefix) break
  }

  return prefix
}

export function getLocalSourceTitle(audioFiles: string[]): string {
  if (audioFiles.length === 0) {
    return ''
  }

  if (audioFiles.length === 1) {
    const fileName = getPathSegments(audioFiles[0]).at(-1) ?? audioFiles[0]
    return stripAudioExtension(fileName)
  }

  const parentNames = audioFiles.map((filePath) => getPathSegments(filePath).at(-2) ?? '')
  const firstParent = parentNames[0]
  if (firstParent && parentNames.every((parentName) => parentName === firstParent)) {
    return firstParent
  }

  const fileNames = audioFiles.map((filePath) =>
    stripAudioExtension(getPathSegments(filePath).at(-1) ?? filePath)
  )
  const commonPrefix = getCommonPrefix(fileNames)
    .replace(/[-_.\s]*\d+$/u, '')
    .replace(/[-_.\s]+$/u, '')
    .trim()

  return commonPrefix || `${audioFiles.length} files`
}
