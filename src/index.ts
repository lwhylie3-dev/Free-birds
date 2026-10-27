import { Hono, type Context, type Next } from "hono";
import { beginOAuth, checkShortcutToken, disconnect, finishOAuth, isLoggedIn, logout, redirectUri, rotateShortcutToken } from "./auth";
import { AiLimitReached, correct, proposeTaxonomy, resetAutoClassifications } from "./classify";
import { log, quotaUsedToday } from "./db";
import { now, type Env } from "./env";
import { runStep, scheduled, startSync } from "./sync";
import { submitVideo } from "./submit";
import { CSS, esc, flash, JS, layout } from "./ui";
import { DAILY_QUOTA, isConnected, QuotaExhausted, ReauthRequired } from "./youtube";

type App = { Bindings: Env };
type C = Context<App>;

const app = new Hono<App>();

app.use("*", async (c, next) => {
  await next();
  c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' https://i.ytimg.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
});

app.get("/app.css", (c) => c.body(CSS, 200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" }));
app.get("/app.js", (c) => c.body(JS, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" }));
app.get("/health", (c) => c.json({ ok: true }));

// iOS Shortcut endpoint: bearer token, JSON in and out. Registered before the session guard.
app.post("/share", async (c) => {
  if (!(await checkShortcutToken(c.env, c.req.header("authorization")))) return c.json({ ok: false, message: "Invalid or missing token." }, 401);
  let input = "";
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await c.req.json<{ url?: string; text?: string }>().catch(() => ({}) as { url?: string; text?: string });
    input = body.url ?? body.text ?? "";
  } else {
    input = await c.req.text();
  }
  try {
    const r = await submitVideo(c.env, input);
    return c.json(r, r.ok ? 200 : 400);
  } catch (err) {
    return c.json({ ok: false, message: friendly(err) }, 503);
  }
});

app.get("/auth/login", (c) => beginOAuth(c));
app.get("/auth/callback", async (c) => {
  const err = await finishOAuth(c);
  if (err) return c.html(layout("Sign-in problem", `${flash(err, "error")}<p><a class="btn" href="/auth/login">Try again</a></p>`, { nav: false }), 400);
  return c.redirect("/?connected=1");
});

// Everything below requires the owner's session; state-changing requests must come from this origin.
async function guard(c: C, next: Next) {
  if (!(await isLoggedIn(c))) {
    if (c.req.method !== "GET") return c.json({ status: "blocked", message: "Signed out. Reload the page." }, 401);
    return c.html(landing(c));
  }
  if (c.req.method === "POST") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.text("Cross-site request blocked", 403);
    if (!origin && !c.req.header("x-requested-with")) return c.text("Missing Origin header", 403);
  }
  return next();
}
app.use("/", guard);
for (const p of ["/videos/*", "/videos", "/categories/*", "/categories", "/add", "/logs", "/settings/*", "/settings", "/sync", "/api/*", "/auth/logout", "/auth/disconnect"]) {
  app.use(p, guard);
}

function landing(c: C): string {
  return layout(
    "Noxara YouTube Intelligence",
    `<div class="card"><p>Your private YouTube organizer. It sorts your liked videos and playlists into interest categories you approve.</p>
     <p class="muted small">Sign-in happens on Google's own page. This app only asks for read-only YouTube access and never sees your password.</p>
     <p><a class="btn" href="/auth/login">Sign in with Google</a></p></div>
     <div class="card small muted">Setup: this app's OAuth redirect URI is<br><code>${esc(redirectUri(c))}</code></div>`,
    { nav: false },
  );
}

function friendly(err: unknown): string {
  if (err instanceof QuotaExhausted || err instanceof ReauthRequired || err instanceof AiLimitReached) return err.message;
  return `Something went wrong: ${String(err).slice(0, 200)}`;
}

const count = async (c: C, sql: string) => (await c.env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;

app.get("/", async (c) => {
  const connected = await isConnected(c.env);
  const acct = await c.env.DB.prepare("SELECT email, channel_title FROM oauth_tokens WHERE id = 1").first<{ email: string; channel_title: string | null }>();
  const [videos, liked, sorted, review, unavailable, active, proposed, quota, syncing] = await Promise.all([
    count(c, "SELECT COUNT(*) n FROM videos WHERE available = 1"),
    count(c, "SELECT COUNT(*) n FROM video_sources WHERE source = 'liked'"),
    count(c, "SELECT COUNT(*) n FROM classifications"),
    count(c, "SELECT COUNT(*) n FROM classifications WHERE needs_review = 1"),
    count(c, "SELECT COUNT(*) n FROM videos WHERE available = 0"),
    count(c, "SELECT COUNT(*) n FROM categories WHERE status = 'active'"),
    count(c, "SELECT COUNT(*) n FROM categories WHERE status = 'proposed'"),
    quotaUsedToday(c.env),
    count(c, "SELECT COUNT(*) n FROM sync_state WHERE key = 'sync'"),
  ]);

  let next = "";
  if (!connected) next = `<a class="btn" href="/auth/login">Connect YouTube</a>`;
  else if (videos === 0 && !syncing) next = `<form method="post" action="/sync"><button>Import my likes &amp; playlists</button></form>`;
  else if (active === 0 && proposed === 0) next = `<form method="post" action="/categories/propose"><button>Discover my categories</button></form>`;
  else if (active === 0) next = `<a class="btn" href="/categories">Review proposed categories</a>`;
  else if (review > 0) next = `<a class="btn" href="/videos?review=1">Review ${review} uncertain videos</a>`;

  const body = `
    ${c.req.query("connected") ? flash("YouTube connected with read-only access.") : ""}
    ${flash(c.req.query("msg"))}${flash(c.req.query("err"), "error")}
    <div class="card"><div class="muted small">Account</div>
      <div>${connected ? `${esc(acct?.channel_title ?? acct?.email)} <span class="pill">read-only</span>` : "Not connected"}</div></div>
    ${next ? `<div class="card"><div class="muted small">Next step</div><div style="margin-top:8px">${next}</div></div>` : ""}
    <div class="stats">
      <div class="card stat"><b>${videos}</b><span class="muted small">videos (${liked} liked)</span></div>
      <div class="card stat"><b>${sorted}</b><span class="muted small">sorted</span></div>
      <div class="card stat"><b>${active}</b><span class="muted small">categories${proposed ? ` (+${proposed} proposed)` : ""}</span></div>
      <div class="card stat"><b>${review}</b><span class="muted small">need review</span></div>
    </div>
    <div class="card">
      <div class="row"><button id="runner" type="button">Run pending work</button>
      <form method="post" action="/sync"><button class="secondary">Sync now</button></form></div>
      <p id="runner-status" class="muted small">${syncing ? "A sync is in progress. Tap Run to continue it, or let the 30-minute schedule handle it." : "Work also runs automatically every 30 minutes."}</p>
    </div>
    <p class="muted small">YouTube quota today: ${quota} / ${DAILY_QUOTA} units${unavailable ? ` · ${unavailable} deleted/private videos flagged` : ""}</p>`;
  return c.html(layout("Overview", body));
});

app.post("/sync", async (c) => {
  try {
    await startSync(c.env, true);
    return c.redirect("/?msg=" + encodeURIComponent("Sync started. Tap 'Run pending work' to watch it go."));
  } catch (err) {
    return c.redirect("/?err=" + encodeURIComponent(friendly(err)));
  }
});

app.post("/api/step", async (c) => c.json(await runStep(c.env)));

// ---------- Categories ----------

interface CatRow {
  id: number;
  name: string;
  description: string;
  status: string;
  example_count: number;
  n: number;
}

app.get("/categories", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cat.id, cat.name, cat.description, cat.status, cat.example_count,
       (SELECT COUNT(*) FROM classifications cl WHERE cl.category_id = cat.id) AS n
     FROM categories cat WHERE cat.status != 'archived' ORDER BY cat.status DESC, cat.name`,
  ).all<CatRow>();
  const proposed = results.filter((r) => r.status === "proposed");
  const active = results.filter((r) => r.status === "active");

  const proposedHtml = proposed.length
    ? `<h2>Proposed: review before anything is sorted</h2>
       <form method="post" action="/categories/approve">
       ${proposed
         .map(
           (p) => `<div class="card"><label class="row"><input type="checkbox" name="keep" value="${p.id}" checked> Keep</label>
             <input type="text" name="name_${p.id}" value="${esc(p.name)}" maxlength="60" aria-label="Name">
             <textarea name="desc_${p.id}" maxlength="300" aria-label="Description">${esc(p.description)}</textarea></div>`,
         )
         .join("")}
       <button>Approve checked categories</button></form>`
    : "";

  const activeHtml = active.length
    ? `<h2>Active</h2>${active
        .map(
          (a) => `<div class="card"><form method="post" action="/categories/${a.id}/update">
            <input type="text" name="name" value="${esc(a.name)}" maxlength="60" aria-label="Name">
            <textarea name="description" maxlength="300" aria-label="Description">${esc(a.description)}</textarea>
            <p class="muted small"><a href="/videos?cat=${a.id}">${a.n} videos</a> · learned from ${a.example_count} of your picks</p>
            <div class="row"><button class="secondary">Save</button>
            <button class="secondary" formaction="/categories/${a.id}/archive">Archive</button></div></form></div>`,
        )
        .join("")}
       <form method="post" action="/categories/resort"><button class="secondary">Re-sort automatic labels</button>
       <p class="muted small">Your own picks are kept. Use this after changing categories.</p></form>`
    : "";

  const body = `${flash(c.req.query("msg"))}${flash(c.req.query("err"), "error")}
    ${proposedHtml}${activeHtml}
    <h2>Add a category</h2>
    <form class="card" method="post" action="/categories/add">
      <label for="n">Name</label><input id="n" type="text" name="name" maxlength="60" required>
      <label for="d">What belongs here?</label><textarea id="d" name="description" maxlength="300"></textarea>
      <p><button>Add</button></p></form>
    <form method="post" action="/categories/propose"><button class="secondary">${proposed.length || active.length ? "Suggest new categories with AI" : "Discover my categories with AI"}</button></form>`;
  return c.html(layout("Categories", body));
});

app.post("/categories/propose", async (c) => {
  try {
    const n = await proposeTaxonomy(c.env);
    return c.redirect("/categories?" + (n ? `msg=${encodeURIComponent(`${n} categories proposed. Edit, uncheck, then approve.`)}` : "err=No+usable+suggestions%3B+try+again."));
  } catch (err) {
    return c.redirect("/categories?err=" + encodeURIComponent(friendly(err)));
  }
});

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

app.post("/categories/approve", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const keep = new Set([form.keep].flat().filter(Boolean).map(String));
  const { results } = await c.env.DB.prepare("SELECT id FROM categories WHERE status = 'proposed'").all<{ id: number }>();
  const stmts = results.map((r) => {
    const id = String(r.id);
    if (!keep.has(id)) return c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(r.id);
    const name = clean(form[`name_${id}`], 60);
    return c.env.DB.prepare("UPDATE OR IGNORE categories SET status = 'active', name = ?, description = ?, embedding = NULL WHERE id = ?").bind(
      name || `Category ${id}`,
      clean(form[`desc_${id}`], 300),
      r.id,
    );
  });
  if (stmts.length) await c.env.DB.batch(stmts);
  await c.env.DB.prepare("DELETE FROM categories WHERE status = 'proposed'").run();
  await log(c.env, "taxonomy", "ok", `Approved ${keep.size} categories.`);
  return c.redirect("/?msg=" + encodeURIComponent("Categories approved. Tap 'Run pending work' to sort your videos."));
});

app.post("/categories/add", async (c) => {
  const form = await c.req.parseBody();
  const name = clean(form.name, 60);
  if (!name) return c.redirect("/categories?err=Name+is+required");
  const r = await c.env.DB.prepare("INSERT OR IGNORE INTO categories (name, description, status, created_at) VALUES (?, ?, 'active', ?)")
    .bind(name, clean(form.description, 300), now())
    .run();
  return c.redirect("/categories?" + (r.meta.changes ? "msg=Category+added" : "err=A+category+with+that+name+exists"));
});

app.post("/categories/:id/update", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const name = clean(form.name, 60);
  if (!name) return c.redirect("/categories?err=Name+is+required");
  const r = await c.env.DB.prepare("UPDATE OR IGNORE categories SET name = ?, description = ?, embedding = NULL WHERE id = ?")
    .bind(name, clean(form.description, 300), id)
    .run();
  return c.redirect("/categories?" + (r.meta.changes ? "msg=Saved" : "err=Name+already+used"));
});

app.post("/categories/:id/archive", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE categories SET status = 'archived' WHERE id = ?").bind(id),
    // Its videos (including your picks) go back into the queue and get re-sorted into the remaining categories.
    c.env.DB.prepare("DELETE FROM classifications WHERE category_id = ?").bind(id),
  ]);
  await log(c.env, "taxonomy", "info", `Archived category ${id}.`);
  return c.redirect("/categories?msg=Archived");
});

app.post("/categories/resort", async (c) => {
  await resetAutoClassifications(c.env);
  return c.redirect("/?msg=" + encodeURIComponent("Automatic labels cleared. Tap 'Run pending work' to re-sort."));
});

// ---------- Videos ----------

const PAGE = 30;

app.get("/videos", async (c) => {
  const cat = c.req.query("cat") ?? "";
  const review = c.req.query("review") === "1";
  const q = clean(c.req.query("q"), 100);
  const page = Math.max(0, Number(c.req.query("page") ?? 0) || 0);

  const where = ["v.available = 1"];
  const binds: (string | number)[] = [];
  if (cat === "none") where.push("c.category_id IS NULL");
  else if (cat) {
    where.push("c.category_id = ?");
    binds.push(Number(cat));
  }
  if (review) where.push("c.needs_review = 1");
  if (q) {
    where.push("(v.title LIKE ? OR v.channel_title LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }
  const { results: vids } = await c.env.DB.prepare(
    `SELECT v.id, v.title, v.channel_title, v.thumbnail, c.category_id, c.confidence, c.method, c.needs_review
     FROM videos v LEFT JOIN classifications c ON c.video_id = v.id
     WHERE ${where.join(" AND ")} ORDER BY v.added_at DESC, v.id LIMIT ? OFFSET ?`,
  )
    .bind(...binds, PAGE + 1, page * PAGE)
    .all<{ id: string; title: string; channel_title: string | null; thumbnail: string | null; category_id: number | null; confidence: number | null; method: string | null; needs_review: number | null }>();
  const { results: cats } = await c.env.DB.prepare("SELECT id, name FROM categories WHERE status = 'active' ORDER BY name").all<{ id: number; name: string }>();

  const hasMore = vids.length > PAGE;
  const options = (selected: number | null) =>
    `${selected === null ? `<option value="" selected>Unsorted</option>` : ""}${cats
      .map((k) => `<option value="${k.id}"${k.id === selected ? " selected" : ""}>${esc(k.name)}</option>`)
      .join("")}`;
  const back = (() => {
    const u = new URL(c.req.url);
    return u.pathname + u.search;
  })();

  const list = vids
    .slice(0, PAGE)
    .map(
      (v) => `<div class="card video">
        <a href="https://www.youtube.com/watch?v=${esc(v.id)}">${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy">` : `<img alt="">`}</a>
        <div><div class="title"><a href="https://www.youtube.com/watch?v=${esc(v.id)}">${esc(v.title)}</a></div>
          <div class="muted small">${esc(v.channel_title)}</div>
          <div class="small">${v.method === "auto" ? `<span class="pill${v.needs_review ? " review" : ""}">auto ${Math.round((v.confidence ?? 0) * 100)}%</span>` : v.method ? `<span class="pill">your pick</span>` : ""}</div>
          ${cats.length ? `<form method="post" action="/videos/${esc(v.id)}/category"><input type="hidden" name="back" value="${esc(back)}">
            <select name="category" data-autosubmit aria-label="Category">${options(v.category_id)}</select>
            ${v.method === "auto" ? `<button class="secondary small" name="confirm" value="1">Looks right</button>` : ""}</form>` : ""}
        </div></div>`,
    )
    .join("");

  const qs = (p: number) => {
    const u = new URLSearchParams({ ...(cat ? { cat } : {}), ...(review ? { review: "1" } : {}), ...(q ? { q } : {}), page: String(p) });
    return `/videos?${u}`;
  };
  const body = `${flash(c.req.query("msg"))}
    <form class="filters" method="get" action="/videos">
      <select name="cat" aria-label="Category"><option value="">All categories</option><option value="none"${cat === "none" ? " selected" : ""}>Unsorted</option>
        ${cats.map((k) => `<option value="${k.id}"${String(k.id) === cat ? " selected" : ""}>${esc(k.name)}</option>`).join("")}</select>
      <select name="review" aria-label="Filter"><option value="">Everything</option><option value="1"${review ? " selected" : ""}>Needs review</option></select>
      <input type="search" name="q" value="${esc(q)}" placeholder="Search title or channel" style="grid-column:1/-1">
      <button class="secondary" style="grid-column:1/-1">Filter</button>
    </form>
    ${list || `<p class="muted">No videos here yet.</p>`}
    <div class="pager">${page > 0 ? `<a class="btn secondary" href="${qs(page - 1)}">Previous</a>` : "<span></span>"}${hasMore ? `<a class="btn secondary" href="${qs(page + 1)}">Next</a>` : ""}</div>`;
  return c.html(layout("Videos", body));
});

app.post("/videos/:id/category", async (c) => {
  const videoId = c.req.param("id");
  const form = await c.req.parseBody();
  const back = String(form.back ?? "/videos");
  const target = back.startsWith("/") && !back.startsWith("//") ? back : "/videos";
  const categoryId = Number(form.category);
  if (!categoryId) return c.redirect(target);
  const cat = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ? AND status = 'active'").bind(categoryId).first();
  const vid = await c.env.DB.prepare("SELECT id FROM videos WHERE id = ?").bind(videoId).first();
  if (!cat || !vid) return c.redirect(target);
  await correct(c.env, videoId, categoryId);
  return c.redirect(target);
});

// ---------- Add / submit ----------

app.get("/add", async (c) => {
  const body = `${flash(c.req.query("msg"))}${flash(c.req.query("err"), "error")}
    <form class="card" method="post" action="/add">
      <label for="u">YouTube link</label>
      <input id="u" type="url" name="url" placeholder="https://youtu.be/…" required autocomplete="off">
      <p><button>Add &amp; sort</button></p></form>
    <p class="muted small">Tip: set up the iOS Shortcut in <a href="/settings">Settings</a> to add videos straight from the YouTube app's Share button.</p>`;
  return c.html(layout("Add a video", body));
});

app.post("/add", async (c) => {
  const form = await c.req.parseBody();
  try {
    const r = await submitVideo(c.env, String(form.url ?? ""));
    return c.redirect(`/add?${r.ok ? "msg" : "err"}=${encodeURIComponent(r.title ? `${r.title}: ${r.message}` : r.message)}`);
  } catch (err) {
    return c.redirect("/add?err=" + encodeURIComponent(friendly(err)));
  }
});

// ---------- Logs ----------

app.get("/logs", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT ts, kind, status, message, units FROM sync_log ORDER BY id DESC LIMIT 150").all<{
    ts: number;
    kind: string;
    status: string;
    message: string;
    units: number;
  }>();
  const rows = results
    .map(
      (r) => `<div class="log"><span class="s-${esc(r.status)}">●</span> <b>${esc(r.kind)}</b> <span class="muted">${esc(new Date(r.ts).toISOString().replace("T", " ").slice(0, 16))} UTC</span><br>${esc(r.message)}</div>`,
    )
    .join("");
  return c.html(layout("Sync log", `<div class="card">${rows || `<p class="muted">Nothing logged yet.</p>`}</div>`));
});

// ---------- Settings ----------

function settingsPage(c: C, origin: string, token?: string): string {
  const shareUrl = `${origin}/share`;
  return layout(
    "Settings",
    `${flash(c.req.query("msg"))}
    <h2>iPhone Share Sheet shortcut</h2>
    <div class="card">
      ${token ? `<p><b>Your new token (shown only once):</b></p><p class="token">${esc(token)}</p>` : ""}
      <ol class="small">
        <li>Create a token below, then copy it.</li>
        <li>In the Shortcuts app, make a new shortcut named <b>Send to Noxara</b>. In its settings, turn on <b>Show in Share Sheet</b> and set input to <b>URLs</b> and <b>Text</b>.</li>
        <li>Add <b>Get Contents of URL</b>: URL <code>${esc(shareUrl)}</code>, Method <b>POST</b>, Header <code>Authorization</code> = <code>Bearer YOUR_TOKEN</code>, Request Body <b>JSON</b> with key <code>url</code> = <i>Shortcut Input</i>.</li>
        <li>Add <b>Get Dictionary Value</b> for key <code>message</code>, then <b>Show Notification</b> with it.</li>
        <li>In the YouTube app tap Share → More → <b>Send to Noxara</b>.</li>
      </ol>
      <form method="post" action="/settings/shortcut"><button class="secondary">${token ? "Replace token again" : "Create new token"}</button></form>
      <p class="muted small">Creating a new token immediately disables the old one.</p>
    </div>
    <h2>Account</h2>
    <div class="card">
      <p class="small">Access is read-only: this version cannot change your YouTube playlists.</p>
      <div class="row"><form method="post" action="/auth/logout"><button class="secondary">Sign out</button></form>
      <form method="post" action="/auth/disconnect"><button class="danger">Disconnect YouTube</button></form></div>
      <p class="muted small">Disconnect revokes this app's Google access and deletes the stored token. Your categories and labels stay.</p>
    </div>
    <h2>Setup info</h2>
    <div class="card small">OAuth redirect URI: <code>${esc(redirectUri(c))}</code></div>`,
  );
}

app.get("/settings", (c) => c.html(settingsPage(c, new URL(c.req.url).origin)));
app.post("/settings/shortcut", async (c) => {
  const token = await rotateShortcutToken(c.env);
  c.header("cache-control", "no-store");
  return c.html(settingsPage(c, new URL(c.req.url).origin, token));
});

app.post("/auth/logout", (c) => {
  logout(c);
  return c.redirect("/");
});
app.post("/auth/disconnect", async (c) => {
  await disconnect(c.env);
  logout(c);
  return c.redirect("/");
});

app.onError(async (err, c) => {
  try {
    await log(c.env, "http", "error", `${c.req.method} ${new URL(c.req.url).pathname}: ${String(err)}`);
  } catch {
    // The database itself may be the problem.
  }
  return c.html(layout("Error", flash(friendly(err), "error"), { nav: true }), 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;
