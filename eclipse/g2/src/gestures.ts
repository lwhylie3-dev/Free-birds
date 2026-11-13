// Gesture → intent map. The G2 temples and the R1 ring send the same gestures; the SDK tags each
// with its source, so the ring can drive the desk while the temples drive the lenses.

export type Source = "ring" | "left" | "right" | "unknown";
export type Gesture = "tap" | "double" | "up" | "down" | "long" | "long_release";

export type Intent =
  | { kind: "local"; do: "next" | "prev" | "exit" }
  | { kind: "action"; action: "hud.ack" | "desk.focus" | "desk.charge" | "desk.stand" }
  | { kind: "none" };

export function intentFor(source: Source, gesture: Gesture): Intent {
  if (source === "ring") {
    switch (gesture) {
      case "tap": return { kind: "local", do: "next" };
      case "double": return { kind: "action", action: "desk.focus" };
      case "up": return { kind: "action", action: "desk.stand" };
      case "down": return { kind: "local", do: "next" };
      case "long": return { kind: "action", action: "desk.charge" };
      default: return { kind: "none" };
    }
  }
  switch (gesture) {
    case "up": return { kind: "local", do: "prev" };
    case "down": return { kind: "local", do: "next" };
    case "tap": return { kind: "action", action: "hud.ack" };
    case "double": return { kind: "local", do: "exit" };
    default: return { kind: "none" };
  }
}
