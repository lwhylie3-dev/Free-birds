# Noxara YouTube Intelligence

A private, standalone app that reads your YouTube likes and playlists, finds your interests, and sorts your videos into categories you approve. It learns from your corrections. You manage it entirely from an iPhone.

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

It **cannot change your YouTube account** in this version. Creating private playlists comes in phase 2, behind an approve-before-apply step.

## Stack

Cloudflare Workers (TypeScript + Hono), D1 (SQLite), Workers AI (`bge-base-en-v1.5` embeddings, Llama 3.3 70B for category discovery), Cron Triggers, and GitHub Actions for deploys. Every piece is on a free tier.

## Development

```sh
npm install
npm run typecheck && npm test
```

Pushing to the default branch (or running the **Check and deploy** workflow manually) deploys the app.
