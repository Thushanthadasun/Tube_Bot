# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI GPT-5.2 via Replit AI Integrations

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### YouTube AI Chatbot (`artifacts/youtube-chat`)
- **Type**: React + Vite web app
- **Preview path**: `/`
- **Features**:
  - AI-powered chat that understands natural language (greetings vs. search vs. preference commands)
  - Real YouTube video homepage using YouTube Data API v3
  - Smart content filtering — tell the AI to block music, gaming, news, etc.
  - Video search via chat or search bar
  - Blocked category chips displayed in header (removable)
  - Clicking videos opens them at youtube.com

### API Server (`artifacts/api-server`)
- **Type**: Express 5 API
- **Preview path**: `/api`
- **Routes**:
  - `GET /api/youtube/homepage` — filtered trending videos
  - `GET /api/youtube/search?q=...` — filtered video search
  - `GET /api/youtube/preferences` — get content filter preferences
  - `POST /api/youtube/preferences` — update blocked categories/keywords/channels
  - `POST /api/youtube/chat` — SSE streaming AI chat (intelligent intent detection)
  - `/api/openai/conversations/*` — conversation history (CRUD + streaming messages)

## Database Schema

- `conversations` — AI chat conversation threads
- `messages` — Messages within conversations (user + assistant)
- `youtube_preferences` — Content filter settings (blocked categories, keywords, channels)

## Environment Variables / Secrets

- `YOUTUBE_API_KEY` — YouTube Data API v3 key (required for real videos)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Auto-set by Replit AI Integrations
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Auto-set by Replit AI Integrations
- `DATABASE_URL` — Auto-set by Replit database
