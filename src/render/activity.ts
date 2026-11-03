/**
 * Render activity (D-082): layers that animate something the player is watching (a camera
 * flight, a strike arc) keep the globe at full frame rate; otherwise the scheduler in Scene.tsx
 * lowers the cadence once the player has been idle for a while.
 */
let busyUntil = 0;
let lastInput = 0;

/** Keeps full frame rate for at least `ms` from now. */
export function keepAwake(now: number, ms = 250): void {
  busyUntil = Math.max(busyUntil, now + ms);
}
export function isBusy(now: number): boolean {
  return now < busyUntil;
}
export function noteInput(now: number): void {
  lastInput = now;
}
export function idleSeconds(now: number): number {
  return (now - lastInput) / 1000;
}
