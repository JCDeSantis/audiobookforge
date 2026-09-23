export default async function globalTeardown(): Promise<void> {
  await fetch('http://127.0.0.1:4173/__shutdown__').catch(() => undefined)
}
