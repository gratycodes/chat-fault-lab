'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextFollowing } from '@/lib/follow';

const GESTURE_WINDOW_MS = 250;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/**
 * Keep a scroll container pinned to the bottom while content grows, without
 * fighting the user. Content growth is observed with a ResizeObserver and the
 * follow scroll is instant (no smooth-scroll animation racing new tokens).
 */
export function useFollow<T extends HTMLElement, C extends HTMLElement>() {
  const scrollRef = useRef<T>(null);
  const contentRef = useRef<C>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const lastGesture = useRef(0);
  const lastTop = useRef(0);

  const setFollow = useCallback((v: boolean) => {
    followingRef.current = v;
    setFollowing(v);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    const gesture = () => {
      lastGesture.current = performance.now();
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) gesture();
    };
    const onPointer = (e: PointerEvent) => {
      // Pointer down on the container itself (not a child) is the scrollbar.
      if (e.target === el) gesture();
    };
    const onScroll = () => {
      const deltaY = el.scrollTop - lastTop.current;
      lastTop.current = el.scrollTop;
      const next = nextFollowing({
        following: followingRef.current,
        distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
        deltaY,
        userGesture: performance.now() - lastGesture.current < GESTURE_WINDOW_MS,
      });
      if (next !== followingRef.current) setFollow(next);
    };
    const ro = new ResizeObserver(() => {
      if (followingRef.current) {
        el.scrollTop = el.scrollHeight;
        lastTop.current = el.scrollTop;
      }
    });
    ro.observe(content);
    el.addEventListener('wheel', gesture, { passive: true });
    el.addEventListener('touchmove', gesture, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onPointer);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', gesture);
      el.removeEventListener('touchmove', gesture);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onPointer);
      el.removeEventListener('scroll', onScroll);
    };
  }, [setFollow]);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setFollow(true);
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [setFollow]);

  /** Re-pin on a deliberate boundary, like sending a new message. */
  const pin = useCallback(() => {
    const el = scrollRef.current;
    setFollow(true);
    if (el) el.scrollTop = el.scrollHeight;
  }, [setFollow]);

  return { scrollRef, contentRef, following, jumpToLatest, pin };
}
