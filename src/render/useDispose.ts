import { useEffect } from 'react';

/**
 * Frees GPU resources made with `useMemo` (materials, textures) when they are replaced or the
 * layer unmounts (D-082). Objects React Three Fiber creates from JSX are disposed by it already;
 * the ones handed over as `material={…}` or `<primitive>` are not.
 */
export function useDispose(...items: ({ dispose: () => void } | null | undefined)[]): void {
  useEffect(
    () => () => {
      for (const i of items) i?.dispose();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    items,
  );
}
