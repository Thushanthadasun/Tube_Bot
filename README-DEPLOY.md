# TubeChat AI — Self-Hosting Guide (100% Free)

## What's included
- `extension/` — Chrome browser extension (load unpacked in Chrome)
- `artifacts/api-server/` — Express + Node.js backend (AI chat, YouTube API)
- `artifacts/youtube-chat/` — React frontend (optional web UI)
- `lib/` — Shared database + TypeScript libraries

---

## Free Hosting Options for the Backend

### Option A: Render (Recommended — Always free)
1. Push this project to a GitHub repo
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Root directory**: `artifacts/api-server`
   - **Build command**: `npm install && npm run build`
   - **Start command**: `node dist/index.mjs`
   - **Plan**: Free
5. Add environment variables (see below)
6. Deploy — you get a permanent URL like `https://your-app.onrender.com`

> Note: Render free tier sleeps after 15 min of no traffic. First request after sleep takes ~30s to wake up.

### Option B: Railway ($5 free credit/month)
1. Go to https://railway.app → New Project → Deploy from GitHub
2. Select your repo → set root to `artifacts/api-server`
3. Add environment variables
4. Deploy

### Option C: Koyeb (Always-on free tier)
1. Go to https://www.koyeb.com → Create App
2. Connect GitHub, select `artifacts/api-server`
3. Build: `npm install && npm run build`
4. Start: `node dist/index.mjs`

---

## Required Environment Variables

Set these in your hosting provider's dashboard:

```
YOUTUBE_API_KEY=your_youtube_data_api_v3_key
SESSION_SECRET=any_random_string_32_chars
DATABASE_URL=your_postgresql_connection_string
```

**Getting a free PostgreSQL database:**
- https://neon.tech (free tier, no credit card)
- https://supabase.com (free tier)
- https://railway.app (comes with free Postgres)

**Getting YouTube API Key (free):**
1. Go to https://console.cloud.google.com
2. Create project → Enable "YouTube Data API v3"
3. Credentials → Create API Key

**Getting OpenAI API Key:**
- The backend uses Replit's AI integration. If self-hosting outside Replit, replace the OpenAI client in `artifacts/api-server/src/routes/youtube/index.ts` with the standard OpenAI client:
```javascript
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```
Then add `OPENAI_API_KEY=sk-...` to your environment variables.

---

## Update the Extension with Your New Backend URL

After deploying, open `extension/content.js` and change line 7:

```javascript
// Change this:
const API = "https://YOUR-OLD-REPLIT-URL.replit.dev/api";

// To your new deployed URL:
const API = "https://your-app.onrender.com/api";
```

Then reload the extension in Chrome (`chrome://extensions` → Reload).

---

## Running Locally

```bash
# Install dependencies
npm install -g pnpm
pnpm install

# Set up .env file
cp .env.example .env
# Fill in your values in .env

# Push database schema
pnpm --filter @workspace/db run push

# Run backend
pnpm --filter @workspace/api-server run dev

# Run frontend (optional)
pnpm --filter @workspace/youtube-chat run dev
```

---

## Loading the Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension/` folder
5. Go to YouTube — the TubeChat button appears bottom-right
