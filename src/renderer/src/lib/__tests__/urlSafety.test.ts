import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, validateAbsUrl } from '../../../../shared/urlSafety'

describe('urlSafety', () => {
  it('accepts secure remote ABS URLs and normalizes trailing slashes', () => {
    expect(validateAbsUrl('https://abs.example.com/')).toEqual({
      ok: true,
      normalizedUrl: 'https://abs.example.com'
    })
  })

  it('allows insecure ABS URLs on local or private-network hosts', () => {
    expect(validateAbsUrl('http://192.168.1.50:13378')).toEqual({
      ok: true,
      normalizedUrl: 'http://192.168.1.50:13378'
    })
    expect(validateAbsUrl('http://abs.local')).toEqual({
      ok: true,
      normalizedUrl: 'http://abs.local'
    })
  })

  it('rejects insecure remote ABS URLs and unsafe external links', () => {
    expect(validateAbsUrl('http://example.com')).toEqual({
      ok: false,
      error:
        'Use HTTPS for remote AudioBookShelf servers. HTTP is only allowed on local or private-network hosts.'
    })
    expect(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false)
  })
})
