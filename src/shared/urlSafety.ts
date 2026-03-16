function isPrivateIpv4(hostname: string): boolean {
  return (
    /^10\./.test(hostname) ||
    /^127\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  )
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  )
}

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    (!normalized.includes('.') && !normalized.includes(':')) ||
    isPrivateIpv4(normalized) ||
    isPrivateIpv6(normalized)
  )
}

export function normalizeAbsUrl(input: string): string {
  return input.trim().replace(/\/+$/, '')
}

export function validateAbsUrl(
  input: string
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  const normalizedInput = normalizeAbsUrl(input)

  if (!normalizedInput) {
    return { ok: false, error: 'Enter your AudioBookShelf server URL.' }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(normalizedInput)
  } catch {
    return { ok: false, error: 'Enter a valid AudioBookShelf URL.' }
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'AudioBookShelf URLs must use http or https.' }
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: 'Embed credentials in the API key field, not in the server URL.' }
  }

  if (parsedUrl.search || parsedUrl.hash) {
    return { ok: false, error: 'Remove query strings or fragments from the AudioBookShelf URL.' }
  }

  if (parsedUrl.protocol === 'http:' && !isPrivateHostname(parsedUrl.hostname)) {
    return {
      ok: false,
      error: 'Use HTTPS for remote AudioBookShelf servers. HTTP is only allowed on local or private-network hosts.'
    }
  }

  return { ok: true, normalizedUrl: normalizeAbsUrl(parsedUrl.toString()) }
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol === 'https:') {
      return true
    }

    return parsedUrl.protocol === 'http:' && isPrivateHostname(parsedUrl.hostname)
  } catch {
    return false
  }
}

export function isSameUrlOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin
  } catch {
    return false
  }
}
