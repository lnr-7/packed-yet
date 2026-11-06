import {
  STARTER_ITEMS,
  STORAGE_KEY,
  buildIcs,
  clampQty,
  cleanName,
  countdownText,
  fileSafeName,
  hasItemNamed,
  isValidLeaveAt,
  itemLabel,
  itemsForReuse,
  leftText,
  makeItem,
  makeTrip,
  normalizeState,
  parseBackup,
  parseQuickAdd,
  sections,
  serializeState,
  sortedTrips,
  summarize,
} from "./logic.js";

// ---- State ----

let state = loadState();
const ui = {
  expandedId: null,
  justPackedId: null,
  draft: "",
  addWarning: "",
};
let tickTimer = null;

const app = document.getElementById("app");
const tripDialog = document.getElementById("trip-dialog");
const tripForm = document.getElementById("trip-form");
const checkDialog = document.getElementById("check-dialog");
const confirmDialog = document.getElementById("confirm-dialog");
const toastEl = document.getElementById("toast");

function loadState() {
  try {
    const parsed = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    if (parsed) return parsed;
  } catch {
    // Fall through to an empty list.
  }
  return { trips: [] };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast("Could not save on this device. Your browser may be in private mode or out of space.");
  }
}

function commit() {
  saveState();
  render();
}

function tripById(id) {
  return state.trips.find((trip) => trip.id === id) || null;
}

// ---- Small DOM helpers ----

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key in node && key !== "list" && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function formatLeaveAt(leaveAt) {
  if (!leaveAt) return "";
  return new Date(leaveAt).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Toast ----

let toastTimer = null;

function toast(text, action = null) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(el("span", { class: "toast-text" }, text));
  if (action) {
    toastEl.append(
      el(
        "button",
        {
          type: "button",
          onclick: () => {
            hideToast();
            action.run();
          },
        },
        action.label,
      ),
    );
  }
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, action ? 7000 : 3500);
}

function hideToast() {
  toastEl.hidden = true;
  toastEl.replaceChildren();
}

// ---- Confirm dialog ----

let confirmAction = null;

function confirm(title, text, okLabel, run) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").textContent = text;
  document.getElementById("confirm-ok").textContent = okLabel;
  confirmAction = run;
  confirmDialog.showModal();
}

document.getElementById("confirm-ok").addEventListener("click", () => {
  const run = confirmAction;
  confirmAction = null;
  confirmDialog.close();
  if (run) run();
});

