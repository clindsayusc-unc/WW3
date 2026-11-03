/**
 * Bridge to the native shell (Tauri v2, D-083). Everything here degrades to a no-op in a
 * browser, so the web build and the e2e tests run unchanged.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

export function isNative(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function nativeInvoke<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

/**
 * Toggles fullscreen: the native window in the app, the Fullscreen API in a browser. Resolves
 * with the new state.
 */
export async function toggleFullscreen(): Promise<boolean> {
  if (isNative()) return nativeInvoke<boolean>('toggle_fullscreen');
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return false;
  }
  await document.documentElement.requestFullscreen();
  return true;
}

export interface AutoplayConfig {
  turns: number;
  nation: string;
}

/** The unattended verification run requested by `WW3_AUTOPLAY` (native only). */
export async function autoplayConfig(): Promise<AutoplayConfig | null> {
  if (!isNative()) return null;
  try {
    return await nativeInvoke<AutoplayConfig | null>('autoplay_config');
  } catch {
    return null;
  }
}

export function autoplayDone(report: unknown): Promise<void> {
  return nativeInvoke('autoplay_done', { report: JSON.stringify(report, null, 2) });
}
