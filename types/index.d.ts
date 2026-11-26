export type Watch = {
  phase: 'idle' | 'working'
  startedAt: number
  toolCalls: number
}

/** What the backdrop was last drawn from. Writing it draws the backdrop again. */
export type Stage = {
  at: number
  isWorking: boolean
  lastTurnSeconds: number
  lastTurnTools: number
  turnSeconds: number
  seed: number
  turns: number
  figures: Gauges
  previous: { contextPercent: number | null; usd: number | null }
  cache: Cache
}

/** The main thread's prompt cache: when its last request that read or wrote it started, and for how long it holds. */
export type Cache = {
  at: number | null
  ttl: '5m' | '1h' | null
}

export type Tally = {
  turns: number
  lastTurnSeconds: number
}

export type Gauges = {
  contextPercent: number | null
  limits: { kind: string; percentUsed: number }[]
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'garden-cache-gauge': {
      activity: Watch
      tally: Tally
      gauges: Gauges
      stage: Stage
      cache: Cache
    }
  }
}