for (const dialog of [tripDialog, checkDialog, confirmDialog]) {
  dialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  // Tapping the dark backdrop closes the sheet.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ---- Routing ----

function route() {
  const hash = location.hash || "#/";
  const match = hash.match(/^#\/trip\/([^/]+)$/);
  if (match) return { view: "trip", id: decodeURIComponent(match[1]) };
  return { view: "home" };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener("hashchange", () => {
  ui.expandedId = null;
  ui.draft = "";
  ui.addWarning = "";
  render();
  app.focus({ preventScroll: true });
});

// ---- Rendering ----

function render() {
  const focused = document.activeElement;
  const focusKey = focused && focused.dataset ? focused.dataset.fid : null;
  const current = route();

  clearInterval(tickTimer);
  tickTimer = null;

  if (current.view === "trip") {
    const trip = tripById(current.id);
    if (!trip) {
      location.replace("#/");
      return;
    }
    app.replaceChildren(...renderTrip(trip));
    document.title = `${trip.name} – Packed yet?`;
    tickTimer = setInterval(() => {
      const fresh = tripById(current.id);
      const tag = app.querySelector(".tag-wrap");
      if (fresh && tag) tag.replaceWith(renderTag(fresh));
    }, 30 * 1000);
  } else {
    app.replaceChildren(...renderHome());
    document.title = "Packed yet?";
  }

  if (focusKey) {
    const again = app.querySelector(`[data-fid="${focusKey}"]`);
    if (again) again.focus({ preventScroll: true });
  }
  ui.justPackedId = null;
}

function renderBars(trip, summary) {
  const { late, open, packed } = sections(trip);
  const ordered = [...packed, ...open, ...late];
  return el(
    "div",
    {
      class: "bars",
      role: "img",
      "aria-label":
        summary.total === 0 ? "No items yet" : `${summary.packed} of ${summary.total} packed`,
    },
    ordered.map((item) =>
      el("span", { class: "bar" + (item.packed ? " is-packed" : item.late ? " is-late" : "") }),
    ),
  );
}

function renderHome() {
  const trips = sortedTrips(state);
  const now = new Date();
  const nodes = [
    el(
      "div",
      { class: "home-head" },
      el("h1", { class: "page-title" }, "Your trips"),
      el("button", { type: "button", class: "btn btn-main", onclick: () => openTripDialog() }, "New trip"),
    ),
  ];

  if (trips.length === 0) {
    nodes.push(
      el(
        "div",
        { class: "empty" },
        el(
          "p",
          {},
          "No trips yet. Make a list for your next trip, and the trip after that can start from a copy of it.",
        ),
        el("button", { type: "button", class: "btn btn-line", onclick: () => openTripDialog() }, "Start your first list"),
      ),
    );
  } else {
    nodes.push(
      el(
        "ul",
        { class: "trip-list" },
        trips.map((trip) => {
          const summary = summarize(trip, now);
          const status = [leftText(summary), countdownText(summary.msUntilLeave)].filter(Boolean).join(". ");
          return el(
            "li",
            {},
            el(
              "a",
              {
                class: "trip-link" + (summary.overdue ? " is-overdue" : summary.soon ? " is-soon" : ""),
                href: `#/trip/${encodeURIComponent(trip.id)}`,
              },
              el("div", { class: "trip-link-name" }, trip.name),
              el("div", { class: "trip-link-status" }, status),
              renderBars(trip, summary),
            ),
          );
        }),
      ),
    );
  }

  const fileInput = el("input", {
    type: "file",
    accept: ".json,application/json",
    hidden: true,
    onchange: (event) => restoreBackup(event.target.files[0]),
  });

  nodes.push(
    el(
      "section",
      { class: "backup", "aria-label": "Backups" },
      el(
        "p",
        {},
        "Your lists stay on this device and nothing is sent anywhere. Save a backup file to move them to another phone or computer.",
      ),
      el(
        "div",
        { class: "backup-actions" },
        el(
          "button",
          {
            type: "button",
            class: "btn btn-line",
            disabled: trips.length === 0,
            onclick: () => downloadText("packed-yet-backup.json", serializeState(state), "application/json"),
          },
          "Save a backup file",
        ),
        el("button", { type: "button", class: "btn btn-quiet", onclick: () => fileInput.click() }, "Restore from a backup"),
        fileInput,
      ),
    ),
  );
  return nodes;
}

function renderTag(trip) {
  const summary = summarize(trip);
  const whenClass = summary.overdue ? " is-overdue" : summary.soon ? " is-soon" : "";
  const countdown = countdownText(summary.msUntilLeave);
  const children = [
    el("div", { class: "tag-eyelet", "aria-hidden": "true" }),
    el("h1", { class: "tag-name" }, trip.name),
  ];
  if (countdown) children.push(el("div", { class: "tag-when" + whenClass }, countdown));
  if (trip.leaveAt) children.push(el("div", { class: "tag-date" }, formatLeaveAt(trip.leaveAt)));

  if (summary.total > 0) {
    children.push(el("div", { class: "tag-count" }, summary.left === 0 ? "0" : String(summary.left)));
    children.push(el("div", { class: "tag-count-label" }, leftText(summary)));
    if (summary.lateLeft > 0) {
      children.push(
        el(
          "div",
          { class: "tag-late-note" },
          summary.lateLeft === 1 ? "1 of them you're still using" : `${summary.lateLeft} of them you're still using`,
        ),
      );
    }
  } else {
    children.push(el("div", { class: "tag-count-label" }, leftText(summary)));
  }
  children.push(renderBars(trip, summary));

  return el("div", { class: "tag-wrap" }, el("section", { class: "tag", "aria-label": "Trip summary" }, children));
}

function renderTrip(trip) {
  const { late, open, packed } = sections(trip);
  const summary = summarize(trip);

  const addInput = el("input", {
    type: "text",
    maxlength: "80",
    autocomplete: "off",
    enterkeyhint: "done",
    placeholder: "Add something, like socks x4",
    "aria-label": "Add an item",
    dataset: { fid: "add-input" },
    oninput: (event) => {
      ui.draft = event.target.value;
      if (ui.addWarning) {
        ui.addWarning = "";
        hint.textContent = defaultHint;
        hint.classList.remove("is-warning");
      }
    },
  });
  addInput.value = ui.draft;
  const defaultHint = "Type socks x4 to add four pairs. Mark anything you're still using so it stays on top.";
  const hint = el("p", { class: "add-hint" + (ui.addWarning ? " is-warning" : "") }, ui.addWarning || defaultHint);

  const addForm = el(
    "form",
    {
      class: "add-form",
      onsubmit: (event) => {
        event.preventDefault();
        addItem(trip, addInput.value);
      },
    },
    addInput,
    el("button", { type: "submit", class: "btn btn-main" }, "Add"),
  );

  const nodes = [
    el("a", { class: "back-link", href: "#/" }, "All trips"),
    renderTag(trip),
    addForm,
    hint,
  ];

  if (late.length > 0) {
    nodes.push(
      renderSection(trip, "Still using, pack last", late, {
        extraClass: "section-late",
        note: "You'll want these until you walk out the door.",
      }),
    );
  }
  if (open.length > 0) nodes.push(renderSection(trip, "Not packed", open, {}));
  if (packed.length > 0) nodes.push(renderSection(trip, "Packed", packed, {}));

  const canRemind = Boolean(trip.leaveAt);
  nodes.push(
    el(
      "div",
      { class: "trip-actions" },
      el(
        "button",
        {
          type: "button",
          class: "btn btn-line",
          disabled: summary.total === 0,
          onclick: () => openCheck(trip.id),
        },
        "Check before leaving",
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn btn-line",
          disabled: !canRemind,
          title: canRemind ? undefined : "Set a leave time first",
          onclick: () => {
            const ics = buildIcs(trip);
            if (ics) downloadText(`leave-for-${fileSafeName(trip.name)}.ics`, ics, "text/calendar");
          },
        },
        "Add a calendar reminder",
      ),
      el(
        "p",
        { class: "action-note" },
        canRemind
          ? "The reminder goes off a day before and two hours before you leave, and lists what's unpacked right now."
          : "Set a leave time (under Edit trip) to get a calendar reminder.",
      ),
    ),
    el(
      "div",
      { class: "trip-actions-minor" },
      el("button", { type: "button", class: "btn btn-quiet", onclick: () => openTripDialog(trip) }, "Edit trip"),
      el(
        "button",
        {
          type: "button",
          class: "btn btn-quiet",
          disabled: summary.packed === 0,
          onclick: () =>
            confirm(
              "Unpack everything?",
              "Every item goes back to not packed. Handy when you pack for the way home.",
              "Unpack everything",
              () => {
                trip.items.forEach((item) => (item.packed = false));
                commit();
              },
            ),
        },
        "Unpack everything",
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn btn-quiet btn-danger-text",
          onclick: () =>
            confirm("Delete this trip?", `"${trip.name}" and its ${summary.total} items will be gone for good.`, "Delete trip", () => {
              state.trips = state.trips.filter((t) => t.id !== trip.id);
              saveState();
              go("#/");
              toast(`Deleted ${trip.name}`);
            }),
        },
        "Delete trip",
      ),
    ),
  );
  return nodes;
}

function renderSection(trip, title, items, { extraClass = "", note = "" }) {
  return el(
    "section",
    { class: "section " + extraClass },
    el("h2", { class: "section-title" }, title, el("span", { class: "section-count" }, String(items.length))),
    note ? el("p", { class: "section-note" }, note) : null,
    el(
      "ul",
      { class: "items" },
      items.map((item) => renderItem(trip, item)),
    ),
  );
}

function renderItem(trip, item) {
  const expanded = ui.expandedId === item.id;
  const checkbox = el("input", {
    type: "checkbox",
    checked: item.packed,
    class: ui.justPackedId === item.id ? "just-packed" : "",
    dataset: { fid: `check:${item.id}` },
    onchange: (event) => {
      item.packed = event.target.checked;
      ui.justPackedId = item.packed ? item.id : null;
      commit();
    },
  });

  const row = el(
    "div",
    { class: "item-row" },
    el(
      "label",
      { class: "item-check" },
      checkbox,
      el("span", { class: "item-name" }, item.name),
      item.qty > 1 ? el("span", { class: "item-qty" }, `×${item.qty}`) : null,
    ),
    el(
      "button",
      {
        type: "button",
        class: "item-more",
        "aria-expanded": String(expanded),
        "aria-label": `${expanded ? "Done editing" : "Edit"} ${item.name}`,
        dataset: { fid: `more:${item.id}` },
        onclick: () => {
          ui.expandedId = expanded ? null : item.id;
          render();
        },
      },
      expanded ? "Done" : "Edit",
    ),
  );

  const li = el("li", { class: "item" + (item.packed ? " is-packed" : "") + (item.late ? " is-late" : "") }, row);
  if (expanded) li.append(renderEditor(trip, item));
  return li;
}

function renderEditor(trip, item) {
  const nameId = `name-${item.id}`;
  const nameInput = el("input", {
    id: nameId,
    type: "text",
    maxlength: "80",
    value: item.name,
    dataset: { fid: `name:${item.id}` },
    onchange: (event) => {
      const next = cleanName(event.target.value);
      if (!next) {
        event.target.value = item.name;
        return;
      }
      if (hasItemNamed(trip, next, item.id)) {
        toast(`${next} is already on the list`);
        event.target.value = item.name;
        return;
      }
      item.name = next;
      commit();
    },
  });

  const setQty = (qty) => {
    item.qty = clampQty(qty);
    commit();
  };

  return el(
    "div",
    { class: "item-editor" },
    el("div", { class: "field" }, el("label", { for: nameId }, "Name"), nameInput),
    el(
      "div",
      { class: "field" },
      el("span", { class: "field-label", id: `qty-label-${item.id}` }, "How many"),
      el(
        "div",
        { class: "stepper", role: "group", "aria-labelledby": `qty-label-${item.id}` },
        el(
          "button",
          {
            type: "button",
            "aria-label": "One fewer",
            disabled: item.qty <= 1,
            dataset: { fid: `minus:${item.id}` },
            onclick: () => setQty(item.qty - 1),
          },
          "−",
        ),
        el("output", { "aria-live": "polite" }, String(item.qty)),
        el(
          "button",
          {
            type: "button",
            "aria-label": "One more",
            disabled: item.qty >= 99,
            dataset: { fid: `plus:${item.id}` },
            onclick: () => setQty(item.qty + 1),
          },
          "+",
        ),
      ),
    ),
    el(
      "label",
      { class: "toggle" },
      el("input", {
        type: "checkbox",
        checked: item.late,
        dataset: { fid: `late:${item.id}` },
        onchange: (event) => {
          item.late = event.target.checked;
          commit();
        },
      }),
      el("span", {}, "I'm still using this until I leave"),
    ),
    el(
      "div",
      { class: "editor-actions" },
      el(
        "button",
        {
          type: "button",
          class: "btn btn-quiet btn-danger-text",
          onclick: () => removeItem(trip, item),
        },
        "Remove from list",
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn btn-quiet",
          onclick: () => {
            ui.expandedId = null;
            render();
          },
        },
        "Done",
      ),
    ),
  );
}

