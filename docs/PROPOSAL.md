# Noxara YouTube Intelligence: Architecture Proposal

Status: **approved. MVP v0.1 and phase 2 (approved playlist organizing) are implemented** (see `README.md` and `docs/SETUP.md`).

> **Change after approval:** the owner chose an all-free route. Classification uses **Cloudflare Workers AI** (free daily allowance) instead of the paid Claude API: embeddings plus nearest-prototype matching, and an LLM only for proposing categories. A Claude-powered classifier can be added later as an opt-in.

## 0. Independence

- Its own repo (`Free-birds`), Google Cloud project, OAuth client, Cloudflare account/worker, database, and secrets.
- No code, data, or credentials shared with the Floot Noxara project or any other app.
- Integration seam for later: a small internal `/api/v1` with bearer-token auth plus an outbound webhook table. Both are designed in, but nothing is wired up.

## 1. Architecture

```
iPhone (Safari web app + iOS Shortcut on the Share Sheet)
        │  HTTPS
        ▼
Cloudflare Worker (TypeScript, Hono)  ── Cron Trigger (scheduled sync)
  ├─ /auth/*      Google OAuth (authorization-code flow, server side)
  ├─ /api/*       videos, categories, corrections, approvals, logs
  ├─ /share       endpoint the iOS Shortcut posts a URL to
  └─ jobs         sync → classify → plan → (approved) apply
        │
        ├─ Cloudflare D1 (SQLite): videos, playlists, categories,
        │   classifications, corrections, plans, sync_log, tokens(encrypted)
        ├─ YouTube Data API v3 (official)
        └─ Claude API (classification + taxonomy discovery)
```

Why this stack:
- **Cloudflare Workers + D1 + Cron Triggers**: one free-tier platform covers the API, the database, and scheduled jobs. Secrets are set in the dashboard, so they never live in the repo.
- **GitHub → GitHub Actions → `wrangler deploy`**: every push deploys. Everything can be managed from Safari (GitHub web, Cloudflare dashboard, Claude Code on the web). No Mac or PC needed.
- **Web app (PWA-style, Add to Home Screen)**: iOS Safari doesn't support the Web Share Target API, so sharing goes through an **iOS Shortcut** ("Send to Noxara") on the YouTube app's Share Sheet. It POSTs the URL to `/share` with a personal API token.

## 2. Required services and accounts (you create them in Safari)

| Service | Purpose | Cost |
|---|---|---|
| Google Cloud project (new, dedicated) | YouTube Data API v3 + OAuth client | Free. API quota isn't billed. |
| Cloudflare account | Worker, D1, Cron, secrets | Free tier is enough. Workers Paid is $5/mo only if you outgrow it. |
| GitHub (this repo) | Code + CI deploy | Free |

## 3. Authentication

