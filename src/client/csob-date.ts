import { customerPaymentInvariant } from "./errors"

const PRAGUE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

const DATE_TIME_PATTERN = /^\d{14}$/

export const formatCsobDateTime = (value: Date): string => {
  customerPaymentInvariant(
    Number.isFinite(value.getTime()),
    "CSOB_DATE_TIME_INVALID",
    "ČSOB request date and time is invalid.",
  )

  const parts = Object.fromEntries(
    PRAGUE_DATE_TIME_FORMATTER.formatToParts(value).map((part) => [
      part.type,
      part.value,
    ]),
  )

  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`
}

export const isCsobDateTime = (value: string): boolean => {
  if (!DATE_TIME_PATTERN.test(value)) {
    return false
  }

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const hour = Number(value.slice(8, 10))
  const minute = Number(value.slice(10, 12))
  const second = Number(value.slice(12, 14))
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  )
}
