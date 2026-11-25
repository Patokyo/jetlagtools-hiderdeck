// Pointer-based drag tracking. One code path for touch, mouse and pen.

const MOVE_SLOP = 6;

/**
 * Track a drag on an element.
 *
 * Handlers receive totals relative to the pointerdown position:
 *   onMove / onEnd -> { x, y, vx, vy }  (velocities in px/ms)
 *
 * @returns {() => void} detach
 */
export function trackDrag(el, { allow, onStart, onMove, onEnd, onCancel } = {}) {
  let gesture = null;

  function onPointerDown(event) {
    if (gesture) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (allow && !allow(event)) return;

    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      startTime: performance.now(),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      moved: false,
    };

    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }

    el.classList.add("is-dragging");
    event.preventDefault();
    onStart?.(event);
  }

  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.id) return;

    const now = performance.now();
    const stepX = event.clientX - gesture.lastX;
    const stepY = event.clientY - gesture.lastY;
    const stepTime = Math.max(8, now - gesture.lastTime);

    // Exponential smoothing so a single jittery sample can't fake a flick.
    gesture.vx = gesture.vx * 0.55 + (stepX / stepTime) * 0.45;
    gesture.vy = gesture.vy * 0.55 + (stepY / stepTime) * 0.45;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.lastTime = now;

    gesture.x = event.clientX - gesture.startX;
    gesture.y = event.clientY - gesture.startY;
    if (Math.hypot(gesture.x, gesture.y) > MOVE_SLOP) gesture.moved = true;

    onMove?.({ x: gesture.x, y: gesture.y, vx: gesture.vx, vy: gesture.vy });
  }

  function finish(event, cancelled) {
    if (!gesture || event.pointerId !== gesture.id) return;

    const done = gesture;
    gesture = null;

    try {
      el.releasePointerCapture(done.id);
    } catch {
      /* already released */
    }

    el.classList.remove("is-dragging");
    const payload = {
      x: done.x,
      y: done.y,
      vx: done.vx,
      vy: done.vy,
      moved: done.moved,
      duration: performance.now() - done.startTime,
    };

    if (cancelled) onCancel?.(payload);
    else onEnd?.(payload);
  }

  function onPointerUp(event) {
    finish(event, false);
  }

  function onPointerCancel(event) {
    finish(event, true);
  }

  el.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);

  return function detach() {
    el.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  };
}