1. In the Google Cloud console: enable YouTube Data API v3 and create an OAuth consent screen (External) and a Web OAuth client. The redirect URI is the worker's `/auth/callback`.
2. **Set the consent screen to "In production" (unverified)**, not "Testing". In Testing mode Google expires refresh tokens after **7 days**, which would break scheduled sync. An unverified production app shows a "Google hasn't verified this app" screen. For a single-owner personal app you click through it once. Full verification is only needed for public use.
3. Flow: you tap "Connect YouTube" → Google's own sign-in page (the app never sees your password) → consent → the worker exchanges the code server-side → the refresh token is **encrypted with AES-GCM** (key held as a Cloudflare secret) and stored in D1. Access tokens are short-lived and stay in memory.
4. App access is single-owner: only the Google account/channel that first connected can sign in (HttpOnly session cookie). The iOS Shortcut uses a separate, revocable random token.
5. Scopes, requested incrementally:
   - MVP: `youtube.readonly` (read only, can't change anything).
   - Phase 2: `youtube` (needed to create playlists and add videos). Requested only when you choose to enable organizing.
6. Disconnect = revoke the token at Google and delete it from D1.

## 4. YouTube API limitations (the honest part)

- **Quota: 10,000 units/day** by default. Reads (`videos.list`, `playlistItems.list`, `playlists.list`) cost **1 unit** per page of 50. `search.list` costs **100**. Writes (`playlists.insert`, `playlistItems.insert/update/delete`) cost **50** each.
  - So importing 2,000 liked videos costs about 80 units. Cheap.
  - **Adding videos to playlists is the bottleneck: about 190 inserts/day at most.** Organizing 2,000 videos takes roughly 11 days of quota. The app queues and paces this, and shows progress.
  - A quota increase requires Google's compliance audit form. It's possible, but slow and not guaranteed.
- **Not accessible via the API**: watch history, Watch Later, and the "Recommended for you" feed. Liked videos are accessible via the channel's likes playlist, but very large like lists may be incomplete.
- **No transcripts** for other people's videos (captions download only works for your own uploads). Classification uses title, description, tags, channel, YouTube category, `topicDetails`, and duration.
- **`relatedToVideoId` search was removed**, so recommendations come from channels you already engage with (uploads playlists, 1 unit each), ranked against your interest profile. Keyword search is used sparingly (100 units).
- Deleted or privated videos show up as unavailable entries and are flagged, not silently dropped.
- YouTube API Services policy: stored API data must be kept fresh. Scheduled sync refreshes it, and metadata for videos you remove is deleted.

## 5. Safety rules built into the design

- **Read-only by default.** Writes need the Phase-2 scope *and* an approved plan.
- **Plan → Approve → Apply.** Any change becomes a *plan* (a dry-run list such as "add 37 videos to the new private playlist 'Systems Design'"). Nothing touches YouTube until you approve that plan. Bulk moves and deletes always need explicit approval, item by item or all at once.
- Existing playlists are never modified or deleted without approval. New playlists are always created **private**.
- Idempotency: a unique `(playlist_id, video_id)` constraint plus a check against live playlist contents before each insert prevents duplicate adds.
- Every API call that changes something is written to `sync_log` (who, what, units used, result, error). Retries use exponential backoff and stop cleanly when quota runs out.

## 6. Classification and learning

- **Taxonomy discovery**: Claude reads a sample of your liked videos and existing playlist names and proposes 8–20 categories with descriptions. **You edit and approve them** before anything is labeled.
- **Classification**: one structured-output call per video (or a batch) returns a category, confidence, and short reason. Low confidence goes to a review queue.
- **Learning from corrections**: each correction is stored. The most relevant past corrections are added to the prompt as examples, and category descriptions can be refined from them. No model training, so it's transparent and reversible.
- **Duplicates**: exact duplicates by video ID across playlists, plus a "likely re-upload" check (normalized title + channel + duration) shown for review.
- **Model and cost**: the default is Claude Opus 5.5 at low effort ($4 / $20 per million tokens). At roughly 600 input + 100 output tokens per video, that's about **$4.40 per 1,000 videos**, or about half that with the Batch API. You can switch to **Claude Haiku 5.5** ($0.10 / $0.50 per million), about **$0.11 per 1,000 videos**. It's one config value.

## 7. Smallest working version (MVP v0.1)

Goal: connect your account and classify videos. Read only, no YouTube writes.

1. Worker + D1 deployed through GitHub Actions; health page.
2. Google OAuth with `youtube.readonly`; encrypted token storage; owner-only login.
3. Import liked videos and your playlists (metadata only), with a sync log.
4. Taxonomy proposal → you approve or edit the categories.
5. Classify the imported videos; mobile list view filtered by category; tap to correct.
6. Paste-a-URL box + iOS Shortcut → the submitted video is classified immediately.

Later phases: (2) private-playlist organizing through approved plans, (3) duplicate review and recommendations, (4) Cron scheduled sync and notifications.

## 8. What you'd do after approval (about 20 minutes in Safari)

1. Create the Cloudflare account and an API token for deploys (I'll give exact steps).
2. Create the Google Cloud project and OAuth client (exact steps and screenshots in a setup guide).
3. Create the Anthropic API key.
4. Paste each value into GitHub repo secrets / Cloudflare secrets. **Never into chat.**
