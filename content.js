(() => {
  const STATE_KEY = "__browserTimezoneSpooferContentInstalled";
  const CONFIG_EVENT = "browser-timezone-spoofer-config";
  const CACHE_KEY = "__browserTimezoneSpooferLastConfig";

  if (window[STATE_KEY]) return;
  window[STATE_KEY] = true;

  const DEFAULTS = {
    enabled: true,
    mode: "auto",
    manualTimeZone: "Asia/Shanghai",
    autoTimeZone: { timeZone: "" },
  };

  syncConfig();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (["enabled", "mode", "manualTimeZone", "autoTimeZone"].some((key) => changes[key])) {
      syncConfig();
    }
  });

  async function syncConfig() {
    const state = await chrome.storage.local.get(DEFAULTS);
    const config = buildEffectiveConfig(state);
    cacheConfig(config);
    window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: config }));
  }

  function buildEffectiveConfig(state) {
    const enabled = state.enabled !== false;
    const mode = state.mode === "manual" ? "manual" : "auto";
    const autoTimeZone = state.autoTimeZone || {};
    const timeZone = mode === "manual" ? state.manualTimeZone : autoTimeZone.timeZone;

    return {
      enabled: enabled && isValidTimeZone(timeZone),
      mode,
      timeZone: isValidTimeZone(timeZone) ? timeZone : "",
      source: mode,
      updatedAt: Date.now(),
    };
  }

  function cacheConfig(config) {
    try {
      const cacheValue = JSON.stringify({ enabled: config.enabled, timeZone: config.timeZone });
      sessionStorage.setItem(CACHE_KEY, cacheValue);
      localStorage.setItem(CACHE_KEY, cacheValue);
    } catch {
      // ignore cache errors
    }
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
})();
