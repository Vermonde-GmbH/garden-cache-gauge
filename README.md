# Garden theme with a cache gauge

A fork of [cktang88/claude-garden-theme](https://github.com/cktang88/claude-garden-theme) (MIT) for the Claude desktop app: cream paper behind the chat, four hand-drawn dials and a garden that grows with the session. The clock dial (bottom right of the four) is replaced by a **cache gauge**.

## The cache gauge

It shows how long the prompt cache, the model's short-term memory of the conversation, still holds.

- Every main-thread request that reads or writes the cache fills the tank. The cache's lifetime counts from when that request was sent: 1 hour or 5 minutes, as the API reports for the write.
- Between turns the needle sinks from F to E like a fuel gauge, and a countdown (mm:ss) runs underneath.
- In the last **5 minutes** the needle enters the red zone, and needle and countdown turn red. With a 5-minute cache the whole scale is red.
- Once the cache has lapsed the dial reads "expired": the next message re-reads the whole context at full price.
- While Claude works the needle rests on F ("refreshing"), because every request renews the cache.

The picture is only redrawn when a turn starts and ends; the needle and the countdown move by CSS animation in between.

## Use it in a project (local and cloud sessions)

Add this to the project's `.claude/settings.json`, with this repository's owner and name:

```json
{
  "extraKnownMarketplaces": {
    "vermonde-garden": {
      "source": { "source": "github", "repo": "OWNER/garden-cache-gauge" }
    }
  },
  "enabledPlugins": {
    "garden-cache-gauge@vermonde-garden": true
  }
}
```

The dials sit at the top left, 320 screen pixels in so the app's sidebar stays clear (`SIDEBAR_ROOM` in `hooks/scene.ts`). In a cloud session the app draws no backdrop: `/cache` opens the gauge in a pane instead.

## Commands

`/garden` turns the theme on, `/garden off` clears it for the session. `/cache` opens the gauge alone in a pane, for windows that draw no theme.

## Credits

Garden, dials and scene by cktang88 (MIT, see LICENSE). `hooks/make-colors.js` is the colour helper from Claude Code's plugin-authoring skill.
