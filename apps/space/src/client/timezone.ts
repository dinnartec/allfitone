/**
 * The zone the phone is in, for the commands that need one.
 *
 * Taking a programme materialises a calendar, and `OP-PLN-011` refuses a request whose
 * timezone is not a name the database knows — so this has to answer a real IANA name or
 * the command fails before it writes anything.
 *
 * It was written out four times across the app with two different fallbacks: `'UTC'` in
 * one screen and `'America/Bogota'` in two others. Guessing Colombia is worse than
 * admitting ignorance, because a wrong zone silently plants somebody's week on the wrong
 * days, so the fallback here is `UTC` everywhere.
 *
 * `Intl` can throw on a device with no ICU data, which is why the read is guarded rather
 * than trusted.
 */
export const FALLBACK_TIMEZONE = 'UTC'

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE
  } catch {
    return FALLBACK_TIMEZONE
  }
}
