// Pure data logic for Packed yet? No DOM access here, so it can be tested with Node.

export const STORAGE_KEY = "packed-yet:v1";

export const STARTER_ITEMS = [
  { name: "Phone charger", qty: 1, late: true },
  { name: "Toothbrush", qty: 1, late: true },
  { name: "ID card or passport", qty: 1, late: false },
  { name: "Wallet", qty: 1, late: false },
  { name: "Keys", qty: 1, late: false },
  { name: "Medicines", qty: 1, late: false },
  { name: "Toothpaste", qty: 1, late: false },
  { name: "Underwear", qty: 3, late: false },
  { name: "Socks", qty: 3, late: false },
  { name: "T-shirts", qty: 3, late: false },
  { name: "Headphones", qty: 1, late: false },
  { name: "Power bank", qty: 1, late: false },
  { name: "Book", qty: 1, late: false },
  { name: "Water bottle", qty: 1, late: false },
];

const MAX_QTY = 99;
const MAX_NAME = 80;

export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function clampQty(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QTY);
}

export function cleanName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

// "socks x4", "4x socks" and "socks ×4" set a quantity. A bare leading number
// ("50 ml sunscreen") is left alone because it is usually part of the name.
export function parseQuickAdd(text) {
  const raw = cleanName(text);
  if (!raw) return null;
  let match = raw.match(/^(.*\S)\s*[x×]\s*(\d{1,2})$/i);
  if (match && /\s[x×]\s*\d{1,2}$/i.test(raw)) {
    return { name: cleanName(match[1]), qty: clampQty(match[2]) };
  }
  match = raw.match(/^(\d{1,2})\s*[x×]\s+(.+)$/i);
  if (match) {
    return { name: cleanName(match[2]), qty: clampQty(match[1]) };
  }
  return { name: raw, qty: 1 };
}

export function makeItem({ name, qty = 1, late = false }) {
  return {
    id: newId(),
    name: cleanName(name),
    qty: clampQty(qty),
    late: Boolean(late),
    packed: false,
  };
}

// leaveAt is a local "YYYY-MM-DDTHH:mm" string (the value of a datetime-local
// input) or "" when the trip has no leave time.
export function isValidLeaveAt(value) {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function makeTrip({ name, leaveAt = "", items = [] }, now = new Date()) {
  return {
    id: newId(),
    name: cleanName(name) || "Trip",
    leaveAt: isValidLeaveAt(leaveAt) ? leaveAt : "",
    createdAt: now.toISOString(),
    items: items.map((item) => makeItem(item)),
  };
}

// Reusing a trip keeps names, quantities and "still using" marks, and starts
// with nothing packed.
export function itemsForReuse(trip) {
  return trip.items.map(({ name, qty, late }) => ({ name, qty, late }));
}

export function hasItemNamed(trip, name, exceptId = null) {
  const wanted = cleanName(name).toLowerCase();
  return trip.items.some((item) => item.id !== exceptId && item.name.toLowerCase() === wanted);
}

export function summarize(trip, now = new Date()) {
  const total = trip.items.length;
  const packed = trip.items.filter((item) => item.packed).length;
  const lateLeft = trip.items.filter((item) => !item.packed && item.late).length;
  const left = total - packed;
  let msUntilLeave = null;
  if (trip.leaveAt) {
    const t = new Date(trip.leaveAt).getTime();
    if (!Number.isNaN(t)) msUntilLeave = t - now.getTime();
  }
  const DAY = 24 * 60 * 60 * 1000;
  // "soon" is the last day before leaving with things still out of the bag.
  const soon = left > 0 && msUntilLeave !== null && msUntilLeave <= DAY && msUntilLeave > 0;
  const overdue = left > 0 && msUntilLeave !== null && msUntilLeave <= 0;
  return { total, packed, left, lateLeft, msUntilLeave, soon, overdue };
}

export function sections(trip) {
  const late = trip.items.filter((item) => !item.packed && item.late);
  const open = trip.items.filter((item) => !item.packed && !item.late);
  const packed = trip.items.filter((item) => item.packed);
  return { late, open, packed };
}

function plural(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

export function countdownText(msUntilLeave) {
  if (msUntilLeave === null) return "";
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (msUntilLeave <= 0) return "Your leave time has passed";
  if (msUntilLeave < MIN) return "Leaving in under a minute";
  if (msUntilLeave < HOUR) return "Leaving in " + plural(Math.floor(msUntilLeave / MIN), "minute", "minutes");
  if (msUntilLeave < 2 * DAY) return "Leaving in " + plural(Math.floor(msUntilLeave / HOUR), "hour", "hours");
  return "Leaving in " + plural(Math.floor(msUntilLeave / DAY), "day", "days");
}

export function leftText(summary) {
  if (summary.total === 0) return "Nothing on the list yet";
  if (summary.left === 0) return "Everything is packed";
  return summary.left === 1 ? "1 thing left to pack" : `${summary.left} things left to pack`;
}

export function itemLabel(item) {
  return item.qty > 1 ? `${item.name} ×${item.qty}` : item.name;
}

// ---- Calendar reminder (.ics) ----

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Lines longer than 75 octets must be folded with CRLF + space.
function icsFold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out = [];
  let current = "";
  let limit = 75;
  for (const ch of line) {
    if (encoder.encode(current + ch).length > limit) {
      out.push(current);
      current = ch;
      limit = 74; // continuation lines start with one space
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function icsUtcStamp(date) {
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

// Returns null when the trip has no leave time. The event uses a floating
// local time, so it fires at the time the person typed, on their own clock.
export function buildIcs(trip, now = new Date()) {
  if (!trip.leaveAt || !isValidLeaveAt(trip.leaveAt)) return null;
  const start = trip.leaveAt.replace(/[-:]/g, "") + "00";
  const { late, open } = sections(trip);
  const unpacked = [...late, ...open];
  const description =
    unpacked.length === 0
      ? "Everything was packed when this reminder was made."
      : "Not packed when this reminder was made:\n" + unpacked.map((item) => "- " + itemLabel(item)).join("\n");
  const alarmText = `Packing check for ${trip.name}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Packed yet//Packing list//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${trip.id}@packed-yet`,
    `DTSTAMP:${icsUtcStamp(now)}`,
    `DTSTART:${start}`,
    "DURATION:PT15M",
    `SUMMARY:${icsEscape("Leave for " + trip.name)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(alarmText)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(alarmText)}`,
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

// ---- Saving, loading and backups ----

// Accepts anything (a parsed backup file or stored data) and returns a clean
// state, or null when the data is not a Packed yet? list.
export function normalizeState(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.trips)) return null;
  const trips = [];
  for (const raw of data.trips) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
    const items = [];
    for (const rawItem of raw.items) {
      if (!rawItem || typeof rawItem !== "object") return null;
      const name = cleanName(rawItem.name);
      if (!name) continue;
      items.push({
        id: typeof rawItem.id === "string" && rawItem.id ? rawItem.id : newId(),
        name,
        qty: clampQty(rawItem.qty),
        late: Boolean(rawItem.late),
        packed: Boolean(rawItem.packed),
      });
    }
    trips.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
      name: cleanName(raw.name) || "Trip",
      leaveAt: isValidLeaveAt(raw.leaveAt) ? raw.leaveAt : "",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      items,
    });
  }
  return { trips };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return normalizeState(data);
}

export function serializeState(state) {
  return JSON.stringify({ app: "packed-yet", version: 1, trips: state.trips }, null, 2);
}

// Newest trips first on the home screen.
export function sortedTrips(state) {
  return [...state.trips].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function fileSafeName(name) {
  const safe = cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "trip";
}
