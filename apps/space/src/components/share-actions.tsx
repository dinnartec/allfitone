/**
 * What every share screen does with an image made on the phone: «Historias», «Guardar»,
 * «Copiar» and «Más», behind one busy flag and one toast (ADR-036).
 *
 * «Compártelo» and «Comparte tu semana» draw different things and capture them their
 * own way; what happens to the picture afterwards is the same, so it lives here once.
 * Nothing is uploaded: the image goes from the capture to the system, to Photos, to
 * the clipboard or to Instagram's composer.
 *
 * **«Historias» needs Meta's app id and Instagram on the phone.** Without either it
 * opens the system sheet, as «Más» always does (`storyRoute`).
 */

import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { InstagramGlyph, instagramGradient } from '@allfitone/react-native/third-party'
import { useTheme } from '@allfitone/react-native/theme'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import * as MediaLibrary from 'expo-media-library'
import * as SecureStore from 'expo-secure-store'
import * as Sharing from 'expo-sharing'
import { useEffect, useState } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import Share, { Social } from 'react-native-share'

import { storyRoute } from '../client/share-cards'

export type Notice = { readonly tone: 'done' | 'failed'; readonly text: string }

export const SAVE_FAILED = 'No pudimos guardar la imagen. Inténtalo de nuevo.'
export const SHARE_FAILED = 'No pudimos preparar la imagen. Inténtalo de nuevo.'
const NO_PERMISSION = 'Para guardarla, permite a Allfit añadir fotos en Ajustes.'

export type ShareMode = 'image' | 'sticker'

const MODE_KEY = 'share-mode'
const isMode = (value: string | null): value is ShareMode =>
  value === 'image' || value === 'sticker'

/** «Imagen» or «Sticker», remembered on the phone across every share screen. */
export function useShareMode(): readonly [ShareMode, (next: ShareMode) => void] {
  const [mode, setMode] = useState<ShareMode>('image')
  useEffect(() => {
    SecureStore.getItemAsync(MODE_KEY)
      .then((stored) => {
        if (isMode(stored)) setMode(stored)
      })
      .catch(() => undefined)
  }, [])
  const choose = (next: ShareMode) => {
    setMode(next)
    SecureStore.setItemAsync(MODE_KEY, next).catch(() => undefined)
  }
  return [mode, choose]
}

/** One action at a time, and the toast that says how it went. */
export function useShareRun() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)

  const run = (action: () => Promise<Notice | undefined>, failure: string) => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    action()
      .then((next) => {
        if (!next) return
        setNotice(next)
        if (next.tone === 'done')
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      })
      .catch(() => setNotice({ tone: 'failed', text: failure }))
      .finally(() => setBusy(false))
  }

  return { busy, notice, clear: () => setNotice(undefined), run }
}

/** The system sheet: every app the phone has, Instagram among them. */
export async function shareFile(uri: string, dialogTitle: string): Promise<undefined> {
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle })
  return undefined
}

export async function saveFile(uri: string, done: string): Promise<Notice> {
  const permission = await MediaLibrary.requestPermissionsAsync(true)
  if (!permission.granted) return { tone: 'failed', text: NO_PERMISSION }
  await MediaLibrary.Asset.create(uri)
  return { tone: 'done', text: done }
}

export async function copyImage(base64: string, done: string): Promise<Notice> {
  await Clipboard.setImageAsync(base64)
  return { tone: 'done', text: done }
}

/**
 * Instagram's story composer with the sticker over a ground: a photograph when there
 * is one, else the two inks. False when it cannot open, so the caller falls back.
 */
export async function openStory(input: {
  readonly sticker: string
  readonly inks: { readonly top: string; readonly bottom: string }
  readonly background?: string | undefined
}): Promise<boolean> {
  const appId = process.env.EXPO_PUBLIC_META_APP_ID
  const installed = await Linking.canOpenURL('instagram-stories://share').catch(() => false)
  if (storyRoute(appId, installed) === 'sheet' || !appId) return false
  await Share.shareSingle({
    social: Social.InstagramStories,
    appId,
    stickerImage: `data:image/png;base64,${input.sticker}`,
    ...(input.background
      ? { backgroundImage: input.background }
      : { backgroundTopColor: input.inks.top, backgroundBottomColor: input.inks.bottom }),
  })
  return true
}

export interface ShareAction {
  readonly label: string
  readonly icon: IconName | 'instagram'
  readonly onPress: () => void
  /** The one the screen leads with, filled in cyan. */
  readonly primary?: boolean
}

/** The round buttons under the cards, Instagram's on its own gradient. */
export function ShareActionRow({
  actions,
  busy,
}: {
  readonly actions: readonly ShareAction[]
  readonly busy: boolean
}) {
  const theme = useTheme()
  return (
    <View style={styles.actions}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: busy }}
          style={styles.action}
          testID={`share-${action.label}`}
        >
          {action.icon === 'instagram' ? (
            // Instagram's own mark on its own gradient, as Meta's guidelines show it.
            <LinearGradient
              colors={[...instagramGradient]}
              start={{ x: 0, y: 1 }}
              end={{ x: 1, y: 0 }}
              style={styles.round}
            >
              <InstagramGlyph size={24} decorative />
            </LinearGradient>
          ) : (
            <View
              style={[
                styles.round,
                action.primary
                  ? { backgroundColor: theme.color.action.primary }
                  : {
                      backgroundColor: theme.color.background.surface,
                      borderColor: theme.color.border.subtle,
                      borderWidth: 1,
                    },
              ]}
            >
              <FoundationIcon
                name={action.icon}
                customSize={22}
                color={action.primary ? theme.color.action.onPrimary : theme.color.text.primary}
                decorative
              />
            </View>
          )}
          <Text role="body" size="xs" color="muted" numberOfLines={1}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  action: { width: 64, alignItems: 'center', gap: 7 },
  round: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
