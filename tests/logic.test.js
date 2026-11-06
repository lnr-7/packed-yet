import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIcs,
  clampQty,
  countdownText,
  fileSafeName,
  hasItemNamed,
  itemsForReuse,
  leftText,
  makeTrip,
  normalizeState,
  parseBackup,
  parseQuickAdd,
  sections,
  serializeState,
  sortedTrips,
  summarize,
} from "../logic.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("parseQuickAdd reads quantities only from an explicit x", () => {
  assert.deepEqual(parseQuickAdd("socks x4"), { name: "socks", qty: 4 });
  assert.deepEqual(parseQuickAdd("Socks ×2"), { name: "Socks", qty: 2 });
  assert.deepEqual(parseQuickAdd("3x t-shirts"), { name: "t-shirts", qty: 3 });
  assert.deepEqual(parseQuickAdd("  phone   charger "), { name: "phone charger", qty: 1 });
  assert.equal(parseQuickAdd("   "), null);
});

test("parseQuickAdd leaves numbers that belong to the name alone", () => {
  assert.deepEqual(parseQuickAdd("50 ml sunscreen"), { name: "50 ml sunscreen", qty: 1 });
  assert.deepEqual(parseQuickAdd("2-in-1 shampoo"), { name: "2-in-1 shampoo", qty: 1 });
  assert.deepEqual(parseQuickAdd("Xbox"), { name: "Xbox", qty: 1 });
  assert.deepEqual(parseQuickAdd("iPhone x12"), { name: "iPhone", qty: 12 });
  assert.deepEqual(parseQuickAdd("box2"), { name: "box2", qty: 1 });
});

test("clampQty keeps quantities between 1 and 99", () => {
  assert.equal(clampQty(0), 1);
  assert.equal(clampQty(-3), 1);
  assert.equal(clampQty("abc"), 1);
  assert.equal(clampQty(5), 5);
  assert.equal(clampQty(1000), 99);
});

test("a reused trip keeps names, quantities and marks, with nothing packed", () => {
  const first = makeTrip({
    name: "Goa",
    items: [
      { name: "Charger", qty: 1, late: true },
      { name: "Socks", qty: 4 },
    ],
  });
  first.items[0].packed = true;
  first.items[1].packed = true;

  const second = makeTrip({ name: "Delhi", items: itemsForReuse(first) });

  assert.deepEqual(
    second.items.map(({ name, qty, late, packed }) => ({ name, qty, late, packed })),
    [
      { name: "Charger", qty: 1, late: true, packed: false },
      { name: "Socks", qty: 4, late: false, packed: false },
    ],
  );
  assert.notEqual(second.items[0].id, first.items[0].id);
  assert.equal(first.items[0].packed, true);
});

test("summarize counts what is left and flags the last day", () => {
  const now = new Date(2026, 10, 6, 9, 0);
  const trip = makeTrip({
    name: "Goa",
    leaveAt: "2026-11-06T18:00",
    items: [{ name: "Charger", late: true }, { name: "Socks" }, { name: "Book" }],
  });
  trip.items[1].packed = true;

  const s = summarize(trip, now);
  assert.equal(s.total, 3);
  assert.equal(s.packed, 1);
  assert.equal(s.left, 2);
  assert.equal(s.lateLeft, 1);
  assert.equal(s.msUntilLeave, 9 * HOUR);
  assert.equal(s.soon, true);
  assert.equal(s.overdue, false);
});

test("summarize is calm when all is packed or the trip is far off", () => {
  const now = new Date(2026, 10, 6, 9, 0);
  const far = makeTrip({ name: "Far", leaveAt: "2026-11-20T09:00", items: [{ name: "Book" }] });
  assert.equal(summarize(far, now).soon, false);

  const done = makeTrip({ name: "Done", leaveAt: "2026-11-06T10:00", items: [{ name: "Book" }] });
  done.items[0].packed = true;
  assert.equal(summarize(done, now).soon, false);
  assert.equal(summarize(done, now).overdue, false);

  const late = makeTrip({ name: "Late", leaveAt: "2026-11-06T08:00", items: [{ name: "Book" }] });
  assert.equal(summarize(late, now).overdue, true);

  const noDate = makeTrip({ name: "No date", items: [{ name: "Book" }] });
  assert.equal(summarize(noDate, now).msUntilLeave, null);
  assert.equal(summarize(noDate, now).soon, false);
});

test("sections put still-using items first and packed items last", () => {
  const trip = makeTrip({
    name: "Goa",
    items: [{ name: "Socks" }, { name: "Charger", late: true }, { name: "Book" }],
  });
  trip.items[2].packed = true;
  const { late, open, packed } = sections(trip);
  assert.deepEqual(late.map((i) => i.name), ["Charger"]);
  assert.deepEqual(open.map((i) => i.name), ["Socks"]);
  assert.deepEqual(packed.map((i) => i.name), ["Book"]);
});

