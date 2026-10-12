
"use strict";

/*
  Little Dreams — Life Bucket List
  Storage: IndexedDB (dream records, journal entries, and uploaded image blobs)
  No server or external JavaScript libraries required.
*/

const DB_NAME = "little-dreams-db";
const DB_VERSION = 1;
const DREAM_STORE = "dreams";
const JOURNAL_STORE = "journal";

let db;
let dreams = [];
let journalEntries = [];
let activeView = "all";
let selectedPhoto = null;
let existingPhoto = null;
let photoWasRemoved = false;
let toastTimer;

const $ = (selector) => document.querySelector(selector);

const elements = {
  dialog: $("#dreamDialog"),
  form: $("#dreamForm"),
  grid: $("#dreamGrid"),
  empty: $("#emptyState"),
  emptyTitle: $("#emptyTitle"),
  emptyText: $("#emptyText"),
  search: $("#searchInput"),
  category: $("#categoryFilter"),
  sort: $("#sortSelect"),
  dreamId: $("#dreamId"),
  title: $("#dreamTitle"),
  description: $("#dreamDescription"),
  categoryInput: $("#dreamCategory"),
  status: $("#dreamStatus"),
  date: $("#dreamDate"),
  budget: $("#dreamBudget"),
  location: $("#dreamLocation"),
  notes: $("#dreamNotes"),
  photoInput: $("#dreamPhoto"),
  photoPreview: $("#photoPreview"),
  uploadLabel: $("#uploadLabel"),
  uploadBox: $("#uploadBox"),
  removePhoto: $("#removePhotoBtn"),
  dialogTitle: $("#dialogTitle"),
  saveButton: $("#saveDreamBtn"),
  toast: $("#toast"),
  journalForm: $("#journalForm"),
  journalInput: $("#journalEntry"),
  journalEntries: $("#journalEntries")
};

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support IndexedDB."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(DREAM_STORE)) {
        database.createObjectStore(DREAM_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(JOURNAL_STORE)) {
        database.createObjectStore(JOURNAL_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the database."));
    request.onblocked = () => console.warn("Please close older tabs of this app to update its database.");
  });
}

function storeRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;

    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }

    let result;
    if (request) {
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("Database request failed."));
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Database transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction was cancelled."));
  });
}

function getAll(storeName) {
  return storeRequest(storeName, "readonly", store => store.getAll());
}

function putRecord(storeName, record) {
  return storeRequest(storeName, "readwrite", store => store.put(record));
}

function deleteRecord(storeName, id) {
  return storeRequest(storeName, "readwrite", store => store.delete(id));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatBudget(value) {
  if (value === "" || value == null || !Number.isFinite(Number(value))) return "";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2
  }).format(Number(value));
}

function progressFor(dream) {
  if (dream.status === "completed") return 100;
  if (dream.status === "progress") return 50;
  return 0;
}

function statusLabel(status) {
  if (status === "completed") return "Completed";
  if (status === "progress") return "In progress";
  return "Not started";
}

function statusClass(status) {
  if (status === "completed") return "completed";
  if (status === "progress") return "progress";
  return "";
}

