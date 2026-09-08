type NamedCategory = { id: string; name: string };
type DatedAllocation = { category: string; date: string };

function daysBefore(isoDate: string, count: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

export function categoriesAllocatedInLastDays<T extends NamedCategory>(categories: T[], allocations: DatedAllocation[], throughDate: string, dayCount = 28) {
  const cutoff = daysBefore(throughDate, dayCount - 1);
  const latestByCategory = new Map<string, string>();
  for (const allocation of allocations) {
    if (allocation.date < cutoff || allocation.date > throughDate) continue;
    const previous = latestByCategory.get(allocation.category);
    if (!previous || allocation.date > previous) latestByCategory.set(allocation.category, allocation.date);
  }
  return categories
    .filter(category => latestByCategory.has(category.name))
    .sort((a, b) => (latestByCategory.get(b.name) ?? "").localeCompare(latestByCategory.get(a.name) ?? "") || a.name.localeCompare(b.name));
}
