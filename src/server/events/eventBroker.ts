import type { ServerResponse } from 'http'

export interface ServerEvent {
  id: number
  type: string
  data: unknown
}

export class EventBroker {
  private revision = 0
  private readonly history: ServerEvent[] = []
  private readonly clients = new Set<ServerResponse>()

  publish(type: string, data: unknown): ServerEvent {
    const event = { id: ++this.revision, type, data }
    this.history.push(event)
    if (this.history.length > 200) this.history.shift()
    for (const response of this.clients) this.write(response, event)
    return event
  }

  subscribe(response: ServerResponse, lastEventId: number, snapshot: unknown): () => void {
    this.clients.add(response)
    const missed = this.history.filter((event) => event.id > lastEventId)
    const gap = lastEventId > 0 && missed.length > 0 && missed[0].id !== lastEventId + 1
    if (lastEventId === 0 || gap || lastEventId > this.revision) {
      this.write(response, { id: this.revision, type: 'snapshot', data: snapshot })
    } else {
      for (const event of missed) this.write(response, event)
    }
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
    heartbeat.unref?.()
    return () => {
      clearInterval(heartbeat)
      this.clients.delete(response)
    }
  }

  private write(response: ServerResponse, event: ServerEvent): void {
    response.write(`id: ${event.id}\n`)
    response.write(`event: ${event.type}\n`)
    response.write(`data: ${JSON.stringify(event.data)}\n\n`)
  }
}