function categorySymbol(category) {
  const symbols = {
    "Travel": "✈",
    "Personal Growth": "✿",
    "Adventure": "⛰",
    "Career": "✧",
    "Creativity": "♡",
    "Relationships": "☼",
    "Lifestyle": "❋",
    "Other": "✦"
  };
  return symbols[category] || "✦";
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function getPhotoURL(dream) {
  if (!dream.photo) return "";
  return URL.createObjectURL(dream.photo);
}

function refreshStats() {
  const total = dreams.length;
  const completed = dreams.filter(d => d.status === "completed").length;
  const inProgress = dreams.filter(d => d.status === "progress").length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  $("#totalStat").textContent = total;
  $("#progressStat").textContent = inProgress;
  $("#completedStat").textContent = completed;
  $("#overallPercent").textContent = `${percent}%`;
  $("#overallBar").style.width = `${percent}%`;

  $("#overallText").textContent = total
    ? `${completed} of ${total} dreams lived. Keep going!`
    : "Every dream starts somewhere.";

  $("#allCount").textContent = total;
  $("#activeCount").textContent = dreams.filter(d => d.status !== "completed").length;
  $("#doneCount").textContent = completed;
}

function getVisibleDreams() {
  const searchTerm = elements.search.value.trim().toLowerCase();
  const category = elements.category.value;
  const sortBy = elements.sort.value;

  let visible = dreams.filter(dream => {
    const matchesView =
      activeView === "all" ||
      (activeView === "active" && dream.status !== "completed") ||
      (activeView === "completed" && dream.status === "completed");

    const matchesCategory = category === "all" || dream.category === category;
    const searchable = [
      dream.title, dream.description, dream.category,
      dream.location, dream.notes, dream.status
    ].join(" ").toLowerCase();

    return matchesView && matchesCategory && searchable.includes(searchTerm);
  });

  visible.sort((a, b) => {
    if (sortBy === "oldest") return (a.createdAt || 0) - (b.createdAt || 0);
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "date") {
      if (!a.targetDate && !b.targetDate) return (b.createdAt || 0) - (a.createdAt || 0);
      if (!a.targetDate) return 1;
      if (!b.targetDate) return -1;
      return a.targetDate.localeCompare(b.targetDate);
    }
    if (sortBy === "progress") return progressFor(b) - progressFor(a);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return visible;
}

function renderDreams() {
  refreshStats();

  // Revoke URLs created for the previous render to avoid leaking memory.
  elements.grid.querySelectorAll("img[data-object-url]").forEach(img => {
    URL.revokeObjectURL(img.dataset.objectUrl);
  });

  const visible = getVisibleDreams();
  elements.grid.innerHTML = "";

  elements.empty.hidden = visible.length > 0;
  elements.grid.hidden = visible.length === 0;

  if (!visible.length) {
    const hasDreams = dreams.length > 0;
    elements.emptyTitle.textContent = hasDreams
      ? "No dreams found just yet."
      : "Your next adventure starts here.";
    elements.emptyText.textContent = hasDreams
      ? "Try a different search or filter, or add another dream."
      : "Add your first dream and give yourself something wonderful to look forward to.";
    $("#emptyAddBtn").textContent = hasDreams ? "＋ Add a dream" : "＋ Add your first dream";
    return;
  }

  visible.forEach(dream => {
    const card = document.createElement("article");
    card.className = "dream-card";
    const progress = progressFor(dream);
    const status = statusLabel(dream.status);
    const photoURL = getPhotoURL(dream);
    const dateLabel = dream.targetDate
      ? `▦ ${escapeHTML(formatDate(dream.targetDate))}`
      : "";
    const budgetLabel = dream.budget !== "" && dream.budget != null
      ? `♡ ${escapeHTML(formatBudget(dream.budget))}`
      : "";
    const locationLabel = dream.location
      ? `⌖ ${escapeHTML(dream.location)}`
      : "";
    const meta = [dateLabel, budgetLabel, locationLabel].filter(Boolean).join("");

    card.innerHTML = `
      <div class="dream-photo-wrap">
        ${photoURL
          ? `<img class="dream-photo" data-object-url="${photoURL}" src="${photoURL}" alt="${escapeHTML(dream.title)}">`
          : `<div class="photo-placeholder"><span>${categorySymbol(dream.category)}</span></div>`}
        <div class="photo-pills">
          <span class="category-pill">${categorySymbol(dream.category)} ${escapeHTML(dream.category)}</span>
          <span class="status-pill ${statusClass(dream.status)}">${escapeHTML(status)}</span>
        </div>
      </div>
      <div class="card-body">
        <h3 class="dream-title">${escapeHTML(dream.title)}</h3>
        <p class="dream-description">${escapeHTML(dream.description)}</p>
        ${meta ? `<div class="card-meta">
          ${dateLabel ? `<span>${dateLabel}</span>` : ""}
          ${budgetLabel ? `<span>${budgetLabel}</span>` : ""}
          ${locationLabel ? `<span>${locationLabel}</span>` : ""}
        </div>` : ""}
        <div class="card-progress-head">
          <span>Dream progress</span><strong>${progress}%</strong>
        </div>
        <div class="card-progress" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress for ${escapeHTML(dream.title)}">
          <div style="width:${progress}%"></div>
        </div>
        <div class="card-footer">
          <span class="notes-hint">${dream.notes ? "✎ Notes saved" : "✧ Your next chapter"}</span>
          <div class="card-footer-actions">
            <button class="complete-btn ${dream.status === "completed" ? "is-done" : ""}" data-action="toggle" data-id="${escapeHTML(dream.id)}">
              ${dream.status === "completed" ? "↶ Reopen" : "✓ Complete"}
            </button>
            <button class="icon-button" data-action="edit" data-id="${escapeHTML(dream.id)}" aria-label="Edit ${escapeHTML(dream.title)}" title="Edit">✎</button>
            <button class="icon-button danger" data-action="delete" data-id="${escapeHTML(dream.id)}" aria-label="Delete ${escapeHTML(dream.title)}" title="Delete">⌫</button>
          </div>
        </div>
      </div>
    `;

    elements.grid.appendChild(card);
  });
}

function resetPhotoPreview() {
  selectedPhoto = null;
  existingPhoto = null;
  photoWasRemoved = false;
  elements.photoInput.value = "";
  elements.photoPreview.src = "";
  elements.photoPreview.hidden = true;
  elements.uploadLabel.textContent = "Choose a photo from your device";
  elements.uploadBox.querySelector(".upload-icon").hidden = false;
  elements.removePhoto.hidden = true;
}

function showPhotoPreview(fileOrBlob, filename) {
  const url = URL.createObjectURL(fileOrBlob);
  elements.photoPreview.src = url;
  elements.photoPreview.hidden = false;
  elements.uploadBox.querySelector(".upload-icon").hidden = true;
  elements.uploadLabel.textContent = filename || "Current photo";
  elements.removePhoto.hidden = false;

  elements.photoPreview.onload = () => {
    URL.revokeObjectURL(url);
    elements.photoPreview.onload = null;
  };
}

function openAddDialog() {
  elements.form.reset();
  elements.dreamId.value = "";
  elements.dialogTitle.innerHTML = "Add a dream <span>✧</span>";
  elements.saveButton.textContent = "Save my dream ✧";
  resetPhotoPreview();
  elements.dialog.showModal();
  elements.title.focus();
}

function openEditDialog(id) {
  const dream = dreams.find(item => item.id === id);
  if (!dream) return;

  elements.form.reset();
  resetPhotoPreview();

  elements.dreamId.value = dream.id;
  elements.title.value = dream.title;
  elements.description.value = dream.description;
  elements.categoryInput.value = dream.category || "Other";
  elements.status.value = dream.status || "planned";
  elements.date.value = dream.targetDate || "";
  elements.budget.value = dream.budget ?? "";
  elements.location.value = dream.location || "";
  elements.notes.value = dream.notes || "";

  existingPhoto = dream.photo || null;
  if (existingPhoto) showPhotoPreview(existingPhoto, "Current photo — choose to replace");

  elements.dialogTitle.innerHTML = "Edit your dream <span>✧</span>";
  elements.saveButton.textContent = "Save changes ✧";
  elements.dialog.showModal();
  elements.title.focus();
}

function closeDialog() {
  elements.dialog.close();
  resetPhotoPreview();
}

function readPhotoFile(file) {
  if (!file) return;

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    showToast("Please choose a JPG, PNG, WebP or GIF image.");
    elements.photoInput.value = "";
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    showToast("Please choose an image smaller than 8 MB.");
    elements.photoInput.value = "";
    return;
  }

  selectedPhoto = file;
  photoWasRemoved = false;
  showPhotoPreview(file, file.name);
}

async function saveDream(event) {
  event.preventDefault();

  if (!elements.form.reportValidity()) return;

  const title = elements.title.value.trim();
  const description = elements.description.value.trim();

  if (!title || !description) {
    showToast("Please add a title and description.");
    return;
  }

  const id = elements.dreamId.value || createId();
  const existing = dreams.find(d => d.id === id);
  const photo = selectedPhoto
    ? selectedPhoto
    : photoWasRemoved
      ? null
      : existingPhoto || existing?.photo || null;

  const dream = {
    id,
    title,
    description,
    category: elements.categoryInput.value,
    status: elements.status.value,
    targetDate: elements.date.value,
    budget: elements.budget.value === "" ? "" : Number(elements.budget.value),
    location: elements.location.value.trim(),
    notes: elements.notes.value.trim(),
    photo,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "Saving...";

  try {
    await putRecord(DREAM_STORE, dream);
    await loadData();
    closeDialog();
    showToast(existing ? "Your dream has been updated ✧" : "A new dream added to your list ♡");
  } catch (error) {
    console.error(error);
    showToast("Could not save this dream. Your browser storage may be full.");
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = existing ? "Save changes ✧" : "Save my dream ✧";
  }
}

async function toggleComplete(id) {
  const dream = dreams.find(item => item.id === id);
  if (!dream) return;

  const wasCompleted = dream.status === "completed";
  const updated = {
    ...dream,
    status: wasCompleted ? "planned" : "completed",
    updatedAt: Date.now()
  };

  try {
    await putRecord(DREAM_STORE, updated);
    await loadData();
    showToast(wasCompleted ? "Dream moved back to your list." : "Dream accomplished! Celebrate this moment ✨");
  } catch (error) {
    console.error(error);
    showToast("Could not update this dream.");
  }
}

async function deleteDream(id) {
  const dream = dreams.find(item => item.id === id);
  if (!dream) return;

  const confirmed = window.confirm(`Delete "${dream.title}" from your bucket list? This cannot be undone.`);
  if (!confirmed) return;

  try {
    await deleteRecord(DREAM_STORE, id);
    await loadData();
    showToast("Dream removed from your list.");
  } catch (error) {
    console.error(error);
    showToast("Could not delete this dream.");
  }
}

function renderJournal() {
  elements.journalEntries.innerHTML = "";

  if (!journalEntries.length) {
    const hint = document.createElement("p");
    hint.className = "section-subtitle";
    hint.style.marginTop = "14px";
    hint.textContent = "Your saved reflections will appear here.";
    elements.journalEntries.appendChild(hint);
    return;
  }

  const sorted = [...journalEntries].sort((a, b) => b.createdAt - a.createdAt);

  sorted.forEach(entry => {
    const article = document.createElement("article");
    article.className = "journal-entry";

    const date = new Date(entry.createdAt);
    const dateText = Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat(undefined, {
          day: "numeric", month: "long", year: "numeric"
        }).format(date);

    article.innerHTML = `
      <div class="journal-entry-date">${escapeHTML(dateText)}</div>
      <p>${escapeHTML(entry.text)}</p>
      <div class="journal-entry-actions">
        <button class="icon-button" data-journal-action="edit" data-id="${escapeHTML(entry.id)}" aria-label="Edit journal entry">✎</button>
        <button class="icon-button danger" data-journal-action="delete" data-id="${escapeHTML(entry.id)}" aria-label="Delete journal entry">⌫</button>
      </div>
    `;

    elements.journalEntries.appendChild(article);
  });
}

async function saveJournal(event) {
  event.preventDefault();
  const text = elements.journalInput.value.trim();

  if (!text) {
    showToast("Write a little note before saving.");
    return;
  }

  const entry = {
    id: createId(),
    text,
    createdAt: Date.now()
  };

  try {
    await putRecord(JOURNAL_STORE, entry);
    elements.journalInput.value = "";
    await loadJournal();
    showToast("Your journal entry has been saved ♡");
  } catch (error) {
    console.error(error);
    showToast("Could not save your journal entry.");
  }
}

async function editJournalEntry(id) {
  const entry = journalEntries.find(item => item.id === id);
  if (!entry) return;

  const updatedText = window.prompt("Edit your journal entry:", entry.text);
  if (updatedText === null) return;
  if (!updatedText.trim()) {
    showToast("A journal entry cannot be empty.");
    return;
  }

  try {
    await putRecord(JOURNAL_STORE, { ...entry, text: updatedText.trim(), updatedAt: Date.now() });
    await loadJournal();
    showToast("Journal entry updated.");
  } catch (error) {
    console.error(error);
    showToast("Could not update this entry.");
  }
}

async function deleteJournalEntry(id) {
  const entry = journalEntries.find(item => item.id === id);
  if (!entry) return;

  if (!window.confirm("Delete this journal entry?")) return;

  try {
    await deleteRecord(JOURNAL_STORE, id);
    await loadJournal();
    showToast("Journal entry deleted.");
  } catch (error) {
    console.error(error);
    showToast("Could not delete this entry.");
  }
}

async function loadJournal() {
  journalEntries = await getAll(JOURNAL_STORE);
  renderJournal();
}

async function loadData() {
  dreams = await getAll(DREAM_STORE);
  dreams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  renderDreams();
  await loadJournal();
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read an image."));
    reader.readAsDataURL(blob);
  });
}

