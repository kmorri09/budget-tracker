const DAY_MS = 24 * 60 * 60 * 1000;
const PAY_PERIOD_MS = 14 * DAY_MS;
const dateOnly = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export function paycheckWindow(anchorDate: string, today: string) {
  const anchor = Date.parse(`${anchorDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  const periods = Math.max(0, Math.ceil((current - anchor) / PAY_PERIOD_MS));
  const payday = anchor + periods * PAY_PERIOD_MS;
  return { startDate: dateOnly(payday - PAY_PERIOD_MS + DAY_MS), nextDate: dateOnly(payday) };
}
