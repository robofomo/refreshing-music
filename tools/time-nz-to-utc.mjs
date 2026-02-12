import { pathToFileURL } from "node:url";

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

const OFFSET_FMT = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  timeZoneName: "shortOffset",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function parseCreatedLocal(input) {
  const m = String(input ?? "").trim().match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!m) throw new Error(`Invalid Created value: ${input}`);

  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ampm = m[6].toUpperCase();

  if (ampm === "AM") {
    hour = hour === 12 ? 0 : hour;
  } else {
    hour = hour === 12 ? 12 : hour + 12;
  }

  return { year, month, day, hour, minute, second: 0 };
}

function offsetTextToMinutes(offsetText) {
  const m = String(offsetText ?? "").match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) throw new Error(`Unexpected offset format: ${offsetText}`);
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function offsetMinutesAt(utcMs) {
  const parts = OFFSET_FMT.formatToParts(new Date(utcMs));
  const tz = parts.find((p) => p.type === "timeZoneName")?.value;
  if (!tz) throw new Error("Failed to resolve Pacific/Auckland offset");
  return offsetTextToMinutes(tz);
}

export function nzLocalStringToUtcIso(createdLocalRaw) {
  const local = parseCreatedLocal(createdLocalRaw);
  const baseUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, 0);

  let guess = baseUtcMs;
  for (let i = 0; i < 4; i += 1) {
    const offsetMin = offsetMinutesAt(guess);
    const next = baseUtcMs - offsetMin * 60_000;
    if (next === guess) break;
    guess = next;
  }

  return new Date(guess).toISOString();
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const [createdLocalRaw] = process.argv.slice(2);
  if (!createdLocalRaw) {
    console.error('Usage: node tools/time-nz-to-utc.mjs "January 25, 2026 at 11:03 PM"');
    process.exit(1);
  }
  try {
    console.log(nzLocalStringToUtcIso(createdLocalRaw));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