test("countdownText picks sensible units", () => {
  assert.equal(countdownText(null), "");
  assert.equal(countdownText(-5), "Your leave time has passed");
  assert.equal(countdownText(30 * 1000), "Leaving in under a minute");
  assert.equal(countdownText(MIN), "Leaving in 1 minute");
  assert.equal(countdownText(45 * MIN), "Leaving in 45 minutes");
  assert.equal(countdownText(HOUR), "Leaving in 1 hour");
  assert.equal(countdownText(30 * HOUR), "Leaving in 30 hours");
  assert.equal(countdownText(2 * DAY), "Leaving in 2 days");
  assert.equal(countdownText(9 * DAY + HOUR), "Leaving in 9 days");
});

test("leftText covers empty, done and remaining lists", () => {
  assert.equal(leftText({ total: 0, left: 0 }), "Nothing on the list yet");
  assert.equal(leftText({ total: 3, left: 0 }), "Everything is packed");
  assert.equal(leftText({ total: 3, left: 1 }), "1 thing left to pack");
  assert.equal(leftText({ total: 3, left: 2 }), "2 things left to pack");
});

test("hasItemNamed ignores case and can skip the item being edited", () => {
  const trip = makeTrip({ name: "Goa", items: [{ name: "Socks" }, { name: "Book" }] });
  assert.equal(hasItemNamed(trip, "  socks "), true);
  assert.equal(hasItemNamed(trip, "Hat"), false);
  assert.equal(hasItemNamed(trip, "socks", trip.items[0].id), false);
});

test("buildIcs needs a leave time", () => {
  assert.equal(buildIcs(makeTrip({ name: "Goa" })), null);
});

test("buildIcs lists unpacked items and sets two alarms", () => {
  const trip = makeTrip({
    name: "Goa, with friends; fun",
    leaveAt: "2026-11-08T06:30",
    items: [{ name: "Socks", qty: 4 }, { name: "Charger", late: true }, { name: "Book" }],
  });
  trip.items[2].packed = true;
  const ics = buildIcs(trip, new Date(Date.UTC(2026, 10, 6, 12, 0, 0)));
  const unfolded = ics.replace(/\r\n /g, "");

  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(unfolded.includes("DTSTART:20261108T063000\r\n"));
  assert.ok(unfolded.includes("DTSTAMP:20261106T120000Z\r\n"));
  assert.ok(unfolded.includes("SUMMARY:Leave for Goa\\, with friends\\; fun\r\n"));
  assert.ok(unfolded.includes("- Charger\\n- Socks ×4"));
  assert.ok(!unfolded.includes("Book"));
  assert.equal(unfolded.match(/BEGIN:VALARM/g).length, 2);
  assert.ok(unfolded.includes("TRIGGER:-P1D"));
  assert.ok(unfolded.includes("TRIGGER:-PT2H"));
});

test("buildIcs folds every line to 75 octets or fewer", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ name: `Très long item number ${i} ✈ for the trip` }));
  const trip = makeTrip({ name: "Long", leaveAt: "2026-11-08T06:30", items });
  const ics = buildIcs(trip);
  const encoder = new TextEncoder();
  for (const line of ics.split("\r\n")) {
    assert.ok(encoder.encode(line).length <= 75, `line too long: ${line}`);
  }
});

test("backups round-trip", () => {
  const trip = makeTrip({ name: "Goa", leaveAt: "2026-11-08T06:30", items: [{ name: "Socks", qty: 4, late: true }] });
  trip.items[0].packed = true;
  const state = { trips: [trip] };
  assert.deepEqual(parseBackup(serializeState(state)), state);
});

test("parseBackup rejects files that are not a packing list", () => {
  assert.equal(parseBackup("not json"), null);
  assert.equal(parseBackup("[]"), null);
  assert.equal(parseBackup('{"trips": "nope"}'), null);
  assert.equal(parseBackup('{"trips": [{"name": "x"}]}'), null);
  assert.equal(parseBackup('{"trips": [{"name": "x", "items": [5]}]}'), null);
});

test("normalizeState repairs sloppy data", () => {
  const state = normalizeState({
    trips: [
      {
        name: "  ",
        leaveAt: "tomorrow",
        items: [
          { name: "Socks", qty: 500, packed: 1 },
          { name: "   " },
        ],
      },
    ],
  });
  assert.equal(state.trips.length, 1);
  const trip = state.trips[0];
  assert.equal(trip.name, "Trip");
  assert.equal(trip.leaveAt, "");
  assert.equal(trip.items.length, 1);
  assert.equal(trip.items[0].qty, 99);
  assert.equal(trip.items[0].packed, true);
  assert.equal(typeof trip.items[0].id, "string");
});

test("sortedTrips puts the newest trip first without changing the state", () => {
  const older = makeTrip({ name: "Older" }, new Date("2026-10-01T00:00:00Z"));
  const newer = makeTrip({ name: "Newer" }, new Date("2026-11-01T00:00:00Z"));
  const state = { trips: [older, newer] };
  assert.deepEqual(sortedTrips(state).map((t) => t.name), ["Newer", "Older"]);
  assert.deepEqual(state.trips.map((t) => t.name), ["Older", "Newer"]);
});

test("fileSafeName makes a plain file name", () => {
  assert.equal(fileSafeName("Goa, with friends!"), "goa-with-friends");
  assert.equal(fileSafeName("???"), "trip");
});
