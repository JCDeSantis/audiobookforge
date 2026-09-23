import Epub from 'epub2'

export async function extractEpubVocabulary(epubPath: string): Promise<string> {
  try {
    const epub = await Epub.createAsync(epubPath)
    const chapters = await Promise.all(epub.flow.map((chapter) => epub.getChapterAsync(chapter.id)))
    const text = chapters.join(' ').replace(/<[^>]+>/g, ' ')
    const words = new Set<string>()
    for (const match of text.matchAll(/\b([A-Z][a-zA-Z]{5,})\b/g)) {
      words.add(match[1])
      if (words.size >= 150) break
    }
    return Array.from(words).join(', ')
  } catch {
    return ''
  }
}
