export const fallbackTimezones = [
  "UTC",
  "Asia/Karachi",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Manila",
  "Australia/Sydney",
];

export function supportedTimezones() {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }
  return fallbackTimezones;
}

export function formatDateTime(value: string | Date | null | undefined, timezone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function formatDate(value: string | Date | null | undefined, timezone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: timezone,
    year: "numeric",
  }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined, timezone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

export function formatDateTimeFull(value: string | Date | null | undefined, timezone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function todayDateInputValue(timezone: string) {
  return dateInputValue(new Date(), timezone);
}

export function dateInputValue(value: string | Date, timezone: string) {
  const parts = dateParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function startOfDayIso(dateInput: string, timezone: string) {
  return zonedDateTimeToUtc(dateInput, "00:00", timezone).toISOString();
}

export function endOfDayIso(dateInput: string, timezone: string) {
  return zonedDateTimeToUtc(dateInput, "23:59", timezone, 59, 999).toISOString();
}

export function zonedDateTimeToUtc(dateInput: string, timeInput: string, timezone: string, second = 0, millisecond = 0) {
  const [year, month, day] = dateInput.split("-").map(Number);
  const [hour, minute] = timeInput.split(":").map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

  for (let index = 0; index < 3; index += 1) {
    const parts = dateTimeParts(guess, timezone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, millisecond);
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    guess = new Date(guess.getTime() + (targetUtc - asUtc));
  }

  return guess;
}

function dateParts(value: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(value));

  return {
    day: Number(parts.find((part) => part.type === "day")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}

function dateTimeParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(value);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    second: Number(parts.find((part) => part.type === "second")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}
