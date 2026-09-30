/**
 * The notice that a rest is over, for when the session is not on screen (ADR-035).
 *
 * The only file that touches `expo-notifications`. It schedules a **local** notification
 * on the phone itself: no push, no server, no APNs entitlement. That last part matters
 * beyond tidiness — the library's config plugin would add the push entitlement, and the
 * development signing profile cannot carry it, so the plugin is deliberately not listed.
 *
 * **Nothing here may break the session.** A refused permission, a platform that says no,
 * a scheduling error: each one only loses the notice. The countdown and its vibration
 * belong to the screen and go on regardless.
 */

import { Platform } from 'react-native'

import { restEndNotice } from './rest-lines'

type NotificationsModule = typeof import('expo-notifications')

const CHANNEL = 'rest'

let scheduled: string | undefined
let prepared: Promise<NotificationsModule | undefined> | undefined

/**
 * Loaded on first use, not imported: a build made before the native module existed
 * throws while evaluating it, and that must cost the notice, not the whole app.
 */
function ready(): Promise<NotificationsModule | undefined> {
  prepared ??= (async () => {
    const Notifications = await import('expo-notifications')
    // In the foreground the screen already says it, and a banner would say it twice.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    })
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Descanso',
        importance: Notifications.AndroidImportance.HIGH,
      })
    }
    const current = await Notifications.getPermissionsAsync()
    if (current.granted) return Notifications
    if (!current.canAskAgain) return undefined
    return (await Notifications.requestPermissionsAsync()).granted ? Notifications : undefined
  })().catch(() => undefined)
  return prepared
}

/** Replaces whatever was scheduled with a notice when this rest ends. */
export async function announceRestEnd(endsAt: number, movement: string): Promise<void> {
  await cancelRestEnd()
  const seconds = Math.round((endsAt - Date.now()) / 1000)
  if (seconds < 1) return
  const Notifications = await ready()
  if (!Notifications) return
  try {
    scheduled = await Notifications.scheduleNotificationAsync({
      content: { ...restEndNotice(movement, endsAt / 1000), sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
      },
    })
  } catch {
    scheduled = undefined
  }
}

/** Skipped, restarted or over on screen: the notice it had is no longer true. */
export async function cancelRestEnd(): Promise<void> {
  const identifier = scheduled
  scheduled = undefined
  if (!identifier) return
  const Notifications = await ready()
  await Notifications?.cancelScheduledNotificationAsync(identifier).catch(() => undefined)
}
