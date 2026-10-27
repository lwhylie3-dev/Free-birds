// Server-rendered pages for iPhone Safari. All dynamic text goes through esc().

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function layout(title: string, body: string, opts: { nav?: boolean } = {}): string {
  const nav = opts.nav === false
    ? ""
    : `<nav><a href="/">Home</a><a href="/videos">Videos</a><a href="/categories">Categories</a><a href="/organize">Organize</a><a href="/add">Add</a><a href="/logs">Logs</a><a href="/settings">Settings</a></nav>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Noxara YT">
<meta name="theme-color" content="#0f1115">
<title>${esc(title)} · Noxara YT</title>
<link rel="stylesheet" href="/app.css"><script src="/app.js" defer></script>
</head><body>${nav}<main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

export function flash(message?: string | null, kind: "ok" | "error" = "ok"): string {
  return message ? `<p class="flash ${kind}">${esc(message)}</p>` : "";
}

export const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#14161a;--muted:#5d6470;--line:#e2e5ea;--accent:#c4302b;--ok:#1f7a3f;--warn:#9a6700;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--text:#eceef1;--muted:#9aa1ad;--line:#2a2f38;--accent:#ff5a52;--ok:#4cc27a;--warn:#e3b341;--err:#ff6b5e}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding-bottom:env(safe-area-inset-bottom)}
nav{position:sticky;top:0;z-index:5;display:flex;gap:4px;overflow-x:auto;padding:calc(8px + env(safe-area-inset-top)) 12px 8px;background:var(--card);border-bottom:1px solid var(--line)}
nav a{flex:none;padding:8px 12px;border-radius:999px;color:var(--text);text-decoration:none;font-weight:500}
nav a:active{background:var(--line)}
main{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:1.6rem;margin:4px 0 16px}h2{font-size:1.15rem;margin:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:0 0 12px}
.muted{color:var(--muted)}.small{font-size:.875rem}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.stat b{display:block;font-size:1.5rem}
button,.btn{display:inline-block;border:0;border-radius:10px;padding:12px 16px;font:inherit;font-weight:600;background:var(--accent);color:#fff;text-decoration:none;min-height:44px;cursor:pointer}
button.secondary,.btn.secondary{background:var(--line);color:var(--text)}
button.danger{background:var(--err)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input[type=text],input[type=url],input[type=search],textarea,select{width:100%;font:inherit;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);min-height:44px}
textarea{min-height:70px}label{display:block;margin:8px 0 4px;font-weight:500}
.flash{padding:12px;border-radius:10px;background:var(--card);border:1px solid var(--line)}.flash.ok{border-color:var(--ok)}.flash.error{border-color:var(--err)}
.video{display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:start}
.video img{width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:var(--line)}
.video .title{font-weight:600;overflow-wrap:anywhere}.video a{color:inherit}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.78rem;background:var(--line)}
.pill.review{background:var(--warn);color:#000}
.log{font-size:.875rem;border-bottom:1px solid var(--line);padding:8px 0}.log:last-child{border:0}
.s-ok{color:var(--ok)}.s-warn{color:var(--warn)}.s-error{color:var(--err)}
code,.token{font-family:ui-monospace,Menlo,monospace;font-size:.85rem;overflow-wrap:anywhere;background:var(--bg);padding:2px 4px;border-radius:4px}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.pager{display:flex;justify-content:space-between;margin-top:12px}
`;

// Runs background work in short steps while the page is open, and auto-submits category pickers.
export const JS = `
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches && el.matches("select[data-autosubmit]")) el.form.submit();
});
const runner = document.getElementById("runner");
if (runner) {
  const out = document.getElementById("runner-status");
  runner.addEventListener("click", async () => {
    runner.disabled = true;
    for (let i = 0; i < 400; i++) {
      let r;
      try {
        const res = await fetch("/api/step", { method: "POST", headers: { "x-requested-with": "fetch" } });
        r = await res.json();
      } catch (err) { out.textContent = "Network error; tap again to resume."; break; }
      out.textContent = r.message;
      if (r.status !== "working") break;
    }
    runner.disabled = false;
  });
}
`;
