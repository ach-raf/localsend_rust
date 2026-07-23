import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pull-to-refresh for touch devices.
 *
 * The app is a page-scroll layout (the WebView body scrolls), so this hook
 * attaches touch listeners to the window. A drag only counts when the page is
 * scrolled to the very top; below the fold, native scrolling wins and the
 * gesture is ignored so it never competes with reading a long peer list.
 *
 * The dragged content is translated with elastic damping (the pull gets harder
 * the further you drag, like the native feel), and snapping back is animated
 * with a CSS transition. The indicator is surfaced via `pullDistance` so the
 * caller can render whatever spinner/text it likes.
 *
 * `prefers-reduced-motion` is honored: the gesture still triggers a refresh but
 * the caller is expected to skip the elastic transform when it is set.
 */

interface PullToRefreshOptions {
  /** Vertical travel (px, undamped) required to arm a refresh on release. */
  threshold?: number;
  /** Max visual pull distance (px) before the damping makes it nearly stop. */
  maxPull?: number;
  /** Resistance applied to raw finger travel. 0.5 = half speed. */
  resistance?: number;
  /** Async refresh action. The indicator stays "refreshing" until it resolves. */
  onRefresh: () => Promise<void> | void;
  /** Only active when true. Use this to gate the hook to touch/Android. */
  enabled?: boolean;
}

interface PullToRefreshResult {
  /** Whether a refresh is currently in-flight (for showing a spinner). */
  refreshing: boolean;
  /** Current damped pull distance in px (0 when idle). Drives the indicator. */
  pullDistance: number;
  /** Whether the pull has crossed the threshold (for styling "release to refresh"). */
  armed: boolean;
}

export function usePullToRefresh({
  threshold = 70,
  maxPull = 120,
  resistance = 0.5,
  onRefresh,
  enabled = true,
}: PullToRefreshOptions): PullToRefreshResult {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  // Refs hold the live gesture state so the window listeners (bound once) can
  // read current values without being re-created on every render.
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const refreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const enabledRef = useRef(enabled);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  // Maps a raw finger delta to the damped visual pull. Early pixels come through
  // at full resistance; as you approach maxPull the curve flattens so the content
  // feels like it's hitting a spring, not sliding freely.
  const dampen = useCallback(
    (raw: number) => {
      const d = raw * resistance;
      return maxPull * (1 - Math.exp((-3 * d) / maxPull));
    },
    [maxPull, resistance]
  );

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      // Only begin a pull when the page is pinned to the top — anywhere lower and
      // the user is scrolling the list, not requesting a refresh.
      if (window.scrollY > 0) return;
      if (e.touches.length !== 1) return;
      draggingRef.current = true;
      startYRef.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        // Swiping up — just scrolling. Reset any tiny accumulated pull.
        if (pullDistanceRef.current !== 0) setPullDistance(0);
        draggingRef.current = false;
        return;
      }
      // Pulling down past the top: prevent the browser's own overscroll so our
      // indicator is the only thing that moves.
      e.preventDefault();
      setPullDistance(dampen(dy));
    };

    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const current = pullDistanceRef.current;
      if (current >= threshold) {
        // Threshold crossed → trigger refresh; hold the indicator at a resting
        // offset while onRefresh runs, then spring back when it resolves.
        setPullDistance(threshold * 0.55);
        refreshingRef.current = true;
        setRefreshing(true);
        Promise.resolve(onRefreshRef.current())
          .catch(() => undefined)
          .finally(() => {
            refreshingRef.current = false;
            setRefreshing(false);
            setPullDistance(0);
          });
      } else {
        // Released too early — spring back to zero.
        setPullDistance(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    // move must be non-passive (cancelable) so preventDefault() can suppress the
    // native overscroll bounce.
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endDrag, { passive: true });
    window.addEventListener("touchcancel", endDrag, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endDrag);
      window.removeEventListener("touchcancel", endDrag);
    };
  }, [enabled, threshold, dampen]);

  return {
    refreshing,
    pullDistance,
    armed: pullDistance >= threshold,
  };
}
