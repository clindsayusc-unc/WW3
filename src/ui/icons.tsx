/** Screen icon component (maps in iconMaps.ts, D-080). */
import { SCREEN_ICON, type ScreenId } from './iconMaps';

/** A screen icon at the standard header size. */
export function ScreenIcon({ id, size = 18 }: { id: ScreenId; size?: number }) {
  const I = SCREEN_ICON[id];
  return <I size={size} aria-hidden="true" strokeWidth={1.75} />;
}