async function exportData() {
  try {
    const exportDreams = await Promise.all(dreams.map(async dream => ({
      ...dream,
      photo: dream.photo ? await blobToDataURL(dream.photo) : null
    })));

    const backup = {
      app: "Little Dreams — Life Bucket List",
      version: 1,
      exportedAt: new Date().toISOString(),
      dreams: exportDreams,
      journalEntries
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `little-dreams-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Your backup is ready to save.");
  } catch (error) {
    console.error(error);
    showToast("Could not export data. Try removing some large photos.");
  }
}

function setView(view) {
  activeView = view;

  document.querySelectorAll(".view-tab").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  renderDreams();
}

function connectEvents() {
  ["#addDreamBtn", "#heroAddBtn", "#secondAddBtn", "#emptyAddBtn"].forEach(selector => {
    $(selector).addEventListener("click", () => {
      if (selector === "#heroAddBtn") {
        $("#dreamsSection").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      openAddDialog();
    });
  });

  $("#closeDialogBtn").addEventListener("click", closeDialog);
  $("#cancelDialogBtn").addEventListener("click", closeDialog);
  elements.form.addEventListener("submit", saveDream);

  elements.dialog.addEventListener("click", event => {
    if (event.target === elements.dialog) closeDialog();
  });

  elements.photoInput.addEventListener("change", event => {
    readPhotoFile(event.target.files[0]);
  });

  elements.removePhoto.addEventListener("click", () => {
    selectedPhoto = null;
    existingPhoto = null;
    photoWasRemoved = true;
    elements.photoInput.value = "";
    elements.photoPreview.src = "";
    elements.photoPreview.hidden = true;
    elements.uploadLabel.textContent = "Choose a photo from your device";
    elements.uploadBox.querySelector(".upload-icon").hidden = false;
    elements.removePhoto.hidden = true;
  });

  elements.grid.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const { action, id } = button.dataset;
    if (action === "edit") openEditDialog(id);
    if (action === "delete") deleteDream(id);
    if (action === "toggle") toggleComplete(id);
  });

  document.querySelectorAll(".view-tab").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.search.addEventListener("input", renderDreams);
  elements.category.addEventListener("change", renderDreams);
  elements.sort.addEventListener("change", renderDreams);

  elements.journalForm.addEventListener("submit", saveJournal);

  elements.journalEntries.addEventListener("click", event => {
    const button = event.target.closest("button[data-journal-action]");
    if (!button) return;

    const { id, journalAction } = {
      id: button.dataset.id,
      journalAction: button.dataset.journalAction
    };

    if (journalAction === "edit") editJournalEntry(id);
    if (journalAction === "delete") deleteJournalEntry(id);
  });

  $("#exportBtn").addEventListener("click", exportData);

  $("#journalDateLabel").textContent = new Intl.DateTimeFormat(undefined, {
    day: "numeric", month: "long", year: "numeric"
  }).format(new Date());

  document.addEventListener("keydown", event => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable;

    if (event.key === "/" && !typing && !elements.dialog.open) {
      event.preventDefault();
      elements.search.focus();
    }

    if (event.key === "Escape" && elements.dialog.open) {
      closeDialog();
    }
  });
}

async function init() {
  connectEvents();

  try {
    db = await openDatabase();
    await loadData();
  } catch (error) {
    console.error(error);
    elements.empty.hidden = false;
    elements.grid.hidden = true;
    elements.emptyTitle.textContent = "Your browser storage is unavailable.";
    elements.emptyText.textContent =
      "Try opening this website in a modern browser, using a local web server, and allowing site storage.";
    $("#emptyAddBtn").hidden = true;
    showToast("Could not open browser storage. Check your browser settings.");
  }
}

document.addEventListener("DOMContentLoaded", init);
