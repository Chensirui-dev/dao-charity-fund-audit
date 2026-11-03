import { useMemo, useState } from 'react';

export function usePagination<T>(data: T[], pageSize = 10) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageData = useMemo(
    () => data.slice((safePage - 1) * pageSize, safePage * pageSize),
    [data, pageSize, safePage],
  );

  return {
    page: safePage,
    totalPages,
    pageData,
    setPage,
    next: () => setPage((value) => Math.min(totalPages, value + 1)),
    prev: () => setPage((value) => Math.max(1, value - 1)),
  };
}