// ---- Item actions ----

function addItem(trip, text) {
  const parsed = parseQuickAdd(text);
  if (!parsed) return;
  if (hasItemNamed(trip, parsed.name)) {
    ui.addWarning = `${parsed.name} is already on the list.`;
    render();
    return;
  }
  trip.items.push(makeItem(parsed));
  ui.draft = "";
  ui.addWarning = "";
  commit();
}

function removeItem(trip, item) {
  const index = trip.items.indexOf(item);
  if (index === -1) return;
  trip.items.splice(index, 1);
  ui.expandedId = null;
  commit();
  toast(`Removed ${item.name}`, {
    label: "Undo",
    run: () => {
      const fresh = tripById(trip.id);
      if (!fresh || fresh.items.some((i) => i.id === item.id)) return;
      fresh.items.splice(Math.min(index, fresh.items.length), 0, item);
      commit();
    },
  });
}

// ---- Trip dialog (new and edit) ----

let editingTripId = null;

function openTripDialog(trip = null) {
  editingTripId = trip ? trip.id : null;
  const nameInput = document.getElementById("trip-name");
  const leaveInput = document.getElementById("trip-leave");
  const sourceField = document.getElementById("trip-source-field");
  const source = document.getElementById("trip-source");

  document.getElementById("trip-dialog-title").textContent = trip ? "Edit trip" : "New trip";
  document.getElementById("trip-submit").textContent = trip ? "Save changes" : "Create trip";
  document.getElementById("trip-name-error").hidden = true;
  nameInput.value = trip ? trip.name : "";
  leaveInput.value = trip ? trip.leaveAt : "";

  sourceField.hidden = Boolean(trip);
  if (!trip) {
    const previous = sortedTrips(state);
    source.replaceChildren(
      el("option", { value: "empty" }, "An empty list"),
      el("option", { value: "starter" }, `The starter list (${STARTER_ITEMS.length} everyday items)`),
    );
    if (previous.length > 0) {
      source.append(
        el(
          "optgroup",
          { label: "A copy of a past trip" },
          previous.map((p) =>
            el("option", { value: `trip:${p.id}` }, `${p.name} (${p.items.length} ${p.items.length === 1 ? "item" : "items"})`),
          ),
        ),
      );
    }
    // Reusing the most recent trip is the whole point, so it is the default.
    source.value = previous.length > 0 ? `trip:${previous[0].id}` : "starter";
  }

  tripDialog.showModal();
  nameInput.focus();
}

tripForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = cleanName(document.getElementById("trip-name").value);
  const leaveAt = document.getElementById("trip-leave").value;
  const error = document.getElementById("trip-name-error");
  if (!name) {
    error.hidden = false;
    document.getElementById("trip-name").focus();
    return;
  }
  const safeLeaveAt = isValidLeaveAt(leaveAt) ? leaveAt : "";

  if (editingTripId) {
    const trip = tripById(editingTripId);
    if (trip) {
      trip.name = name;
      trip.leaveAt = safeLeaveAt;
      saveState();
    }
    tripDialog.close();
    render();
    return;
  }

  const sourceValue = document.getElementById("trip-source").value;
  let items = [];
  if (sourceValue === "starter") items = STARTER_ITEMS;
  else if (sourceValue.startsWith("trip:")) {
    const from = tripById(sourceValue.slice(5));
    if (from) items = itemsForReuse(from);
  }
  const trip = makeTrip({ name, leaveAt: safeLeaveAt, items });
  state.trips.push(trip);
  saveState();
  tripDialog.close();
  go(`#/trip/${encodeURIComponent(trip.id)}`);
});

// ---- Leaving check ----

function openCheck(tripId) {
  renderCheck(tripId);
  checkDialog.showModal();
}

function renderCheck(tripId) {
  const trip = tripById(tripId);
  const body = document.getElementById("check-body");
  if (!trip) {
    checkDialog.close();
    return;
  }
  const { late, open } = sections(trip);
  const unpacked = [...late, ...open];
  if (unpacked.length === 0) {
    body.replaceChildren(el("p", { class: "check-done" }, "Everything is packed. Have a good trip."));
    return;
  }
  body.replaceChildren(
    el(
      "p",
      { class: "check-lead" },
      unpacked.length === 1 ? "One thing is not in your bag." : `${unpacked.length} things are not in your bag.`,
    ),
    el(
      "ul",
      { class: "check-list" },
      unpacked.map((item) =>
        el(
          "li",
          { class: "item" },
          el(
            "label",
            { class: "item-check" },
            el("input", {
              type: "checkbox",
              onchange: () => {
                item.packed = true;
                saveState();
                renderCheck(tripId);
                render();
              },
            }),
            el("span", { class: "item-name" }, itemLabel(item)),
            item.late ? el("span", { class: "check-mark-late" }, "still using") : null,
          ),
        ),
      ),
    ),
  );
}

// ---- Backups ----

async function restoreBackup(file) {
  if (!file) return;
  const text = await file.text();
  const backup = parseBackup(text);
  if (!backup) {
    toast("That file isn't a Packed yet? backup.");
    return;
  }
  const known = new Set(state.trips.map((trip) => trip.id));
  const added = backup.trips.filter((trip) => !known.has(trip.id));
  if (added.length === 0) {
    toast("Those trips are already here.");
    return;
  }
  state.trips.push(...added);
  commit();
  toast(added.length === 1 ? "Added 1 trip from the backup." : `Added ${added.length} trips from the backup.`);
}

// ---- Start ----

render();

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {
    // The app still works without offline caching.
  });
}
