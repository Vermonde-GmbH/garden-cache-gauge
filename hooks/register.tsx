// Garden theme with a cache gauge: a sheet of warm paper behind the chat with four pencil-sketched dials and a garden
// that grows over the session, and a matching light color theme. Based on cktang88/claude-garden-theme (MIT); the
// clock dial is replaced by a fuel gauge for the prompt cache, which falls as the cache ages and turns red for its last
// five minutes. The backdrop is drawn again only when a turn starts and when it
// ends: the app shows a redraw as a brief flash of the whole picture, so nothing is redrawn while a turn runs.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, TurnUsage } from 'claude-code'

import type { Cache, Gauges, Stage, Tally, Watch } from '../types'
import { makeColors } from './make-colors.js'
import { sceneSvg } from './scene'
import { cacheGaugeSvg } from './scene/instruments'

const COMMAND = 'garden'
const PANE_COMMAND = 'cache'
const PANE = 'cache-gauge'

const GAUGES = { plugin: 'garden-cache-gauge', key: 'gauges' } as const
const ACTIVITY = { plugin: 'garden-cache-gauge', key: 'activity' } as const
const TALLY = { plugin: 'garden-cache-gauge', key: 'tally' } as const
const CACHE = { plugin: 'garden-cache-gauge', key: 'cache' } as const
const NO_CACHE: Cache = { at: null, ttl: null }
const TTL_SECONDS = { '5m': 300, '1h': 3600 } as const

const watch = atom({ plugin: 'garden-cache-gauge', key: 'activity' } as const, { phase: 'idle', startedAt: 0, toolCalls: 0 } as Watch)
const tally = atom({ plugin: 'garden-cache-gauge', key: 'tally' } as const, { turns: 0, lastTurnSeconds: 0 } as Tally)

const { theme, problems } = makeColors({
  label: 'Garden',
  only: 'light',
  roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#efe6d3',
        'surface-1': '#f4ecdc',
        'surface-2': '#faf5e9',
        'text-primary': '#2a241d',
        'text-secondary': '#544a3d',
        'text-muted': '#6a5f50',
      },
    },
  },
})


const SCENE = 'garden'
const STAGE = { plugin: 'garden-cache-gauge', key: 'stage' } as const
const NO_FIGURES: Gauges = { contextPercent: null, limits: [], usd: null }
const NOTHING_BEFORE = { contextPercent: null, usd: null }
const EMPTY_STAGE: Stage = { at: 0, isWorking: false, lastTurnSeconds: 0, lastTurnTools: 0, turnSeconds: 0, seed: 0, turns: 0, figures: NO_FIGURES, previous: NOTHING_BEFORE, cache: NO_CACHE }

// The scene's name goes under `id` as well as `scene`, as the theme-examples plugin sets its own.
// The window's kind is not named: the colors hold only a light half, which makes the window light by itself.
const LOOK = {
  colors: theme,
  backdrop: { scene: SCENE, id: SCENE, glass: { blur: 4, tint: '#f6f1e6', opacity: 0.6 } },
} as unknown as ThemeSetArgs

/**
 * What the backdrop draws from, kept here so the backdrop hook can answer at once. THE HOOK MUST NOT BE ASYNC:
 * the desktop app shows a backdrop answered a moment late as a still picture, with every animation stopped.
 */
let latest: Stage = EMPTY_STAGE
let built: { from: Stage; source: string } | undefined

function sceneOf(stage: Stage) {
  const ttl = TTL_SECONDS[stage.cache.ttl ?? '5m']
  const cacheLeft = stage.cache.at === null ? null : Math.max(0, ttl - (stage.at - stage.cache.at) / 1000)
  return { now: stage.at / 1000, cacheLeft, cacheTtl: ttl, lastTurnSeconds: stage.lastTurnSeconds, turnSeconds: stage.turnSeconds, phase: stage.isWorking ? 'engaged' : 'standby', total: stage.isWorking ? 0 : stage.lastTurnTools, seed: stage.seed, turns: stage.turns } as const
}

function backdropSource(): string {
  if (built?.from !== latest) {
    built = { from: latest, source: sceneSvg(sceneOf(latest), latest.figures, latest.previous) }
  }

  return built.source
}

let paneBuilt: { from: Stage; source: string } | undefined

function paneSource(): string {
  if (paneBuilt?.from !== latest) {
    paneBuilt = { from: latest, source: cacheGaugeSvg(sceneOf(latest)) }
  }

  return paneBuilt.source
}

async function show($: EngineInterface): Promise<string> {
  const unpainted = problems.find(problem => problem.startsWith("Desktop won't paint"))

  if (unpainted !== undefined) {
    return unpainted
  }

  const set = await $.theme.set(LOOK)

  return set.isDrawn ? 'The garden theme is on.' : `The garden theme is set, but this window does not draw it: ${set.reason}`
}

