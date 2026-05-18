const DEFAULTS = {
  enabled: true,
  mode: "auto",
  manualTimeZone: "Asia/Shanghai",
  autoTimeZone: {
    timeZone: "",
    ip: "",
    country: "",
    region: "",
    city: "",
    provider: "",
    fetchedAt: 0,
    error: "",
  },
};

const enabledEl = document.querySelector("#enabled");
const modeEl = document.querySelector("#mode");
const manualTimeZoneEl = document.querySelector("#manualTimeZone");
const manualTimeZoneFieldEl = document.querySelector("#manualTimeZoneField");
const refreshButton = document.querySelector("#refreshButton");
const effectiveTimeZoneEl = document.querySelector("#effectiveTimeZone");
const autoTimeZoneEl = document.querySelector("#autoTimeZone");
const providerEl = document.querySelector("#provider");
const candidatesEl = document.querySelector("#candidates");
const ipEl = document.querySelector("#ip");
const locationEl = document.querySelector("#location");
const fetchedAtEl = document.querySelector("#fetchedAt");
const statusEl = document.querySelector("#status");
const timezoneListEl = document.querySelector("#timezoneList");

init();

async function init() {
  renderTimeZoneOptions();
  await render();

  enabledEl.addEventListener("change", async () => {
    await chrome.storage.local.set({ enabled: enabledEl.checked });
    await render();
  });

  modeEl.addEventListener("change", async () => {
    await chrome.storage.local.set({ mode: modeEl.value });
    await render();
  });

  manualTimeZoneEl.addEventListener("change", saveManualTimeZone);
  manualTimeZoneEl.addEventListener("blur", saveManualTimeZone);

  refreshButton.addEventListener("click", refreshAutoTimeZone);

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "local") render();
  });
}

async function render() {
  const state = await chrome.storage.local.get(DEFAULTS);
  const autoTimeZone = state.autoTimeZone || DEFAULTS.autoTimeZone;
  const effectiveTimeZone = getEffectiveTimeZone(state);

  enabledEl.checked = state.enabled !== false;
  modeEl.value = state.mode === "manual" ? "manual" : "auto";
  manualTimeZoneEl.value = state.manualTimeZone || DEFAULTS.manualTimeZone;
  manualTimeZoneEl.disabled = modeEl.value !== "manual";
  manualTimeZoneFieldEl.hidden = modeEl.value !== "manual";

  effectiveTimeZoneEl.textContent = effectiveTimeZone ? formatTimeZoneDisplay(effectiveTimeZone) : "未生效";
  autoTimeZoneEl.textContent = autoTimeZone.timeZone ? formatTimeZoneDisplay(autoTimeZone.timeZone) : "未识别";
  providerEl.textContent = autoTimeZone.provider || "-";
  candidatesEl.textContent = Array.isArray(autoTimeZone.candidates) ? autoTimeZone.candidates.join(" | ") : "-";
  ipEl.textContent = autoTimeZone.ip || "-";
  locationEl.textContent = [autoTimeZone.country, autoTimeZone.region, autoTimeZone.city].filter(Boolean).join(" / ") || "-";
  fetchedAtEl.textContent = autoTimeZone.fetchedAt ? new Date(autoTimeZone.fetchedAt).toLocaleString() : "-";

  if (autoTimeZone.error) {
    setStatus(autoTimeZone.error, "error");
  } else if (effectiveTimeZone) {
    setStatus("已启用", "success");
  } else {
    setStatus("未启用或时区无效", "muted");
  }
}

async function saveManualTimeZone() {
  const timeZone = manualTimeZoneEl.value.trim();
  if (!isValidTimeZone(timeZone)) {
    setStatus("手动时区无效，请输入 IANA 时区，如 Asia/Shanghai", "error");
    return;
  }

  await chrome.storage.local.set({ manualTimeZone: timeZone });
  await render();
}

async function refreshAutoTimeZone() {
  refreshButton.disabled = true;
  setStatus("正在刷新出口 IP 时区...", "muted");

  chrome.runtime.sendMessage({ type: "refresh-auto-timezone" }, async (response) => {
    refreshButton.disabled = false;

    if (!response?.ok) {
      setStatus(response?.error || "刷新失败", "error");
      await render();
      return;
    }

    setStatus("刷新成功", "success");
    await render();
  });
}

function getEffectiveTimeZone(state) {
  if (state.enabled === false) return "";
  if (state.mode === "manual") return isValidTimeZone(state.manualTimeZone) ? state.manualTimeZone : "";
  const timeZone = state.autoTimeZone?.timeZone;
  return isValidTimeZone(timeZone) ? timeZone : "";
}

function formatTimeZoneDisplay(timeZone) {
  const now = new Date();
  const offset = getTimezoneOffsetFor(now, timeZone);
  const zoneName = getTimeZoneName(now, timeZone);
  return `${formatGmtOffset(offset)} (${zoneName}) · ${timeZone}`;
}

function getTimezoneOffsetFor(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
    date.getUTCMilliseconds(),
  );

  return Math.round((date.getTime() - asUtc) / 60000);
}

function getTimeZoneName(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const part = formatter.formatToParts(date).find((item) => item.type === "timeZoneName");
  return part?.value || timeZone;
}

function formatGmtOffset(offsetMinutes) {
  const total = -offsetMinutes;
  const sign = total >= 0 ? "+" : "-";
  const abs = Math.abs(total);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

function isValidTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type || "muted";
}

function renderTimeZoneOptions() {
  if (typeof Intl.supportedValuesOf !== "function") return;
  const zones = Intl.supportedValuesOf("timeZone");
  timezoneListEl.innerHTML = zones.map((zone) => `<option value="${zone}"></option>`).join("");
}
