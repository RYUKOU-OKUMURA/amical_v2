# Local Customizations

This document tracks personal customizations added to this workspace on top of upstream Amical.

## Live Pending Input Preview

The desktop floating widget now shows live pending input text while dictation is running. The preview displays partial transcription text as audio chunks are processed, switches to a processing state when recording stops, and briefly keeps the final text visible before clearing.

Primary implementation points:

- `apps/desktop/src/main/managers/recording-manager.ts` emits transcription preview updates.
- `apps/desktop/src/trpc/routers/recording.ts` exposes `transcriptionPreviewUpdates`.
- `apps/desktop/src/renderer/widget/pages/widget/components/FloatingButton.tsx` renders the preview panel above the floating widget.

## Groq Speech-to-Text Provider

The desktop app can use Groq-hosted Whisper models for faster speech-to-text. Configure it in:

`Settings -> AI Models -> Speech -> Groq Speech-to-Text`

The API key is stored through the app settings flow, not through an environment variable. The app validates the key against Groq's OpenAI-compatible `/models` endpoint before saving it.

Supported speech models:

- `groq-whisper-large-v3-turbo`
- `groq-whisper-large-v3`

Primary implementation points:

- `apps/desktop/src/pipeline/providers/transcription/groq-provider.ts` sends WAV audio to Groq's `/audio/transcriptions` endpoint.
- `apps/desktop/src/services/transcription-service.ts` selects Groq when a Groq speech model is active.
- `apps/desktop/src/services/settings-service.ts` stores Groq provider configuration.
- `apps/desktop/src/services/model-service.ts` validates the Groq connection and handles Groq speech model availability.
- `apps/desktop/src/renderer/main/pages/settings/ai-models/tabs/SpeechTab.tsx` adds the settings UI.

## Development Notes

Initialize the Whisper submodule before installing or building native dependencies:

```bash
git submodule update --init --recursive packages/whisper-wrapper/whisper.cpp
```

Install dependencies and build the local native Whisper wrapper:

```bash
pnpm install
```

Useful verification commands:

```bash
pnpm --filter @amical/desktop type:check
pnpm --filter @amical/desktop format:check
pnpm --filter @amical/desktop lint
git diff --check
```

`pnpm --filter @amical/desktop lint` currently passes with existing repository warnings.
