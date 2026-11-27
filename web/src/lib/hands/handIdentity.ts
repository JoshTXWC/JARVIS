/**
 * Stable hand identity across frames.
 * Never trust MediaPipe hand order alone — use handedness + position continuity.
 */

export type Handedness = "Left" | "Right" | "Unknown";

export type TrackedHand = {
  id: number;
  handedness: Handedness;
  /** Wrist (landmark 0) in camera-normalized space. */
  wrist: { x: number; y: number };
  landmarks: Array<{ x: number; y: number; z?: number }>;
  score: number;
};

export type HandSlots = {
  dominant: TrackedHand | null;
  secondary: TrackedHand | null;
  /** True when identity was remapped this frame (filters should not jump). */
  remapped: boolean;
};

type Slot = {
  id: number;
  handedness: Handedness;
  wrist: { x: number; y: number };
  lostFrames: number;
};

const MAX_MATCH_DIST = 0.28;
const MAX_LOST = 12;

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeHandedness(raw: string | undefined | null): Handedness {
  if (!raw) return "Unknown";
  const s = String(raw).toLowerCase();
  if (s.startsWith("l")) return "Left";
  if (s.startsWith("r")) return "Right";
  return "Unknown";
}

export class HandIdentityTracker {
  private nextId = 1;
  private slots: Slot[] = [];
  private lastDominantId: number | null = null;

  reset() {
    this.slots = [];
    this.nextId = 1;
    this.lastDominantId = null;
  }

  /**
   * @param hands MediaPipe landmark arrays (order unstable)
   * @param handednessLabels parallel labels from MediaPipe ("Left"/"Right")
   * @param scores optional presence scores
   * @param primary preferred dominant side from settings ("right" | "left")
   */
  update(
    hands: Array<Array<{ x: number; y: number; z?: number }>>,
    handednessLabels: Array<string | undefined> = [],
    scores: number[] = [],
    primary: "right" | "left" = "right",
  ): HandSlots {
    const detections: TrackedHand[] = [];
    for (let i = 0; i < hands.length; i++) {
      const lm = hands[i];
      if (!lm || lm.length < 21) continue;
      detections.push({
        id: -1,
        handedness: normalizeHandedness(handednessLabels[i]),
        wrist: { x: lm[0].x, y: lm[0].y },
        landmarks: lm,
        score: scores[i] ?? 1,
      });
    }

    // Match detections → existing slots (greedy by distance, prefer same handedness).
    const usedDet = new Set<number>();
    const usedSlot = new Set<number>();
    const assignments: Array<{ slotIdx: number; detIdx: number; cost: number }> = [];

    for (let s = 0; s < this.slots.length; s++) {
      for (let d = 0; d < detections.length; d++) {
        const slot = this.slots[s];
        const det = detections[d];
        let cost = dist(slot.wrist, det.wrist);
        if (
          slot.handedness !== "Unknown" &&
          det.handedness !== "Unknown" &&
          slot.handedness !== det.handedness
        ) {
          cost += 0.15;
        } else if (
          slot.handedness !== "Unknown" &&
          det.handedness === slot.handedness
        ) {
          cost -= 0.05;
        }
        assignments.push({ slotIdx: s, detIdx: d, cost });
      }
    }
    assignments.sort((a, b) => a.cost - b.cost);

    const matched: TrackedHand[] = [];
    for (const a of assignments) {
      if (usedDet.has(a.detIdx) || usedSlot.has(a.slotIdx)) continue;
      if (a.cost > MAX_MATCH_DIST) continue;
      usedDet.add(a.detIdx);
      usedSlot.add(a.slotIdx);
      const slot = this.slots[a.slotIdx];
      const det = detections[a.detIdx];
      slot.wrist = det.wrist;
      slot.lostFrames = 0;
      if (det.handedness !== "Unknown") slot.handedness = det.handedness;
      matched.push({ ...det, id: slot.id, handedness: slot.handedness });
    }

    // New detections → new slots
    for (let d = 0; d < detections.length; d++) {
      if (usedDet.has(d)) continue;
      const det = detections[d];
      const id = this.nextId++;
      this.slots.push({
        id,
        handedness: det.handedness,
        wrist: det.wrist,
        lostFrames: 0,
      });
      matched.push({ ...det, id });
    }

    // Age unmatched slots
    for (let s = 0; s < this.slots.length; s++) {
      if (usedSlot.has(s)) continue;
      this.slots[s].lostFrames += 1;
    }
    this.slots = this.slots.filter((s) => s.lostFrames <= MAX_LOST);

    const wantRight = primary === "right";
    const byPreference = (h: TrackedHand) => {
      if (wantRight && h.handedness === "Right") return 0;
      if (!wantRight && h.handedness === "Left") return 0;
      if (h.handedness === "Unknown") return 1;
      return 2;
    };

    // Prefer continuity of last dominant id when still present.
    let dominant: TrackedHand | null = null;
    let remapped = false;
    if (this.lastDominantId != null) {
      dominant = matched.find((h) => h.id === this.lastDominantId) ?? null;
    }
    if (!dominant && matched.length) {
      const sorted = [...matched].sort((a, b) => byPreference(a) - byPreference(b));
      dominant = sorted[0];
      remapped = this.lastDominantId != null && this.lastDominantId !== dominant.id;
    }
    if (dominant) this.lastDominantId = dominant.id;
    else this.lastDominantId = null;

    const secondary =
      matched.find((h) => !dominant || h.id !== dominant.id) ?? null;

    return { dominant, secondary, remapped };
  }
}
