"use client";

import { useId, useState } from "react";
import { money, today } from "../../lib/workspace-types";
import { queryRows, type TableQuery, type TableRow } from "../../lib/table-query";

export type Column = { key: string; label: string; money?: boolean; detail?: boolean };
type Props = { title: string; rows: TableRow[]; columns: Column[]; facets: { key: string; label: string }[]; dated?: boolean; amountKey: string; amountLabel: string; onRow?: (row: TableRow) => void; initialCategory?: string };

export function SearchFilter({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  const [search, setSearch] = useState("");
  const id = useId();
  return <details className="filter-menu" name="workspace-filters" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary>{label}{value.length > 0 && <span className="filter-count">{value.length}</span>} <span aria-hidden="true">⌄</span></summary>
    <div className="filter-popover"><input aria-label={"Search " + label} type="search" placeholder={"Find " + label.toLowerCase()} value={search} onChange={e => setSearch(e.target.value)} />
      <button type="button" className="text-link" onClick={() => onChange([])}>Clear {label.toLowerCase()}</button>
      <div className="filter-options">{options.filter(option => option.toLowerCase().includes(search.toLowerCase())).map((option, i) =>
        <label key={option} htmlFor={id + i}><input id={id + i} type="checkbox" checked={value.includes(option)} onChange={() => onChange(value.includes(option) ? value.filter(x => x !== option) : [...value, option])} />{option || "Unspecified"}</label>)}
      {options.filter(option => option.toLowerCase().includes(search.toLowerCase())).length === 0 && <p>No matches</p>}</div>
    </div></details>;
}

function defaultQuery(dated: boolean, category?: string): TableQuery {
  const start = new Date(); start.setDate(start.getDate() - 29);
  const from = [start.getFullYear(), String(start.getMonth()+1).padStart(2, "0"), String(start.getDate()).padStart(2, "0")].join("-");
  return { search: "", facets: category ? { category: [category] } : {}, from: dated && !category ? from : "", to: dated && !category ? today() : "", min: "", max: "", sort: dated ? "date" : "name", direction: dated ? "desc" : "asc" };
}

export default function DataTable({ title, rows, columns, facets, dated = false, amountKey, amountLabel, onRow, initialCategory }: Props) {
  const [query, setQuery] = useState<TableQuery>(() => defaultQuery(dated, initialCategory));
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [range, setRange] = useState(dated && !initialCategory ? "30" : "all");
  const [extra, setExtra] = useState(false);
  const update = (change: Partial<TableQuery>) => { setQuery(current => ({ ...current, ...change })); setPage(0); };
  const filtered = queryRows(rows, query, amountKey);
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), safePage = Math.min(page, pages - 1);
  const visible = filtered.slice(safePage * 25, (safePage + 1) * 25);
  const invalidRange = Boolean((query.from && query.to && query.from > query.to) || (query.min !== "" && query.max !== "" && Number(query.min) > Number(query.max)));
  function sort(key: string) { update({ sort: key, direction: query.sort === key && query.direction === "asc" ? "desc" : "asc" }); }
  const summaryAmount = filtered.reduce((sum, row) => sum + Number(row[amountKey]), 0);
  return <section className="data-panel" aria-label={title + " table"}>
    <div className="table-toolbar">
      <label className="table-search"><span className="sr-only">Search {title}</span><input type="search" placeholder={"Search " + title.toLowerCase() + "…"} value={query.search} onChange={e => update({ search: e.target.value })} /></label>
      <button className="secondary-button" aria-expanded={extra} onClick={() => setExtra(!extra)}>Filters & sort</button>
    </div>
    <div className="table-presets">
      {dated && <div className="segmented" aria-label="Date range">{[["30", "Last 30 days"], ["all", "All dates"], ["custom", "Custom dates"]].map(([key, label]) => <button key={key} aria-pressed={range === key} onClick={() => { setRange(key); update(key === "30" ? { from: defaultQuery(true).from, to: today() } : { from: "", to: "" }); }}>{label}</button>)}</div>}
      {facets.map(facet => <SearchFilter key={facet.key} label={facet.label} options={[...new Set(rows.map(row => String(row[facet.key])))].sort()} value={query.facets[facet.key] ?? []} onChange={value => update({ facets: { ...query.facets, [facet.key]: value } })} />)}
    </div>
    {range === "custom" && dated && <div className="table-advanced"><label>From<input type="date" value={query.from} onChange={e => update({ from: e.target.value })} /></label><label>Through<input type="date" value={query.to} onChange={e => update({ to: e.target.value })} /></label></div>}
    {extra && <div className="table-advanced">
      <label>Minimum {amountLabel.toLowerCase()}<input type="number" step="0.01" placeholder="No minimum" value={query.min} onChange={e => update({ min: e.target.value })} /></label>
      <label>Maximum {amountLabel.toLowerCase()}<input type="number" step="0.01" placeholder="No maximum" value={query.max} onChange={e => update({ max: e.target.value })} /></label>
      <div className="sort-options"><span>Sort by</span>{columns.map(c => <button key={c.key} aria-pressed={query.sort === c.key} onClick={() => sort(c.key)}>{c.label}{query.sort === c.key ? query.direction === "asc" ? " ↑" : " ↓" : ""}</button>)}</div>
    </div>}
    <div className="active-filters">{Object.entries(query.facets).flatMap(([key, values]) => values.map(value => <button key={key+value} onClick={() => update({ facets: { ...query.facets, [key]: values.filter(v => v !== value) } })} aria-label={"Remove filter " + value}>{value} ×</button>))}</div>
    <div className="table-summary" aria-live="polite"><span>{filtered.length} of {rows.length} {title.toLowerCase()} · {amountLabel}: <strong>{money(summaryAmount)}</strong></span><button className="text-link" onClick={() => { setRange("all"); update({ ...defaultQuery(false), sort: dated ? "date" : "name", direction: dated ? "desc" : "asc" }); }}>Reset filters</button></div>
    {invalidRange && <p role="alert" className="form-error">The start or minimum must be no greater than the end or maximum.</p>}
    <table className="workspace-table"><caption className="sr-only">{title} — {filtered.length} matching rows</caption><thead><tr>{columns.map(c => <th key={c.key} aria-sort={query.sort === c.key ? query.direction === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => sort(c.key)}>{c.label} {query.sort === c.key ? query.direction === "asc" ? "↑" : "↓" : "↕"}</button></th>)}<th><span className="sr-only">Details</span></th></tr></thead>
      <tbody>{visible.map(row => <tr key={row.id} className={expanded === row.id ? "row-expanded" : ""}>{columns.map((c, index) => <td key={c.key} data-label={c.label} className={(index === 0 ? "row-title " : "") + (c.detail ? "row-detail " : "") + (c.money ? "numeric" : "")}>
        {index === 0 && onRow ? <button className="text-link" onClick={() => onRow(row)}>{String(row[c.key])}</button> : c.money ? <span className={Number(row[c.key]) < 0 ? "negative" : ""}>{money(Number(row[c.key]))}</span> : String(row[c.key])}
      </td>)}<td className="row-toggle"><button className="text-link" aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Less" : "Details"}</button></td></tr>)}</tbody>
    </table>
    {visible.length === 0 && <div className="table-empty"><h3>{rows.length ? "No matches" : "Nothing here yet"}</h3><p>{rows.length ? "Try changing your date range or clearing a filter." : "Use the add button above to create your first entry."}</p></div>}
    <div className="table-pagination"><span>Page {safePage + 1} of {pages} · 25 per page</span><div><button className="secondary-button" disabled={safePage === 0} onClick={() => setPage(safePage-1)}>Previous</button><button className="secondary-button" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage+1)}>Next</button></div></div>
  </section>;
}
