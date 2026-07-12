import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

interface SessionPayload {
  id: string
  csrf: string
  expiresAt: number
}

export interface VerifiedSession extends SessionPayload {}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf-8')
}

export function loadOrCreateSessionSecret(filePath: string): Buffer {
  if (existsSync(filePath)) {
    const secret = readFileSync(filePath)
    if (secret.length < 32) throw new Error('The session secret must contain at least 32 bytes.')
    return secret
  }

  mkdirSync(dirname(filePath), { recursive: true })
  const secret = randomBytes(48)
  writeFileSync(filePath, secret, { flag: 'wx', mode: 0o600 })
  return secret
}

export class SessionManager {
  private readonly revoked = new Map<string, number>()

  constructor(
    private readonly secret: Buffer,
    private readonly now: () => number = Date.now,
    private readonly lifetimeMs = 24 * 60 * 60 * 1000
  ) {}

  issue(): { token: string; session: VerifiedSession } {
    const session: VerifiedSession = {
      id: randomUUID(),
      csrf: randomBytes(24).toString('base64url'),
      expiresAt: this.now() + this.lifetimeMs
    }
    const body = encode(JSON.stringify(session))
    return { token: `${body}.${this.sign(body)}`, session }
  }

  verify(token: string | undefined): VerifiedSession | null {
    if (!token) return null
    const [body, signature, extra] = token.split('.')
    if (!body || !signature || extra) return null
    const expected = Buffer.from(this.sign(body))
    const actual = Buffer.from(signature)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

    try {
      const session = JSON.parse(decode(body)) as Partial<VerifiedSession>
      if (
        typeof session.id !== 'string' ||
        typeof session.csrf !== 'string' ||
        typeof session.expiresAt !== 'number' ||
        session.expiresAt <= this.now() ||
        this.revoked.has(session.id)
      ) {
        return null
      }
      return session as VerifiedSession
    } catch {
      return null
    }
  }

  revoke(session: VerifiedSession): void {
    this.revoked.set(session.id, session.expiresAt)
    const now = this.now()
    for (const [id, expiry] of this.revoked) if (expiry <= now) this.revoked.delete(id)
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url')
  }
}
