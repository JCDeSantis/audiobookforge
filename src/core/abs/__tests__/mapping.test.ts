import { describe, expect, it } from 'vitest'
import { mapAbsItemToBook } from '../mapping'

describe('Audiobookshelf series metadata', () => {
  it('preserves series order, decimal positions, and zero without guessing missing positions', () => {
    const book = mapAbsItemToBook(
      {
        id: 'book',
        media: {
          metadata: {
            series: [
              { name: '  Main Series  ', sequence: '12.5' },
              { name: 'Prequels', sequence: 0 },
              { name: 'Collection', sequence: null },
              { name: 'Unnumbered', sequence: ' ' },
              { name: '  ', sequence: '3' }
            ]
          }
        }
      },
      'https://abs.example.com'
    )
    expect(book.series).toEqual([
      { name: 'Main Series', sequence: '12.5' },
      { name: 'Prequels', sequence: '0' },
      { name: 'Collection', sequence: null },
      { name: 'Unnumbered', sequence: null }
    ])
  })

  it('leaves standalone books without series metadata', () => {
    expect(mapAbsItemToBook({ id: 'book' }, 'https://abs.example.com').series).toEqual([])
    expect(
      mapAbsItemToBook(
        { id: 'book', media: { metadata: { series: null } } },
        'https://abs.example.com'
      ).series
    ).toEqual([])
  })
})
