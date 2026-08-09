
// -------------------- Pagination helpers --------------------
 
const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 50;
 
export function parsePagination(query: Record<string, any>) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
 
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_PAGE_SIZE;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
 
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
 
export function buildPaginationMeta(page: number, limit: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}