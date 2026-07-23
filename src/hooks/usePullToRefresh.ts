import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Pull-to-refresh for touch devices.
 *
 * The app is a page-scroll layout (the WebView body scrolls), so this hook
 * attaches touch listeners to the window. A drag only counts when the page is
 * scrolled to the very top; below the fold, native scrolling wins and the
 * gesture is ignored so it never competes with reading a long peer list.
 *
 * ## Why this drives the DOM directly
 * touchmove fires ~60-120×/s. If each event went through React state the whole
 * host tree would re-render on every frame and the gesture would jank. Instead
 * the content's translateY and the spinner's rotation are written straight to
 * the DOM via refs (compositor-friendly, frame-accurate), and React only learns
 * about *discrete* transitions — `armed` (crossed the threshold) and
 * `refreshing` (a refresh is in flight). The continuous pull strength is also
 * published as a `--ptr-progress` CSS variable (0..1) so the caller's indicator
 * can fade/scale in CSS without any re-render.
 *
 * `prefers-reduced-motion` is honored in CSS (spinner/transition disabled).
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
  /** The scrollable content element, translated vertically during the pull. */
  contentRef: RefObject<HTMLElement | null>;
  /** The refresh icon: rotated while pulling, spun by CSS while refreshing. */
  spinnerRef?: RefObject<HTMLElement | null>;
}

interface PullToRefreshResult {
  /** Whether a refresh is currently in-flight (for showing a spinner). */
  refreshing: boolean;
  /** Whether the pull has crossed the threshold (for "release to refresh"). */
  armed: boolean;
}

export function usePullToRefresh({
  threshold = 80,
  maxPull = 140,
  resistance = 0.5,
  onRefresh,
  enabled = true,
  contentRef,
  spinnerRef,
}: PullToRefreshOptions): PullToRefreshResult {
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);

  // Refs hold the live gesture state so the window listeners (bound once) can
  // read current values without being re-created on every render.
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const pullRef = useRef(0); // current damped pull (px)
  const armedRef = useRef(false);
  const refreshingRef = useRef(false);
  const enabledRef = useRef(enabled);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

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

  // Write the current pull straight to the DOM. `animate` enables the snap
  // transition used on release / resting; during an active drag it's false so
  // the content sticks to the finger 1:1.
  const applyVisual = useCallback(
    (damped: number, animate: boolean) => {
      pullRef.current = damped;
      const content = contentRef.current;
      if (content) {
        content.style.willChange = "transform";
        content.style.transition = animate
          ? "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)"
          : "none";
        content.style.transform =
          damped > 0 ? `translate3d(0, ${damped}px, 0)` : "";
        if (damped <= 0 && !animate) content.style.willChange = "";
      }
      // Wind the icon one full turn as the pull arms — a tactile "winding up"
      // cue. Handed off to the CSS spin animation once refreshing starts.
      const spinner = spinnerRef?.current;
      if (spinner && !refreshingRef.current) {
        const p = threshold > 0 ? Math.min(damped / threshold, 1) : 0;
        spinner.style.transform = `rotate(${p * 360}deg)`;
      }
      // Publish pull strength for CSS consumers (indicator fade/scale). Cheap:
      // runs on the compositor, never triggers a React render.
      const progress = threshold > 0 ? Math.min(damped / threshold, 1) : 0;
      document.documentElement.style.setProperty(
        "--ptr-progress",
        progress.toFixed(3)
      );
    },
    [contentRef, spinnerRef, threshold]
  );

  // Reset to the idle state.
  const reset = useCallback(
    (animate: boolean) => {
      draggingRef.current = false;
      armedRef.current = false;
      setArmed(false);
      applyVisual(0, animate);
    },
    [applyVisual]
  );

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      // Only begin a pull when the page is pinned to the top — anywhere lower
      // and the user is scrolling the list, not requesting a refresh.
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
        if (pullRef.current !== 0) reset(false);
        return;
      }
      // Pulling down past the top: prevent the browser's own overscroll so our
      // indicator is the only thing that moves.
      e.preventDefault();
      const damped = dampen(dy);
      applyVisual(damped, false);
      const isArmed = damped >= threshold;
      if (isArmed !== armedRef.current) {
        armedRef.current = isArmed;
        setArmed(isArmed); // discrete change only — no per-frame re-renders
      }
    };

    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (armedRef.current) {
        // Threshold crossed → hold the indicator at a resting offset while the
        // refresh runs, then spring back when it resolves.
        applyVisual(threshold * 0.5, true);
        refreshingRef.current = true;
        // Hand the spinner over to the CSS spin animation.
        if (spinnerRef?.current) spinnerRef.current.style.transform = "";
        setRefreshing(true);
        Promise.resolve(onRefreshRef.current())
          .catch(() => undefined)
          .finally(() => {
            refreshingRef.current = false;
            setRefreshing(false);
            armedRef.current = false;
            setArmed(false);
            applyVisual(0, true);
          });
      } else {
        // Released too early — spring back to zero.
        reset(true);
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
  }, [enabled, threshold, dampen, applyVisual, reset, spinnerRef]);

  return { refreshing, armed };
}
