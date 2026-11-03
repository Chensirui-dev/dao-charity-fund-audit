import { useMemo, useState } from 'react';

type Direction = 'asc' | 'desc';

export function useSortable<T>(data: T[]) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [direction, setDirection] = useState<Direction>('desc');

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      let result = av > bv ? 1 : -1;
      if (typeof av === 'string' && typeof bv === 'string' && /^\d+$/.test(av) && /^\d+$/.test(bv)) {
        const aBig = BigInt(av);
        const bBig = BigInt(bv);
        result = aBig === bBig ? 0 : aBig > bBig ? 1 : -1;
      }
      return direction === 'asc' ? result : -result;
    });
  }, [data, sortKey, direction]);

  const toggleSort = (key: keyof T) => {
    if (sortKey === key) {
      setDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDirection('desc');
    }
  };

  return { sortedData, sortKey, direction, toggleSort };
}
