export function organizationCapacity(used: number, limit: number) {
  const safeUsed = Math.max(0, Number.isFinite(used) ? used : 0);
  const safeLimit = Math.max(0, Number.isFinite(limit) ? limit : 0);
  const percentage = safeLimit > 0 ? Math.round((safeUsed / safeLimit) * 100) : null;
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - safeUsed),
    percentage,
    bar: percentage === null ? (safeUsed ? 100 : 0) : Math.min(100, percentage),
    label:
      safeUsed > safeLimit
        ? 'Over capacity'
        : safeLimit === 0
          ? 'Zero capacity'
          : safeUsed === safeLimit
            ? 'At capacity'
            : 'Capacity available',
  };
}
