# Setup from an iPhone (Safari only)

Total time is about 20–30 minutes, and **everything is free**. Paste keys only into the secret settings described below, **never into a chat**.

Tip: some GitHub and Google settings pages work better if you tap **aA → Request Desktop Website** in Safari.

---

## Step 1: Cloudflare (hosting, database, free AI)

1. Go to **dash.cloudflare.com** and sign up (the free plan is fine). Verify your email.
2. Open **Workers & Pages** once. If Cloudflare asks you to pick a `workers.dev` subdomain, choose one (for example `yourname`). Your app will live at
   `https://noxara-yt.<your-subdomain>.workers.dev`.
3. Copy your **Account ID**. It's shown on the Workers & Pages overview (right side) or in the URL after `dash.cloudflare.com/`.
4. Create a deploy token: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**.
   - Under *Permissions*, tap **+ Add more** and add **Account → D1 → Edit**.
   - Under *Account Resources*, pick your account.
   - Tap **Continue → Create Token**, then copy the token (it's shown once).

## Step 2: Put the Cloudflare keys in GitHub and deploy

1. On github.com open this repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. Add:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1.4
   - `CLOUDFLARE_ACCOUNT_ID`: the ID from step 1.3
3. Open the repo's **Actions** tab → **Check and deploy** → **Run workflow** → **Run**.
   It creates the database, applies the schema, deploys the app, and generates the app's encryption secret, all automatically.
4. When it turns green, open `https://noxara-yt.<your-subdomain>.workers.dev` in Safari.
   The page shows your **OAuth redirect URI**. Copy it for the next step.

## Step 3: Google (read-only YouTube access)

Use a **new, dedicated** Google Cloud project. Don't reuse one from another app.

1. Go to **console.cloud.google.com** and sign in with the Google account that owns your YouTube channel.
2. Click the project picker at the top → **New project**, name it `noxara-yt` → **Create**, then select it.
3. **APIs & Services → Library**, search **YouTube Data API v3**, then tap **Enable**.
4. **Google Auth Platform** (or *APIs & Services → OAuth consent screen*) → **Get started**:
   - App name `Noxara YT`, support email = your email.
   - Audience: **External**.
   - Contact email = your email → agree → **Create**.
5. **Data Access → Add or remove scopes**: tick `.../auth/youtube.readonly`, `openid`, and `.../auth/userinfo.email` → **Update → Save**.
6. **Audience → Publish app → Confirm**, so the status says **In production**.
   *Why:* in "Testing" mode Google expires the login after 7 days, which breaks the scheduled sync. The app stays private to you because only your email is allowed in (step 3.8). Google will show a **"Google hasn't verified this app"** screen when you sign in. Tap **Advanced → Go to Noxara YT**. That's expected for a personal app.
7. **Clients → Create client** → type **Web application**, name `noxara-yt`.
   Under **Authorized redirect URIs** tap **Add URI** and paste the redirect URI from step 2.4 → **Create**.
   Copy the **Client ID** and **Client secret**.
8. Back in GitHub repo **Settings → Secrets and variables → Actions**, add:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `OWNER_EMAIL`: your Google account email. Only this account can ever sign in.
9. **Actions → Check and deploy → Run workflow** again to push those secrets to Cloudflare.

## Step 4: Use it

1. Open the app URL → **Sign in with Google** → approve read-only access.
2. In Safari tap **Share → Add to Home Screen** so it opens like an app.
3. On **Overview**, follow the *Next step* button:
   **Import my likes & playlists → Run pending work → Discover my categories → review and approve → Run pending work** (this sorts everything).
4. Fix any wrong labels on **Videos** (or tap *Looks right*). Each pick teaches the sorter.
5. After that, it syncs by itself every day and keeps sorting new likes every 30 minutes.

## Step 5: Share Sheet shortcut (optional, recommended)

Go to **Settings** in the app and follow the on-screen steps. You create a token there and build a tiny Shortcut called **Send to Noxara**. Then in the YouTube app: **Share → More → Send to Noxara**, and the video is added and sorted.

---

## Free-tier limits (what "free" means here)

| Thing | Free allowance | What happens at the limit |
|---|---|---|
| YouTube Data API | 10,000 units/day (an import of 2,000 likes uses about 80) | Work pauses and resumes after midnight Pacific time |
| Cloudflare Workers AI | 10,000 "neurons"/day (enough to analyze roughly 1,000+ videos/day) | Analysis pauses and resumes the next day |
| Cloudflare Workers / D1 | 100k requests/day, 5 GB database | Not reachable for one person |
| GitHub Actions | Free minutes are plenty for deploys | — |

There's nothing to pay unless you later opt in to something paid (for example a Claude-powered classifier).

## Troubleshooting

- **"redirect_uri_mismatch"** from Google: the URI in Google step 3.7 must exactly match the one shown on the app's sign-in page.
- **"This account isn't allowed"**: `OWNER_EMAIL` doesn't match the Google account you signed in with. Fix the secret and re-run the workflow.
- **Sign-in stopped working after a week**: the consent screen is still in Testing. Publish it (step 3.6) and sign in again.
- Everything the app does is listed under **Logs**.
