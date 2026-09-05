export type TableRow = { id: string; [key: string]: string | number };
export type TableQuery = {
  search: string; facets: Record<string, string[]>; from: string; to: string;
  min: string; max: string; sort: string; direction: "asc" | "desc";
};
export function queryRows(rows: TableRow[], query: TableQuery, amountKey: string) {
  return rows.filter((row) => {
    if (query.search.trim() && !Object.values(row).join(" ").toLowerCase().includes(query.search.trim().toLowerCase())) return false;
    if (Object.entries(query.facets).some(([key, values]) => values.length && !values.includes(String(row[key])))) return false;
    if (query.from && String(row.date) < query.from) return false;
    if (query.to && String(row.date) > query.to) return false;
    const amount = Number(row[amountKey]);
    if (query.min !== "" && amount < Number(query.min)) return false;
    if (query.max !== "" && amount > Number(query.max)) return false;
    return true;
  }).sort((a, b) => {
    const x = a[query.sort], y = b[query.sort];
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return (query.direction === "asc" ? order : -order) || a.id.localeCompare(b.id);
  });
}
