// cameraHub.js: shared state of the cameras running in the admin console. Each CameraRunner writes
// its camera's state here (stream, detections, live status, recording); popups and panels read it.
// Lets a camera keep streaming, detecting and recording while its popup is closed.
import { useSyncExternalStore } from "react";

const states = new Map();    // camId -> state object
const actions = new Map();   // camId -> { toggleRecord }
const listeners = new Set();
const EMPTY = Object.freeze({ status: "off" });
let version = 0;

export const hub = {
  get: (id) => states.get(id) ?? EMPTY,
  set(id, patch) {
    states.set(id, { ...(states.get(id) ?? {}), ...(typeof patch === "function" ? patch(states.get(id) ?? {}) : patch) });
    version++; listeners.forEach((l) => l());
  },
  remove(id) { states.delete(id); actions.delete(id); version++; listeners.forEach((l) => l()); },
  setActions: (id, a) => actions.set(id, a),
  action: (id) => actions.get(id) ?? {},
  all: () => states,
};

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
/** One camera's state; re-renders when it changes. */
export const useCam = (id) => useSyncExternalStore(subscribe, () => hub.get(id));
/** Re-renders on any camera change (for summary panels). */
export const useHubVersion = () => useSyncExternalStore(subscribe, () => version);
