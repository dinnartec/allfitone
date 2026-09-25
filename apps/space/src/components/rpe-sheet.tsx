/**
 * La escala de esfuerzo, abierta y explicada — `HU-SP-043` criterio 5.
 *
 * **Se explica antes de preguntar.** Un campo del 1 al 10 sin nada más es una pregunta en
 * un idioma que la mitad de la gente no habla; arriba dice qué se mide, y debajo de los
 * números dice qué significa el que se acaba de marcar. El copy de abajo es el que cambia,
 * y por eso está debajo: el dedo tapa lo que hay encima de él al tocar.
 *
 * **Se escribe al marcar y la hoja no se cierra.** Cerrarse al tocar dejaría a la persona
 * sin ver el renglón que explica lo que acaba de elegir, que es justo lo que vino a leer.
 *
 * Dos filas de cinco y no diez en una: diez objetivos táctiles en el ancho de un teléfono
 * salen a treinta puntos cada uno, y el suelo son cuarenta y cuatro.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'

import { rpeCopy, RPE_EXPLAINER, RPE_LEVELS, type RpeLevel } from '../client/rpe-scale'

export function RpeSheetBody({
  value,
  onChoose,
}: {
  readonly value: number | undefined
  readonly onChoose: (value: number | undefined) => void
}) {
  const theme = useTheme()
  const rows: readonly (readonly RpeLevel[])[] = [RPE_LEVELS.slice(0, 5), RPE_LEVELS.slice(5)]

  return (
    <View style={styles.body}>
      <Text role="body" size="sm" color="secondary">
        {RPE_EXPLAINER}
      </Text>

      <View style={styles.grid}>
        {rows.map((row) => (
          <View key={row[0]?.value ?? 0} style={styles.row}>
            {row.map((level) => {
              const on = level.value === value
              return (
                <Pressable
                  key={level.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Esfuerzo ${level.value}. ${level.name}`}
                  accessibilityHint={level.detail}
                  // Tocar el que ya está marcado lo quita: es la única manera de volver
                  // a no pedir esfuerzo sin un botón más.
                  onPress={() => onChoose(on ? undefined : level.value)}
                  style={({ pressed }) => [
                    styles.step,
                    {
                      backgroundColor: on
                        ? theme.color.accent.tonal
                        : theme.color.background.surface,
                      borderColor: on ? theme.color.border.accent : theme.color.border.subtle,
                      borderWidth: on ? 1.5 : 1,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text role="data" size="lg" color={on ? 'accent' : 'primary'}>
                    {String(level.value)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        ))}
      </View>

      {/* El renglón que cambia. Ocupa dos líneas siempre para que marcar un número no
          mueva lo que hay debajo mientras se comparan dos. */}
      <View style={[styles.copy, { borderTopColor: theme.color.border.subtle }]}>
        <Text role="body" size="md" color={value === undefined ? 'muted' : 'primary'}>
          {rpeCopy(value)}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 8 },
  grid: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  step: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { borderTopWidth: 1, paddingTop: 12, minHeight: 58 },
})
