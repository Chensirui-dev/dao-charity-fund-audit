import { useEffect, useMemo, useRef, useState } from 'react';

export function useCountdown(endTime: number, onComplete?: () => void) {
  const [remaining, setRemaining] = useState(() => Math.max(0, endTime - Date.now()));
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    const timer = window.setInterval(() => {
      const next = Math.max(0, endTime - Date.now());
      setRemaining(next);
      if (next === 0 && !completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [endTime, onComplete]);

  return useMemo(() => {
    const secondsTotal = Math.floor(remaining / 1000);
    const days = Math.floor(secondsTotal / 86400);
    const hours = Math.floor((secondsTotal % 86400) / 3600);
    const minutes = Math.floor((secondsTotal % 3600) / 60);
    const seconds = secondsTotal % 60;
    return { days, hours, minutes, seconds, finished: remaining === 0 };
  }, [remaining]);
}
