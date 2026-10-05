export type TableRow = { id: string; [key: string]: string | number };
export type TableQuery = {
  search: string; facets: Record<string, string[]>; from: string; to: string;
  min: string; max: string; amountSign?: "any" | "negative" | "positive"; sort: string; direction: "asc" | "desc";
};
export function queryRows(rows: TableRow[], query: TableQuery, amountKey?: string) {
  const min = query.min !== "" ? Number(query.min) : null;
  const max = query.max !== "" ? Number(query.max) : null;
  const signedRange = (min !== null && min < 0) || (max !== null && max < 0);
  return rows.filter((row) => {
    if (query.search.trim() && !Object.values(row).join(" ").toLowerCase().includes(query.search.trim().toLowerCase())) return false;
    if (Object.entries(query.facets).some(([key, values]) => values.length && !values.includes(String(row[key])))) return false;
    if (query.from && String(row.date) < query.from) return false;
    if (query.to && String(row.date) > query.to) return false;
    if (amountKey) {
      const signedAmount = Number(row[amountKey]);
      if (query.amountSign === "negative" && signedAmount >= 0) return false;
      if (query.amountSign === "positive" && signedAmount <= 0) return false;
      const amount = signedRange ? signedAmount : Math.abs(signedAmount);
      if (min !== null && amount < min) return false;
      if (max !== null && amount > max) return false;
    }
    return true;
  }).sort((a, b) => {
    const x = a[query.sort], y = b[query.sort];
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return (query.direction === "asc" ? order : -order) || a.id.localeCompare(b.id);
  });
}
