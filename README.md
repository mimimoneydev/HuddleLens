# HuddleLens for Fire TV

[Open-source motion library](https://github.com/mimimoneydev/huddlelens-motion) · [MIT License](LICENSE)

HuddleLens is a production-oriented live-sports co-viewing system for Fire TV. It combines a licensed live video source, real-time match events, provider-resilient AI explanations, accessibility controls, and privacy-first family movement challenges in a remote-first ten-foot interface.

The primary AI runtime is **Amazon Bedrock** using **Amazon Nova 2 Lite** (`global.amazon.nova-2-lite-v1:0`). In automatic mode, HuddleLens fails over to **OpenRouter**, whose default model is DeepSeek V4.1 Flash 1017 (`deepseek/deepseek-v4.1-flash-1017`). Viewers can also lock either provider in Settings.

## Project Testing Link

Test the hosted project at [https://huddleLens.jagantara.xyz](https://huddleLens.jagantara.xyz).

## Testing instructions or credentials

No account or credentials are required. For the best experience, open the link in the Fire TV simulator and use the following controls:

- **Arrow keys / D-pad:** Move focus
- **Enter / Select:** Activate the focused control
- **Escape / Backspace / Back:** Return to the previous screen

Suggested judge flow:

1. Select **Watch live**, choose a match event, and select **Explain this** to generate an AI Lens explanation.
2. On the replay screen, select **Play the movement** and switch between Rookie, Fan, and Coach detail levels.
3. Open **Move Break**, start the challenge, and alternate Left and Right until the challenge is complete. Camera access is optional; if enabled, frames are processed only on the device and are never uploaded or stored.
4. Open **Access** to test smart captions, spatial audio cues, calm commentary, and high-contrast play.
5. Open **Settings** to inspect the Amazon Bedrock-first AI routing and provider health information.

## What is implemented

- Server-side Amazon Bedrock Converse integration through the official AWS SDK and standard AWS credential chain.
- Automatic Bedrock → OpenRouter failover with per-attempt telemetry and deterministic local resilience.
- Server-side OpenRouter proxy; the API key is never delivered to the television.
- Live OpenRouter model catalog with prices normalized to dollars per million tokens.
- Structured, event-grounded AI explanations at Rookie, Fan, and Coach depth.
- Explanation caching, request timeouts, rate limiting, validation, and local resilience fallback.
- Server-Sent Events for live match updates.
- API-Football and generic licensed-feed adapters, plus a deterministic simulator provider.
- Licensed HLS/MP4 video configuration with an event visualization fallback.
- Live score, timeline, event rail, impact ranking, and selectable match moments.
- Real on-device camera motion detection using downscaled frames; no frames are stored or uploaded.
- Camera-free Fire TV remote scoring fallback.
- Persistent provider routing, per-provider model, explanation-depth, and accessibility preferences.
- Smart captions, spatial event tones, reduced commentary volume, and high-contrast presentation.
- React Native/Vega WebView package with optional camera privilege and emulator API configuration.

## Architecture

```text
Licensed video URL ───────────────────────────────→ Fire TV video surface

Sports provider → server adapter → normalized match/events → SSE → TV UI
                                      │
                                      └→ AI router → Amazon Bedrock / Nova 2 Lite
                                                   └→ OpenRouter failover
                                                   └→ deterministic local fallback

Bedrock model config + OpenRouter live catalog → price normalization → TV Settings

Camera → 96×54 in-memory motion frames → direction/repetition score
              (no frame persistence or network transfer)
```

The server is required in production. It protects provider credentials, normalizes feeds, applies timeouts and rate limits, and prevents untrusted clients from calling Bedrock or OpenRouter directly.

## Run the simulator-safe system

Requires Node.js 20 or newer.

```bash
cp .env.example .env
npm run check
npm run dev
```

Node does not automatically load `.env` in this project. Export the required values in your shell or deployment platform before starting the server. Without credentials, the event provider runs in deterministic simulator mode and explanations use the event-grounded local fallback.

Open `http://localhost:4173` at a 16:9 viewport. Controls:

- Arrow keys: move focus
- Enter: select
- Escape or Backspace: Fire TV Back
- Move Break: alternate Left and Right, or enable the camera

## Production configuration

Copy [`.env.example`](.env.example) into the secret/configuration system used by the deployment platform.

### Amazon Bedrock (primary)

Set `AWS_REGION` and grant the workload role `bedrock:InvokeModel` for the Nova 2 Lite global inference profile. The server uses the standard AWS SDK credential chain, so production deployments should use an IAM role rather than static credentials. The default model can be overridden with `BEDROCK_DEFAULT_MODEL`.

Set both `BEDROCK_GUARDRAIL_ID` and `BEDROCK_GUARDRAIL_VERSION` to apply an existing Amazon Bedrock Guardrail. Optional display-only price values can be supplied per million tokens because AWS pricing varies by region and usage tier. See [docs/AWS_BEDROCK.md](docs/AWS_BEDROCK.md) for setup and validation.

### OpenRouter (alternative)

Set `OPENROUTER_API_KEY`. The default model is `deepseek/deepseek-v4.1-flash-1017`; override it with `OPENROUTER_DEFAULT_MODEL`. The server calls `/api/v1/models` for the current catalog and `/api/v1/chat/completions` for structured explanations.

Model prices can change. HuddleLens reads OpenRouter's per-token `prompt` and `completion` prices and presents them per million tokens. The catalog is cached for 15 minutes. Set `AI_PROVIDER=auto` for Bedrock-first failover, or `bedrock`/`openrouter` to enforce a server default; viewers can make the same choice in Settings.

### Live sports events

Choose one adapter:

1. `SPORTS_PROVIDER=api-football`, then set `API_FOOTBALL_KEY` and the live `API_FOOTBALL_FIXTURE_ID`.
2. `SPORTS_PROVIDER=generic`, then set `SPORTS_FEED_URL` and optionally `SPORTS_FEED_KEY`.
3. `SPORTS_PROVIDER=mock` for local demos and automated tests.

The generic endpoint must return:

```json
{
  "match": {
    "id": "fixture-123",
    "sport": "football",
    "league": "League name",
    "home": "Home team",
    "away": "Away team",
    "homeScore": 1,
    "awayScore": 0,
    "minute": 44,
    "status": "LIVE"
  },
  "events": [
    {
      "id": "event-1",
      "minute": 44,
      "team": "Home team",
      "player": "Player name",
      "type": "Goal",
      "detail": "Header",
      "comments": "Provider-supplied factual context",
      "x": 82,
      "y": 43
    }
  ]
}
```

### Licensed video

Set `LICENSED_STREAM_URL` to a stream the operator is legally entitled to distribute. HuddleLens does not bundle or proxy copyrighted match footage. The URL must be playable by the target Fire TV WebView and its origin must permit playback. When no stream is configured or playback fails, the live event visualization remains functional.

## Fire TV / Vega packaging

Build the browser assets and copy them into the Vega wrapper:

```bash
HUDDLELENS_API_BASE_URL=http://10.0.2.2:4173 npm run build
cd fire-tv-vega
npm test
npm run build:debug
```

For a physical device, replace `10.0.2.2` with the HTTPS address of the deployed HuddleLens server. `runtime-config.js` is generated only for the Vega asset bundle; secrets must never be placed there.

## Verification

```bash
npm test                 # logic and provider contract tests
npm run test:integration # real local HTTP server/API test
npm run test:browser     # 1080p Chrome/TV workflow with fake camera
npm run check            # unit tests plus production asset build
```

The browser smoke test covers live data rendering, AI routing/fallback, replay, remote challenge completion, camera startup/local processing, settings, and runtime exceptions. It writes `demo/production-simulator.png` for visual inspection. Unit tests inject provider clients and therefore never require real AWS or OpenRouter credentials.

## Production boundaries

Code alone cannot grant sports distribution rights or create provider accounts. A real deployment still requires:

- an AWS account with Bedrock model access and a workload IAM role;
- an OpenRouter API key and funded account when alternative routing is required;
- a licensed sports event feed and provider-specific fixture selection;
- a licensed video stream with device-compatible DRM/CORS when applicable;
- HTTPS hosting reachable by Fire TV;
- privacy/legal review for camera use in target markets;
- production monitoring, secret rotation, and an availability plan appropriate to the event audience.

## License

MIT

## Open Source Mini Challenge

The privacy-first movement input layer has been extracted into [`huddlelens-motion`](https://github.com/mimimoneydev/huddlelens-motion), a standalone MIT-licensed library with camera-local direction detection, Fire TV remote fallback, unit tests, a browser demo, and integration/privacy documentation. Publication details and submission copy are tracked in [docs/OPEN_SOURCE_CHALLENGE.md](docs/OPEN_SOURCE_CHALLENGE.md).
