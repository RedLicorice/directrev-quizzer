import { useState, useEffect, useRef } from 'react';

export function useTimer(totalSeconds: number, onExpire?: () => void) {
  const [elapsed, setElapsed] = useState(0);
  const callbackRef = useRef(onExpire);
  callbackRef.current = onExpire;

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((e) => {
        const next = e + 1;
        if (totalSeconds > 0 && next >= totalSeconds) {
          clearInterval(id);
          callbackRef.current?.();
          return totalSeconds;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [totalSeconds]);

  const remaining = totalSeconds > 0 ? totalSeconds - elapsed : null;
  return { elapsed, remaining };
}

export function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
