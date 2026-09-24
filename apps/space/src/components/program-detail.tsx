/**
 * Las piezas del detalle de un programa — `FIN-10b`.
 *
 * Fuera de la ruta por lo mismo que el escenario del objetivo: es lo único de esa
 * pantalla que se puede mirar sin sesión, y montadas en una ruta de andamio se validan
 * en el simulador. La ruta se queda con la composición y con lo que hay que pedir.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Scrim } from '@allfitone/react-native/gradient'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { Pressable, StyleSheet, View } from 'react-native'

import { dayFigures, type ProgramDay } from '../client/program-catalogue'

/**
 * Lo que mide una tarjeta de día, y lo que mide la previa de un ejercicio.
 *
 * Los ciento veinticuatro del lienzo cortaban «Fuerza general» y «Rodaje continuo» a
 * media palabra: los nombres de las rutinas del catálogo son más largos que los del
 * ejemplo dibujado. Con ciento cuarenta caben, y la cuarta tarjeta sigue asomando.
 */
export const DAY_CARD = { width: 140, height: 150 }
export const EXERCISE_CARD = { width: 110, height: 92 }

/** Una cifra del encabezado: el número grande y qué cuenta, debajo. */
export function Figure({ value, unit }: { readonly value: string; readonly unit: string }) {
  return (
    <View style={styles.figure}>
      <Text role="data" size="2xl">
        {value}
      </Text>
      <Text role="eyebrow" size="2xs" color="muted">
        {unit.toUpperCase()}
      </Text>
    </View>
  )
}

/**
 * Un día del reparto, con la portada que su rutina lleva.
 *
 * Es un selector y no un enlace: abre sus ejercicios debajo, en la misma pantalla. El
 * filo de acento dice cuál está abierto, que es el uso que `DT-009` le reserva.
 */
export function DayCard({
  day,
  ordinal,
  open,
  onPress,
}: {
  readonly day: ProgramDay
  readonly ordinal: number
  readonly open: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: open }}
      accessibilityLabel={`${day.title}. ${dayFigures(day)}`}
      onPress={onPress}
      style={[
        styles.dayCard,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: open ? theme.color.border.accent : theme.color.border.subtle,
          borderWidth: open ? 1.5 : 1,
        },
      ]}
    >
      {day.cover_url ? (
        <>
          <Image
            source={day.cover_url}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            transition={200}
          />
          <Scrim height={DAY_CARD.height} coverage={0.999} onset={0.3} background="surface" />
        </>
      ) : null}

      <View style={styles.dayChip}>
        <Badge label={`D${ordinal}`} tone="accent" variant="quiet" />
      </View>

      <View style={styles.dayNaming}>
        <Text role="control" size="sm" numberOfLines={2}>
          {day.title}
        </Text>
        <Text role="body" size="xs" color="secondary">
          {dayFigures(day)}
        </Text>
      </View>
    </Pressable>
  )
}

/** Un ejercicio del día abierto: su demostración, sus series y su nombre. */
export function ExerciseCard({
  name,
  target,
  picture,
}: {
  readonly name: string
  readonly target: string
  readonly picture: string | null
}) {
  const theme = useTheme()

  return (
    <View style={styles.exercise}>
      <View
        style={[
          styles.preview,
          {
            backgroundColor: theme.color.background.surface,
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        {picture ? (
          <Image
            source={picture}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={styles.bare2}>
            <FoundationIcon
              name="training"
              size="sm"
              color={theme.color.icon.secondary}
              decorative
            />
          </View>
        )}
        {target ? (
          <View style={styles.target}>
            <Badge label={target} tone="accent" variant="quiet" />
          </View>
        ) : null}
      </View>
      <Text role="body" size="xs" numberOfLines={2}>
        {name}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  figure: { gap: 2 },
  dayCard: {
    width: DAY_CARD.width,
    height: DAY_CARD.height,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  dayChip: { position: 'absolute', top: 10, left: 10 },
  dayNaming: { padding: 11, gap: 1 },
  exercise: { width: EXERCISE_CARD.width, gap: 6 },
  preview: {
    width: EXERCISE_CARD.width,
    height: EXERCISE_CARD.height,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bare2: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  target: { position: 'absolute', right: 6, bottom: 6 },
})
