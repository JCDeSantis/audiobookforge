export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly maxAttempts = 8
  ) {}

  allow(key: string): boolean {
    const cutoff = this.now() - this.windowMs
    const recent = (this.attempts.get(key) ?? []).filter((time) => time > cutoff)
    this.attempts.set(key, recent)
    return recent.length < this.maxAttempts
  }

  recordFailure(key: string): void {
    const attempts = this.attempts.get(key) ?? []
    attempts.push(this.now())
    this.attempts.set(key, attempts)
  }

  clear(key: string): void {
    this.attempts.delete(key)
  }
}