/** Asks for the backdrop to be drawn again, from the figures as they are now. */
async function redraw($: EngineInterface, isWorking: boolean, lastTurn?: { seconds: number; tools: number }): Promise<void> {
  const { value: was } = await $.state.get(STAGE)
  const { value: figures = NO_FIGURES } = await $.state.get(GAUGES)
  const { value: activity } = await $.state.get(ACTIVITY)
  const { value: counts } = await $.state.get(TALLY)
  const { value: cache = NO_CACHE } = await $.state.get(CACHE)
  const now = await $.clock.now()

  // The backdrop draws from this snapshot alone. It is also kept in the session's state, so the last turn's
  // figures survive a reload of the mod.
  latest = {
    at: now,
    isWorking,
    lastTurnSeconds: lastTurn?.seconds ?? was?.lastTurnSeconds ?? 0,
    lastTurnTools: lastTurn?.tools ?? was?.lastTurnTools ?? 0,
    turnSeconds: isWorking && activity ? Math.max(0, (now - activity.startedAt) / 1000) : 0,
    seed: was?.seed || Math.floor(now % 100_000) + 1,
    turns: counts?.turns ?? 0,
    figures,
    previous: { contextPercent: was?.figures?.contextPercent ?? null, usd: was?.figures?.usd ?? null },
    cache,
  }
  await $.state.set(STAGE, latest)
  $.ui.invalidate('ui.render')
}

/**
 * Notes a main-thread request that read or wrote the prompt cache. Its lifetime counts from when the request was sent.
 * A write names its lifetime (the shorter, where it wrote both); a request that only read keeps the last one known.
 */
async function noteRequest($: EngineInterface, sentAt: number, usage: TurnUsage | null): Promise<void> {
  if (usage === null) return
  const wrote = usage.cache_creation_input_tokens > 0
  const read = usage.cache_read_input_tokens > 0
  if (!wrote && !read) return

  const { value: was = NO_CACHE } = await $.state.get(CACHE)
  let ttl = was.ttl
  if (wrote) {
    const fiveMinutes = usage.ephemeral_5m_input_tokens ?? 0
    const oneHour = usage.ephemeral_1h_input_tokens ?? 0
    ttl = oneHour > 0 && fiveMinutes === 0 ? '1h' : '5m'
  }
  await $.state.set(CACHE, { at: sentAt, ttl: ttl ?? '5m' })
}

async function readGauges($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()

  await $.state.set(GAUGES, {
    contextPercent: usage.context.percent ?? null,
    limits: usage.rateLimits.map(limit => ({ kind: limit.kind, percentUsed: Math.round(limit.percentUsed) })),
    usd: usage.cost?.usd ?? null,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.command.register({
      name: PANE_COMMAND,
      description: 'Cache gauge: opens a pane showing how long the prompt cache still holds.',
    })
    await $.command.register({
      name: COMMAND,
      description: 'Garden theme: alone it turns the theme on; "off" clears it.',
    })
    await readGauges($)
    // After a reload in the middle of a turn, the picture carries on as a working one.
    await redraw($, (await $.state.get(ACTIVITY)).value?.phase === 'working')

    // Not drawn yet is normal here: the window attaches later, and `session.attach` sets the theme again.
    await show($)
    // The pane draws where a theme does not (a cloud session in the app, say).
    void $.ui.open({ id: PANE, title: 'Cache' })

    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()

      await update($, watch, () => ({ phase: 'working', startedAt: now, toolCalls: 0 }))
      await readGauges($)
      await redraw($, true)
    }

    return next(e)
  })

  // Each main-thread request renews the prompt cache. A fault here must never get in the way of the request.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    const sentAt = await $.clock.now()
    const result = yield* next(e)

    await noteRequest($, sentAt, result.usage).catch(() => undefined)

    return result
  })

  // A fault in the theme must never get in the way of a tool call: if the count fails, the call goes on.
  on('tool.call', async ($, e, next) => {
    await update($, watch, was => ({ ...was, toolCalls: was.toolCalls + 1 }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      const was = await read($, watch)

      await update($, watch, () => ({ phase: 'idle', startedAt: 0, toolCalls: was.toolCalls }))
      await update($, tally, old => ({ turns: old.turns + 1, lastTurnSeconds: Math.round((now - was.startedAt) / 1000) }))
      await readGauges($)
      await redraw($, false, { seconds: Math.round((now - was.startedAt) / 1000), tools: was.toolCalls })
    }

    return next(e)
  })

  // A new session starts before its window attaches, and the theme set then is not drawn. Set it again on attach.
  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    const result = await next(e)
    await show($).catch(() => undefined)
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'off') {
      await $.theme.clear()

      return { text: 'The garden theme is off for this session. /garden turns it on again.' }
    }

    return { text: await show($) }
  }).catch(() => ({ text: 'The garden theme hit an error. Run /garden again.' }))

  on('command.run', { command: PANE_COMMAND }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Cache' })

    return { text: opened.isPlaced ? 'Cache gauge opened.' : 'Cache gauge opened; no window draws it right now.' }
  }).catch(() => ({ text: 'The cache gauge hit an error. Run /cache again.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    if (e.surface === 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text>Cache gauge: open this session in the app to see it.</Text>
    }

    const { Box, Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" alignItems="center">
        <Svg isInteractive width={220} height={220} alt="A pencil-drawn fuel gauge showing how long the prompt cache still holds; red in its last five minutes" source={paneSource()} />
      </Box>
    )
  })

  // Not async, on purpose: see `latest`. It answers at once from the snapshot `redraw` keeps.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.props.scene !== SCENE || e.surface !== 'desktop') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg isInteractive alt="A sheet of warm paper with four pencil-sketched dials at the top right, one of them a fuel gauge for the prompt cache, a paper plane crossing the top, a tree at the right edge and a pencil garden in each bottom corner" source={backdropSource()} />
  })
}
