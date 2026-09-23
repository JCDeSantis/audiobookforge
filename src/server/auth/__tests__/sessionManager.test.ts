import { describe, expect, it } from 'vitest'
import { SessionManager } from '../sessionManager'

describe('web sessions', () => {
  it('signs, verifies, expires, and revokes sessions', () => {
    let now = 1000
    const sessions = new SessionManager(Buffer.alloc(48, 7), () => now, 500)
    const issued = sessions.issue()

    expect(sessions.verify(issued.token)).toEqual(issued.session)
    expect(sessions.verify(`${issued.token}tampered`)).toBeNull()

    sessions.revoke(issued.session)
    expect(sessions.verify(issued.token)).toBeNull()

    const second = sessions.issue()
    now = 1600
    expect(sessions.verify(second.token)).toBeNull()
  })
})
