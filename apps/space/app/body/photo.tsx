/**
 * Taking a progress photo (`REG-4`, OP-IDN-056). Pro (`body_photos`).
 *
 * **The last photo shows through the camera**, faint and tinted, so the new one is
 * taken from the same place: two photos compared side by side only mean something when
 * the distance, the height and the pose match. It can be switched off.
 *
 * A three-second timer is there for the mirror and the shelf; the gallery for a photo
 * taken before. What is sent is the same reduced JPEG the meals send; the API strips
 * its metadata and keeps it under the person, readable by nobody else.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { CoverTile } from '@allfitone/react-native/cover-tile'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { shortDay, type BodyPhoto } from '../../src/client/body'
import { readBodyPhotos, recordBodyPhoto } from '../../src/client/body-transport'
import { deviceTimezone } from '../../src/client/timezone'
import { preparePhoto } from '../../src/components/prepare-photo'
import { usePlan, useUpgradeSheet } from '../../src/components/upgrade-sheet'

const SAVE_FAILED = 'No pudimos guardar tu foto. Inténtalo otra vez.'
const TIMER_SECONDS = 3

export default function BodyPhotoScreen() {
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const features = usePlan()
  const upgrade = useUpgradeSheet(features)
  const camera = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()

  const [last, setLast] = useState<BodyPhoto | undefined>(undefined)
  const [ghost, setGhost] = useState(true)
  const [timer, setTimer] = useState(false)
  const [counting, setCounting] = useState<number | undefined>(undefined)
  const [facing, setFacing] = useState<CameraType>('back')
  const [taken, setTaken] = useState<{ readonly uri: string; readonly base64: string } | undefined>(
    undefined,
  )
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    readBodyPhotos()
      .then((read) => active && setLast(read[0]))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const capture = async () => {
    const picture = await camera.current?.takePictureAsync({ quality: 0.8 })
    if (!picture) return
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const prepared = await preparePhoto(picture)
    if (prepared) setTaken(prepared)
  }

  const shoot = async () => {
    if (!timer) {
      await capture()
      return
    }
    for (let left = TIMER_SECONDS; left > 0; left -= 1) {
      setCounting(left)
      void Haptics.selectionAsync()
      await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    }
    setCounting(undefined)
    await capture()
  }

  const pickFromGallery = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    })
    const asset = picked.canceled ? undefined : picked.assets[0]
    if (!asset) return
    const prepared = await preparePhoto(asset)
    if (prepared) setTaken(prepared)
  }

  const save = async () => {
    if (!taken) return
    setSaving(true)
    setFailure(undefined)
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: deviceTimezone() }).format(
        new Date(),
      )
      await recordBodyPhoto(today, taken.base64)
      router.back()
    } catch (cause) {
      if (!upgrade.handled(cause)) setFailure(SAVE_FAILED)
      setSaving(false)
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.color.background.canvas }]}>
      {taken ? (
        <Image source={{ uri: taken.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : permission?.granted ? (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <FoundationIcon
            name="camera"
            customSize={48}
            color={theme.color.icon.secondary}
            decorative
          />
          <Text role="body" size="md" color="secondary" align="center">
            Para tomar tu foto de progreso, Allfit necesita la cámara.
          </Text>
          <Button
            label="Permitir la cámara"
            variant="secondary"
            onPress={() => void requestPermission()}
          />
          <Button
            label="Elegir de la galería"
            variant="ghost"
            onPress={() => void pickFromGallery()}
          />
        </View>
      )}
      {!taken && ghost && last ? (
        <View style={styles.ghost} pointerEvents="none" accessibilityElementsHidden>
          <Image
            source={{ uri: last.photo.url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: `${theme.color.icon.accent}33` }]}
          />
        </View>
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.topRow}>
          <IconButton
            icon={taken ? 'back' : 'close'}
            accessibilityLabel={taken ? 'Repetir la foto' : 'Cerrar sin guardar'}
            onPress={() => (taken ? setTaken(undefined) : router.back())}
          />
          <Text role="control" size="lg" style={styles.title}>
            Foto de progreso
          </Text>
          {!taken ? (
            <Chip
              label={`${String(TIMER_SECONDS)} s`}
              icon="countdown"
              selected={timer}
              onPress={() => setTimer(!timer)}
              accessibilityLabel={`Temporizador de ${String(TIMER_SECONDS)} segundos`}
            />
          ) : (
            <View style={styles.side} />
          )}
        </View>
        {!taken && last ? (
          <View style={styles.hint}>
            <Chip
              label={ghost ? `Alinea con tu foto del ${shortDay(last.taken_on)}` : 'Guía apagada'}
              icon="image"
              selected={ghost}
              onPress={() => setGhost(!ghost)}
              accessibilityLabel={`Mostrar tu foto del ${shortDay(last.taken_on)} para alinearte`}
            />
          </View>
        ) : null}
      </View>

      {counting !== undefined ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Text role="display" size="9xl" color="accent">
            {String(counting)}
          </Text>
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {failure ? <InlineAlert message={failure} /> : null}
        {taken ? (
          <View style={styles.review}>
            <Button
              label="Repetir"
              variant="secondary"
              onPress={() => setTaken(undefined)}
              style={styles.grow}
            />
            <Button
              label="Guardar foto"
              loading={saving}
              onPress={() => void save()}
              style={styles.grow}
            />
          </View>
        ) : (
          <>
            <Text role="body" size="xs" color="secondary" align="center">
              Misma luz, misma distancia y la cámara a la altura del pecho.
            </Text>
            <View style={styles.controls}>
              <CoverTile
                size="md"
                onPress={() => void pickFromGallery()}
                accessibilityLabel="Elegir de la galería"
                hint={
                  <FoundationIcon
                    name="image"
                    size="md"
                    color={theme.color.icon.primary}
                    decorative
                  />
                }
              >
                {last ? (
                  <Image
                    source={{ uri: last.photo.url }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : null}
              </CoverTile>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tomar la foto"
                disabled={!permission?.granted || counting !== undefined}
                onPress={() => void shoot()}
                style={[
                  styles.shutter,
                  { borderColor: theme.color.text.primary, opacity: permission?.granted ? 1 : 0.4 },
                ]}
              >
                <View style={[styles.shutterCore, { backgroundColor: theme.color.icon.accent }]} />
              </Pressable>
              <IconButton
                icon="flip"
                accessibilityLabel="Cambiar de cámara"
                onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
              />
            </View>
            <View style={styles.private}>
              <FoundationIcon
                name="locked"
                size="xs"
                color={theme.color.icon.secondary}
                decorative
              />
              <Text role="body" size="2xs" color="muted">
                Solo tú la ves
              </Text>
            </View>
          </>
        )}
      </View>
      {upgrade.sheet}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  ghost: { ...StyleSheet.absoluteFill, opacity: 0.32 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, textAlign: 'center' },
  side: { width: 64 },
  hint: { alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, gap: 14 },
  review: { flexDirection: 'row', gap: 10 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: { width: 60, height: 60, borderRadius: 30 },
  private: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  grow: { flex: 1 },
})
