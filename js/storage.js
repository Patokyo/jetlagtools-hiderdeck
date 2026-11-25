// localStorage persistence. Debounced writes, never throws at the caller.

const KEY = "hiderdeck:run";
const SETTINGS_KEY = "hiderdeck:settings";
const WRITE_DELAY = 180;

let timer = null;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("[storage] could not read saved run", err);
    return null;
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("[storage] could not read settings", err);
    return {};
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[storage] could not save settings", err);
  }
}

export function save(state) {
  clearTimeout(timer);
  timer = setTimeout(() => write(state), WRITE_DELAY);
}

/** Write immediately — used before a reset so nothing stale is restored. */
export function saveNow(state) {
  clearTimeout(timer);
  write(state);
}

export function clear() {
  clearTimeout(timer);
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    console.warn("[storage] could not clear saved run", err);
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[storage] could not save run", err);
  }
}
