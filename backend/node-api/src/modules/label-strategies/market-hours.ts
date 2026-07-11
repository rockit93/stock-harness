type MarketSchedule = {
  timeZone: string;
  sessions: Array<[number, number]>;
};

const MARKET_SCHEDULES: Record<string, MarketSchedule> = {
  "A Share": {
    timeZone: "Asia/Shanghai",
    sessions: [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]],
  },
  "Hong Kong": {
    timeZone: "Asia/Hong_Kong",
    sessions: [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60]],
  },
  US: {
    timeZone: "America/New_York",
    sessions: [[9 * 60 + 30, 16 * 60]],
  },
};

export function isMarketOpen(market: string, now = new Date()) {
  const schedule = MARKET_SCHEDULES[market];
  if (!schedule) return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;

  const minuteOfDay = Number(value("hour")) * 60 + Number(value("minute"));
  return schedule.sessions.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end);
}
