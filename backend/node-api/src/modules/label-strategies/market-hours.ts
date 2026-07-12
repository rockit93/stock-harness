type MarketSchedule = {
  timeZone: string;
  sessions: Array<[number, number]>;
};

export type MarketPhase = "pre_market" | "market" | "post_market";

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
  return isTradingSession(market, ["market"], now);
}

export function isTradingSession(market: string, enabledPhases: MarketPhase[], now = new Date()) {
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
  const marketStart = schedule.sessions[0][0];
  const marketEnd = schedule.sessions.at(-1)![1];
  const phaseRanges: Record<MarketPhase, Array<[number, number]>> = {
    pre_market: [[Math.max(0, marketStart - 120), marketStart]],
    market: schedule.sessions,
    post_market: [[marketEnd, Math.min(24 * 60, marketEnd + 240)]],
  };
  return enabledPhases.some((phase) => phaseRanges[phase]?.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end));
}
