(() => {
  const STATE_KEY = "__browserTimezoneSpooferMainInstalled";
  const CONFIG_EVENT = "browser-timezone-spoofer-config";
  const CACHE_KEY = "__browserTimezoneSpooferLastConfig";

  if (window[STATE_KEY]) return;
  window[STATE_KEY] = true;

  const NativeDate = Date;
  const NativeIntlDateTimeFormat = Intl.DateTimeFormat;
  const nativeResolvedOptions = NativeIntlDateTimeFormat.prototype.resolvedOptions;
  const nativeGetTime = NativeDate.prototype.getTime;
  const nativeGetTimezoneOffset = NativeDate.prototype.getTimezoneOffset;
  const nativeToString = NativeDate.prototype.toString;
  const nativeToTimeString = NativeDate.prototype.toTimeString;
  const nativeToDateString = NativeDate.prototype.toDateString;
  const nativeToLocaleString = NativeDate.prototype.toLocaleString;
  const nativeToLocaleDateString = NativeDate.prototype.toLocaleDateString;
  const nativeToLocaleTimeString = NativeDate.prototype.toLocaleTimeString;

  const config = {
    enabled: false,
    timeZone: "",
  };

  applyCachedConfig();

  window.addEventListener(CONFIG_EVENT, (event) => {
    applyConfig(event.detail || {});
  });

  function PatchedDate(...args) {
    if (!(this instanceof PatchedDate)) {
      return new PatchedDate().toString();
    }

    if (args.length >= 2 && isEnabled()) {
      return new NativeDate(localPartsToEpoch(args));
    }

    return new NativeDate(...args);
  }

  Object.setPrototypeOf(PatchedDate, NativeDate);
  PatchedDate.prototype = NativeDate.prototype;
  Object.defineProperty(PatchedDate.prototype, "constructor", {
    value: PatchedDate,
    writable: true,
    configurable: true,
  });

  PatchedDate.now = NativeDate.now.bind(NativeDate);
  PatchedDate.parse = NativeDate.parse.bind(NativeDate);
  PatchedDate.UTC = NativeDate.UTC.bind(NativeDate);

  NativeDate.prototype.getTimezoneOffset = function () {
    if (!isEnabled()) return nativeGetTimezoneOffset.call(this);
    return getTimezoneOffsetFor(nativeGetTime.call(this), config.timeZone);
  };

  NativeDate.prototype.getFullYear = function () {
    if (!isEnabled()) return nativeCall("getFullYear", this);
    return getParts(nativeGetTime.call(this), config.timeZone).year;
  };

  NativeDate.prototype.getMonth = function () {
    if (!isEnabled()) return nativeCall("getMonth", this);
    return getParts(nativeGetTime.call(this), config.timeZone).month - 1;
  };

  NativeDate.prototype.getDate = function () {
    if (!isEnabled()) return nativeCall("getDate", this);
    return getParts(nativeGetTime.call(this), config.timeZone).day;
  };

  NativeDate.prototype.getDay = function () {
    if (!isEnabled()) return nativeCall("getDay", this);
    const parts = getParts(nativeGetTime.call(this), config.timeZone);
    return new NativeDate(NativeDate.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  };

  NativeDate.prototype.getHours = function () {
    if (!isEnabled()) return nativeCall("getHours", this);
    return getParts(nativeGetTime.call(this), config.timeZone).hour;
  };

  NativeDate.prototype.getMinutes = function () {
    if (!isEnabled()) return nativeCall("getMinutes", this);
    return getParts(nativeGetTime.call(this), config.timeZone).minute;
  };

  NativeDate.prototype.getSeconds = function () {
    if (!isEnabled()) return nativeCall("getSeconds", this);
    return getParts(nativeGetTime.call(this), config.timeZone).second;
  };

  NativeDate.prototype.getMilliseconds = function () {
    if (!isEnabled()) return nativeCall("getMilliseconds", this);
    return new NativeDate(nativeGetTime.call(this)).getUTCMilliseconds();
  };

  NativeDate.prototype.toLocaleString = function (locales, options) {
    if (!isEnabled()) return nativeToLocaleString.call(this, locales, options);
    return nativeToLocaleString.call(this, locales, withTimeZone(options));
  };

  NativeDate.prototype.toLocaleDateString = function (locales, options) {
    if (!isEnabled()) return nativeToLocaleDateString.call(this, locales, options);
    return nativeToLocaleDateString.call(this, locales, withTimeZone(options));
  };

  NativeDate.prototype.toLocaleTimeString = function (locales, options) {
    if (!isEnabled()) return nativeToLocaleTimeString.call(this, locales, options);
    return nativeToLocaleTimeString.call(this, locales, withTimeZone(options));
  };

  NativeDate.prototype.toString = function () {
    if (!isEnabled()) return nativeToString.call(this);
    return formatDateTimeString(nativeGetTime.call(this), config.timeZone);
  };

  NativeDate.prototype.toTimeString = function () {
    if (!isEnabled()) return nativeToTimeString.call(this);
    const text = formatDateTimeString(nativeGetTime.call(this), config.timeZone);
    return text.replace(/^\w{3} \w{3} \d{2} \d{4} /, "");
  };

  NativeDate.prototype.toDateString = function () {
    if (!isEnabled()) return nativeToDateString.call(this);
    const p = getParts(nativeGetTime.call(this), config.timeZone);
    return `${WEEKDAYS[p.weekday]} ${MONTHS[p.month - 1]} ${pad(p.day)} ${p.year}`;
  };

  function PatchedDateTimeFormat(locales, options = {}) {
    const nextOptions = shouldInjectTimeZone(options) ? { ...options, timeZone: config.timeZone } : options;
    return new NativeIntlDateTimeFormat(locales, nextOptions);
  }

  Object.setPrototypeOf(PatchedDateTimeFormat, NativeIntlDateTimeFormat);
  PatchedDateTimeFormat.prototype = NativeIntlDateTimeFormat.prototype;

  NativeIntlDateTimeFormat.prototype.resolvedOptions = function () {
    const options = nativeResolvedOptions.call(this);
    if (!isEnabled()) return options;
    return { ...options, timeZone: config.timeZone };
  };

  Intl.DateTimeFormat = PatchedDateTimeFormat;
  window.Date = PatchedDate;

  function applyCachedConfig() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || localStorage.getItem(CACHE_KEY) || "null");
      if (cached) applyConfig(cached, false);
    } catch {
      // ignore cache errors
    }
  }

  function applyConfig(detail, persist = true) {
    config.enabled = Boolean(detail.enabled && isValidTimeZone(detail.timeZone));
    config.timeZone = config.enabled ? detail.timeZone : "";

    if (!persist) return;
    try {
      const cacheValue = JSON.stringify({ enabled: config.enabled, timeZone: config.timeZone });
      sessionStorage.setItem(CACHE_KEY, cacheValue);
      localStorage.setItem(CACHE_KEY, cacheValue);
    } catch {
      // ignore cache errors
    }
  }

  function isEnabled() {
    return config.enabled && Boolean(config.timeZone);
  }

  function shouldInjectTimeZone(options) {
    return isEnabled() && (!options || !Object.prototype.hasOwnProperty.call(options, "timeZone"));
  }

  function withTimeZone(options) {
    if (!shouldInjectTimeZone(options)) return options;
    return { ...(options || {}), timeZone: config.timeZone };
  }

  function nativeCall(method, date) {
    return Function.call.call(NativeDate.prototype[method], date);
  }

  function getParts(epochMs, timeZone) {
    const formatter = new NativeIntlDateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const values = {};
    for (const part of formatter.formatToParts(new NativeDate(epochMs))) {
      if (part.type !== "literal") values[part.type] = part.value;
    }

    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
      millisecond: new NativeDate(epochMs).getUTCMilliseconds(),
      weekday: WEEKDAYS.indexOf(values.weekday),
    };
  }

  function getTimezoneOffsetFor(epochMs, timeZone) {
    const p = getParts(epochMs, timeZone);
    const asUtc = NativeDate.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
    return Math.round((epochMs - asUtc) / 60000);
  }

  function localPartsToEpoch(args) {
    const year = Number(args[0]);
    const month = Number(args[1]);
    const day = args.length > 2 ? Number(args[2]) : 1;
    const hour = args.length > 3 ? Number(args[3]) : 0;
    const minute = args.length > 4 ? Number(args[4]) : 0;
    const second = args.length > 5 ? Number(args[5]) : 0;
    const millisecond = args.length > 6 ? Number(args[6]) : 0;
    const localUtc = NativeDate.UTC(year, month, day, hour, minute, second, millisecond);
    let guess = localUtc;

    for (let i = 0; i < 4; i += 1) {
      const offset = getTimezoneOffsetFor(guess, config.timeZone);
      const next = localUtc + offset * 60000;
      if (next === guess) break;
      guess = next;
    }

    return guess;
  }

  function formatDateTimeString(epochMs, timeZone) {
    const p = getParts(epochMs, timeZone);
    const offset = getTimezoneOffsetFor(epochMs, timeZone);
    const gmt = formatGmtOffset(offset);
    const zoneName = getTimeZoneName(epochMs, timeZone);
    return `${WEEKDAYS[p.weekday]} ${MONTHS[p.month - 1]} ${pad(p.day)} ${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${gmt} (${zoneName})`;
  }

  function getTimeZoneName(epochMs, timeZone) {
    const formatter = new NativeIntlDateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const part = formatter.formatToParts(new NativeDate(epochMs)).find((item) => item.type === "timeZoneName");
    return part?.value || timeZone;
  }

  function formatGmtOffset(offsetMinutes) {
    const total = -offsetMinutes;
    const sign = total >= 0 ? "+" : "-";
    const abs = Math.abs(total);
    return `GMT${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
  }

  function isValidTimeZone(timeZone) {
    if (!timeZone) return false;
    try {
      new NativeIntlDateTimeFormat("en-US", { timeZone });
      return true;
    } catch {
      return false;
    }
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
})();
