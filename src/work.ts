import { AiLimitReached, classifyPendingVideos, embedCategories, embedPendingVideos } from "./classify";
import { getSetting, log, setSetting } from "./db";
import { now, type Env } from "./env";
import { applyStep, buildPlan, openPlan, refreshStaleCategories } from "./organize";
import { detailsStep, isSyncRunning, startSync, startTargetedSync, syncStep } from "./sync";
import { canWrite, isConnected, QuotaExhausted, ReauthRequired } from "./youtube";

export type StepStatus = "working" | "idle" | "blocked";

/** One bounded unit of background work: sync → details → analyze → learn → sort → apply approved plan. */
export async function runStep(env: Env): Promise<{ status: StepStatus; message: string }> {
  try {
    if (!(await isConnected(env))) return { status: "blocked", message: "Connect YouTube first." };
    if (await isSyncRunning(env)) return { status: "working", message: await syncStep(env) };
    const fetched = await detailsStep(env);
    if (fetched) return { status: "working", message: `Fetched details for ${fetched} videos.` };
    await embedCategories(env);
    const embedded = await embedPendingVideos(env);
    if (embedded) return { status: "working", message: `Analyzed ${embedded} videos.` };
    const refreshed = await refreshStaleCategories(env);
    if (refreshed) return { status: "working", message: `Learned from ${refreshed} of your playlists.` };
    const classified = await classifyPendingVideos(env);
    if (classified) return { status: "working", message: `Sorted ${classified} videos.` };
    const applied = await applyStep(env, (ids) => startTargetedSync(env, ids));
    if (applied) return { status: "working", message: applied };
    return { status: "idle", message: "All caught up." };
  } catch (err) {
    if (err instanceof QuotaExhausted || err instanceof ReauthRequired) {
      await log(env, "work", "warn", err.message);
      return { status: "blocked", message: err.message };
    }
    if (err instanceof AiLimitReached) {
      const message = "Today's free AI allowance is used up; analysis resumes automatically tomorrow.";
      await log(env, "work", "warn", `${message} (${err.message.slice(0, 200)})`);
      return { status: "blocked", message };
    }
    await log(env, "work", "error", String(err));
    return { status: "blocked", message: `Error: ${String(err).slice(0, 200)}` };
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** Cron entry: start the daily sync when due, do a few steps of work, and draft (never apply) a daily plan. */
export async function scheduled(env: Env): Promise<void> {
  if (!(await isConnected(env))) return;
  try {
    const last = Number((await getSetting(env, "last_sync_started")) ?? 0);
    if (!(await isSyncRunning(env)) && now() - last > DAY - 30 * 60 * 1000) await startSync(env, false);
  } catch (err) {
    await log(env, "cron", "error", `Could not start scheduled sync: ${String(err)}`);
    return;
  }
  let last: StepStatus = "working";
  for (let i = 0; i < 4 && last === "working"; i++) last = (await runStep(env)).status;

  if (last === "idle" && (await canWrite(env)) && !(await openPlan(env))) {
    const drafted = Number((await getSetting(env, "last_plan_drafted")) ?? 0);
    if (now() - drafted > DAY - 30 * 60 * 1000) {
      await setSetting(env, "last_plan_drafted", String(now()));
      try {
        await buildPlan(env);
      } catch (err) {
        await log(env, "cron", "error", `Could not draft plan: ${String(err)}`);
      }
    }
  }
}
