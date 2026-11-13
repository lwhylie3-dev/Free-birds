import {
  CreateStartUpPageContainer,
  EventSourceType,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { intentFor, type Gesture, type Source } from "./gestures";

const POLL_MS = 20_000;
const GLANCE = { containerID: 1, containerName: "glance" };

interface HudItem { id: number; text: string; priority: number }
interface Hud { items: HudItem[]; glance: string }

let bridge: EvenAppBridge;
let base = "";
let token = "";
let index = 0;
let items: HudItem[] = [];
let foreground = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastEvent = { key: "", at: 0 };
let pendingText: ReturnType<typeof setTimeout> | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function note(msg: string) {
  const el = $("log");
  el.textContent = `${new Date().toLocaleTimeString()} ${msg}\n${el.textContent ?? ""}`.slice(0, 3000);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}/eclipse/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const body = (await res.json()) as T & { ok: boolean; message?: string };
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
  return body;
}

async function show(text: string) {
  $("mirror").textContent = text;
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ ...GLANCE, content: text }));
}

async function refresh() {
  if (!base || !token) return show("Eclipse\n\nOpen the Eclipse app on your phone\nand enter your server and token.");
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hud = await api<Hud>(`/hud?i=${index}&tz=${encodeURIComponent(tz)}`);
    items = hud.items;
    if (index >= items.length) index = Math.max(0, items.length - 1);
    await show(hud.glance);
  } catch (err) {
    note(`refresh failed: ${String(err)}`);
    await show(`Eclipse\n\nOffline: ${String(err).slice(0, 80)}`);
  }
}

function schedule() {
  clearTimeout(timer);
  if (foreground) timer = setTimeout(async () => { await refresh(); schedule(); }, POLL_MS);
}

function sourceOf(e: EvenHubEvent): Source {
  switch (e.sysEvent?.eventSource) {
    case EventSourceType.TOUCH_EVENT_FROM_RING: return "ring";
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_L: return "left";
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_R: return "right";
    default: return "unknown";
  }
}

function gestureOf(type: OsEventTypeList | undefined): Gesture | null {
  switch (type) {
    case undefined: // the SDK can normalize CLICK (0) to undefined
    case OsEventTypeList.CLICK_EVENT: return "tap";
    case OsEventTypeList.DOUBLE_CLICK_EVENT: return "double";
    case OsEventTypeList.SCROLL_TOP_EVENT: return "up";
    case OsEventTypeList.SCROLL_BOTTOM_EVENT: return "down";
    case OsEventTypeList.LONG_PRESS_EVENT: return "long";
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT: return "long_release";
    default: return null;
  }
}

async function onEvent(e: EvenHubEvent) {
  const type = e.sysEvent?.eventType ?? e.textEvent?.eventType;
  if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) { foreground = true; await refresh(); return schedule(); }
  if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT) { foreground = false; return clearTimeout(timer); }
  if (e.audioEvent || e.listEvent || e.menuItemClickEvent || type === OsEventTypeList.IMU_DATA_REPORT) return;
  if (!e.sysEvent && !e.textEvent) return;

  const gesture = gestureOf(type);
  if (!gesture) return;
  // One tap can surface as both a text event (no source) and a sys event (tagged ring/left/right).
  // Hold text events briefly so a tagged sys event for the same tap wins.
  if (!e.sysEvent) {
    clearTimeout(pendingText);
    pendingText = setTimeout(() => void handle("unknown", gesture), 120);
    return;
  }
  clearTimeout(pendingText);
  await handle(sourceOf(e), gesture);
}

async function handle(source: Source, gesture: Gesture) {
  if (gesture === lastEvent.key && Date.now() - lastEvent.at < 250) return;
  lastEvent = { key: gesture, at: Date.now() };

  const intent = intentFor(source, gesture);
  note(`${source} ${gesture} → ${intent.kind === "action" ? intent.action : intent.kind === "local" ? intent.do : "-"}`);
  const events: { type: string; payload: Record<string, unknown> }[] = [{ type: "gesture", payload: { source, gesture } }];

  if (intent.kind === "local") {
    if (intent.do === "exit") return void bridge.shutDownPageContainer(1);
    if (items.length) index = (index + (intent.do === "next" ? 1 : items.length - 1)) % items.length;
  } else if (intent.kind === "action") {
    const payload: Record<string, unknown> = { action: intent.action };
    if (intent.action === "hud.ack") {
      const item = items[index];
      if (!item) return;
      payload.id = item.id;
    }
    events.push({ type: "action", payload });
  }
  try {
    await api("/events", { method: "POST", body: JSON.stringify({ events }) });
  } catch (err) {
    note(`send failed: ${String(err)}`);
  }
  await refresh();
  schedule();
}

async function main() {
  bridge = await waitForEvenAppBridge();
  base = (await bridge.getLocalStorage("eclipse_url")) || "";
  token = (await bridge.getLocalStorage("eclipse_token")) || "";
  // Dev only (stripped from production builds): preset from .env.local for the simulator.
  if (import.meta.env.DEV) {
    base ||= import.meta.env.VITE_ECLIPSE_URL ?? "";
    token ||= import.meta.env.VITE_ECLIPSE_TOKEN ?? "";
  }
  $<HTMLInputElement>("url").value = base;
  $<HTMLInputElement>("token").value = token;

  // One full-screen text container that captures input: 576x288 per eye.
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({ ...GLANCE, xPosition: 0, yPosition: 0, width: 576, height: 288, paddingLength: 8, isEventCapture: 1, content: "Eclipse" }),
      ],
    }),
  );
  bridge.onEvenHubEvent((e) => void onEvent(e));

  $("cfg").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    base = $<HTMLInputElement>("url").value.trim().replace(/\/+$/, "");
    token = $<HTMLInputElement>("token").value.trim();
    await bridge.setLocalStorage("eclipse_url", base);
    await bridge.setLocalStorage("eclipse_token", token);
    note("saved");
    await refresh();
    schedule();
  });

  await refresh();
  schedule();
}

main().catch((err) => note(`startup failed: ${String(err)}`));
