const DEFAULT_STATE = {
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

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  chrome.alarms.create("refresh-auto-timezone", { periodInMinutes: 60 });
  refreshAutoTimeZone().catch(console.warn);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  refreshAutoTimeZone().catch(console.warn);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh-auto-timezone") {
    refreshAutoTimeZoneIfAuto();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "refresh-auto-timezone") return false;

  refreshAutoTimeZone()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function ensureDefaults() {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  const next = {};

  for (const [key, value] of Object.entries(DEFAULT_STATE)) {
    if (current[key] === undefined) next[key] = value;
  }

  if (Object.keys(next).length) {
    await chrome.storage.local.set(next);
  }
}

async function refreshAutoTimeZoneIfAuto() {
  const { mode } = await chrome.storage.local.get({ mode: DEFAULT_STATE.mode });
  if (mode === "auto") {
    await refreshAutoTimeZone().catch(console.warn);
  }
}

async function refreshAutoTimeZone() {
  await ensureDefaults();

  const providers = [fetchFromIpApi, fetchFromIpInfo, fetchFromWorldTimeApi, fetchFromIpApiCo, fetchFromIpWhoIs];
  const settled = await Promise.allSettled(providers.map((provider) => provider()));
  const successes = [];
  const errors = [];

  for (const item of settled) {
    if (item.status === "rejected") {
      errors.push(item.reason?.message || String(item.reason));
      continue;
    }

    if (!isValidTimeZone(item.value.timeZone)) {
      errors.push(`${item.value.provider} invalid timezone: ${item.value.timeZone}`);
      continue;
    }

    successes.push(item.value);
  }

  if (successes.length) {
    const selected = chooseBestTimeZoneResult(successes);
    const autoTimeZone = {
      ...selected,
      candidates: successes.map((item) => `${item.provider}:${item.timeZone}${item.ip ? `@${item.ip}` : ""}`),
      fetchedAt: Date.now(),
      error: "",
    };
    await chrome.storage.local.set({ autoTimeZone });
    return autoTimeZone;
  }

  const autoTimeZone = {
    ...DEFAULT_STATE.autoTimeZone,
    fetchedAt: Date.now(),
    error: errors.join("; ") || "Failed to detect timezone",
  };
  await chrome.storage.local.set({ autoTimeZone });
  throw new Error(autoTimeZone.error);
}

async function fetchFromIpApi() {
  const response = await fetch("https://ipapi.com/ip_api.php", { cache: "no-store" });
  if (!response.ok) throw new Error(`ipapi.com ${response.status}`);
  const data = await response.json();
  if (data.success === false) throw new Error(data.error?.info || "ipapi.com failed");

  return {
    timeZone: data.time_zone?.id || "",
    ip: data.ip || "",
    country: data.country_name || data.country_code || "",
    region: data.region_name || "",
    city: data.city || "",
    provider: "ipapi.com",
  };
}

async function fetchFromIpApiCo() {
  const response = await fetch("https://ipapi.co/json/", { cache: "no-store" });
  if (!response.ok) throw new Error(`ipapi.co ${response.status}`);
  const data = await response.json();

  return {
    timeZone: data.timezone || "",
    ip: data.ip || "",
    country: data.country_name || data.country || "",
    region: data.region || "",
    city: data.city || "",
    provider: "ipapi.co",
  };
}

async function fetchFromIpWhoIs() {
  const response = await fetch("https://ipwho.is/", { cache: "no-store" });
  if (!response.ok) throw new Error(`ipwho.is ${response.status}`);
  const data = await response.json();
  if (data.success === false) throw new Error(data.message || "ipwho.is failed");

  return {
    timeZone: data.timezone?.id || "",
    ip: data.ip || "",
    country: data.country || "",
    region: data.region || "",
    city: data.city || "",
    provider: "ipwho.is",
  };
}

async function fetchFromIpInfo() {
  const response = await fetch("https://ipinfo.io/json", { cache: "no-store" });
  if (!response.ok) throw new Error(`ipinfo.io ${response.status}`);
  const data = await response.json();

  return {
    timeZone: data.timezone || "",
    ip: data.ip || "",
    country: data.country || "",
    region: data.region || "",
    city: data.city || "",
    provider: "ipinfo.io",
  };
}

async function fetchFromWorldTimeApi() {
  const response = await fetch("https://worldtimeapi.org/api/ip", { cache: "no-store" });
  if (!response.ok) throw new Error(`worldtimeapi.org ${response.status}`);
  const data = await response.json();

  return {
    timeZone: data.timezone || "",
    ip: data.client_ip || "",
    country: "",
    region: "",
    city: "",
    provider: "worldtimeapi.org",
  };
}

function chooseBestTimeZoneResult(results) {
  const counts = new Map();
  for (const result of results) {
    counts.set(result.timeZone, (counts.get(result.timeZone) || 0) + 1);
  }

  const sorted = [...results].sort((a, b) => {
    const byCount = (counts.get(b.timeZone) || 0) - (counts.get(a.timeZone) || 0);
    if (byCount !== 0) return byCount;
    return providerPriority(a.provider) - providerPriority(b.provider);
  });

  return sorted[0];
}

function providerPriority(provider) {
  return ["ipapi.com", "ipinfo.io", "worldtimeapi.org", "ipapi.co", "ipwho.is"].indexOf(provider);
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
