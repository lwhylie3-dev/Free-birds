# Noxara YouTube Intelligence

A private, standalone app that reads your YouTube likes and playlists, finds your interests, sorts your videos into categories you approve, and, with your approval, organizes them into private playlists. It learns from your corrections. You manage it entirely from an iPhone.

- **Setup (iPhone/Safari):** [docs/SETUP.md](docs/SETUP.md)
- **Architecture and API limits:** [docs/PROPOSAL.md](docs/PROPOSAL.md)

## What v0.1 does

- Google OAuth sign-in with **read-only** YouTube access, locked to one owner email. Tokens are AES-GCM encrypted at rest.
- Imports liked videos and your playlists (metadata only), and flags deleted or private videos.
- AI-proposed interest categories that you edit and approve before anything is sorted.
- Automatic sorting using free Cloudflare Workers AI embeddings. Low-confidence items go to a review queue.
- Learns from your picks: each correction or confirmation moves that category's prototype toward your examples.
- Add videos by pasting a link or from the iOS Share Sheet through a Shortcut, with duplicate detection.
- Scheduled sync (daily) and background sorting (every 30 minutes), with a full activity log and quota tracking.

Phase 2 (organizing):

- **Learn from your existing playlists**: each one you pick becomes a category, with its videos as examples.
- Map categories to existing playlists or new **private** ones.
- **Plan → approve → apply**: you see every playlist and video before anything changes, and can untick items. Unticked items aren't proposed again.
- Writes only **add**. Nothing is ever removed, moved, unliked, or deleted.
- Target playlists are re-read right before applying, so nothing gets added twice. Writes are paced by the daily quota (about 190 a day) and continue automatically.
- Playlist-management access is requested only when you tap **Enable organizing**.

## Stack

Cloudflare Workers (TypeScript + Hono), D1 (SQLite), Workers AI (`bge-base-en-v1.5` embeddings, Llama 3.3 70B for category discovery), Cron Triggers, and GitHub Actions for deploys. Every piece is on a free tier.

## Development

```sh
npm install
npm run typecheck && npm test
```

Pushing to the default branch (or running the **Check and deploy** workflow manually) deploys the app.
