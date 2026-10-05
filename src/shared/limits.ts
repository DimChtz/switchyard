/**
 * Usage limits in an agent's terminal: "Claude usage limit reached. Your
 * limit will reset at 3pm (Europe/Athens)", "You've hit your usage limit
 * … try again in 2 hours 13 minutes", "Quota exceeded … retry in 30s" -
 * that it hit one, and when it resets if it says.
 */

const LIMIT_RE =
  /usage limit|rate limit (?:reached|exceeded)|limit (?:reached|hit)|hit your (?:usage |rate |weekly |daily )?limit|reached your (?:usage |weekly |daily )?limit|quota (?:exceeded|exhausted)|exhausted your (?:daily )?quota|out of (?:credits|premium requests)|(?:5-hour|weekly|session) limit/i

export interface LimitHit {
  /** When it resets (ms), if it said. */
  resetAt: number | null
  /** The line that said so. */
  text: string
}

/**
 * The limit message among the last lines of a screen (an earlier one, or
 * the agent talking about rate limits in code, isn't it).
 */
export function findLimit(screen: string, now: number, lastLines = 12): LimitHit | null {
  const lines = screen.split('\n').slice(-lastLines)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!LIMIT_RE.test(lines[i])) continue
    const around = lines.slice(Math.max(0, i - 1), i + 4).join(' ')
    return { resetAt: parseReset(around, now), text: lines[i].trim().slice(0, 200) }
  }
  return null
}

const UNIT: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, d: 86_400_000 }

/** When the limit resets, from what the message says: a timestamp, "in 2h 13m", "at 3pm (Zone)". */
export function parseReset(s: string, now: number): number | null {
  // Claude Code's older form: "…limit reached|1767268800".
  const epoch = s.match(/\|(\d{10})\b/)
  if (epoch) return Number(epoch[1]) * 1000
  const rel = s.match(/\b(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b[\s,]*(?:and\s+)?)+)/i)
  if (rel && /(?:try|retry|again|reset|available|wait)/i.test(s)) {
    let ms = 0
    for (const m of rel[1].matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)/gi)) ms += Number(m[1]) * UNIT[m[2].toLowerCase()]
    if (ms > 0) return now + ms
  }
  const at = s.match(/(?:resets?|reset at|try again at|available again at|until)\s*(?:at\s+|on\s+)?(?:([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i)
  if (at && (at[4] || at[5])) {
    let h = Number(at[3])
    const min = Number(at[4] ?? 0)
    const ap = at[5]?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h > 23 || min > 59) return null
    return atClock(now, h, min, at[6], at[1] ? { month: at[1], day: Number(at[2]) } : undefined)
  }
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The next time it's h:m in the zone (or on the given day) - the zone's own clock, local when unknown. */
function atClock(now: number, h: number, m: number, zone?: string, date?: { month: string; day: number }): number {
  const offset = zoneOffset(now, zone)
  // The zone's current date, as if it were UTC.
  const there = new Date(now + offset)
  let y = there.getUTCFullYear()
  let mo = there.getUTCMonth()
  let d = there.getUTCDate()
  if (date) {
    const i = MONTHS.indexOf(date.month.slice(0, 3).toLowerCase())
    if (i >= 0) {
      mo = i
      d = date.day
      if (Date.UTC(y, mo, d) < Date.UTC(there.getUTCFullYear(), there.getUTCMonth(), there.getUTCDate())) y++
    }
  }
  let t = Date.UTC(y, mo, d, h, m) - offset
  if (!date && t <= now) t += 86_400_000
  return t
}

/** The zone's offset from UTC at `now`, in ms (the machine's own when the zone isn't known). */
function zoneOffset(now: number, zone?: string): number {
  if (zone) {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: zone.trim(), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
          .formatToParts(new Date(now))
          .map((p) => [p.type, p.value])
      )
      const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second))
      return asUtc - Math.floor(now / 1000) * 1000
    } catch {
      // not a zone this runtime knows
    }
  }
  return -new Date(now).getTimezoneOffset() * 60_000
}
