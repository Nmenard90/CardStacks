/**
 * frameStep.js — the time step every easing in the room moves by in one frame.
 *
 * The room only draws while something changes (RenderOnChange.jsx), so the time since the last drawn frame is
 * seconds when it has been sitting still. Easing by that much arrived in one frame: a tap made the camera, a page
 * turn or a card jump straight to its end instead of moving there. A gap that long means a new move is starting,
 * so it counts as one ordinary frame; a slow frame while moving still counts in full (capped), so a move takes
 * about the same time on a slow computer, in fewer, bigger steps.
 */
const IDLE_GAP = 0.25; // seconds: longer than any frame while the room is actually moving
const FIRST_STEP = 1 / 60;
const MAX_STEP = 0.1;

/** @param {number} delta  seconds since the last drawn frame (R3F's useFrame delta) */
export const frameStep = (delta) => (delta > IDLE_GAP ? FIRST_STEP : Math.min(delta, MAX_STEP));
