/**
 * Un programa del catálogo, con la tarjeta de Hoy.
 *
 * **Es la misma tarjeta que se verá cada mañana**, y ésa es toda la idea: el primer día
 * enseñaba tres fichas de texto con un filete y una cifra al costado, y al día siguiente
 * —ya con programa— fotografías a toda tarjeta. La pantalla que tiene que convencer a
 * alguien de empezar era la más pobre de las dos, y elegir sobre un marcador de posición
 * es no elegir. Ahora se elige mirando lo que se va a vivir.
 *
 * **No es `HomeCard` con un argumento más.** Aquélla dibuja una rutina —músculos, series,
 * la última vez, y un reverso que gira—, y nada de eso existe en un programa que todavía
 * no se ha tomado. Lo que comparten es la anatomía, que es lo que se ve: fotografía a
 * sangre anclada arriba, velo, chip arriba a la izquierda, y el nombre y la acción
 * abajo. El alto lo dicta `CARD_TALL`, importado y no copiado.
 *
 * **La tarjeta no es un botón; el botón es el botón.** Igual que en Hoy, donde la
 * fotografía tampoco se toca: una tarjeta pulsable con un botón dentro se lee dos veces
 * en voz alta y no dice cuál de las dos cosas hace algo.
 *
 * **Y lleva al programa entero, nunca lo toma.** `HU-SP-100` criterio 5 pide ver el
 * reparto completo antes de comprometerse: ocho semanas no se aceptan con un toque sobre
 * una fotografía.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { Scrim, SignalBlock } from '@allfitone/react-native/gradient'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { StyleSheet, View } from 'react-native'

import { posterCaption, programCaption, type ProgramSummary } from '../client/program-catalogue'
import { CARD_TALL } from './home-card'
import { ZONE_LABEL } from './program-card'

const PAD = 16

/**
 * Cuántas zonas se escriben antes de contarlas.
 *
 * Siete fichas de zona son un párrafo sobre una fotografía. Tres y el resto en una cifra
 * dicen lo mismo en una línea, y quien quiera el detalle abre el programa.
 */
const ZONES_SHOWN = 3

export function ProgramPoster({
  program,
  suggested,
  disabled,
  onPress,
}: {
  readonly program: ProgramSummary
  /** El único con el filo de acento y con chapa: una señal por pantalla. */
  readonly suggested: boolean
  readonly disabled: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()
  const zones = program.emphases.slice(0, ZONES_SHOWN)
  const rest = program.emphases.length - zones.length

  return (
    <SignalBlock
      variant="surfaceDeep"
      style={[
        styles.card,
        {
          height: CARD_TALL,
          borderColor: suggested ? theme.color.border.accent : theme.color.border.subtle,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      {program.cover_url === null ? (
        // Sin fotografía la tarjeta no finge una: se queda con su fondo y con un glifo,
        // que es lo que distingue «no tiene arte» de «no cargó todavía».
        <View style={styles.bare}>
          <FoundationIcon
            name="checklist"
            size="lg"
            color={theme.color.icon.secondary}
            decorative
          />
        </View>
      ) : (
        <>
          {/* Anclada arriba, como en Hoy y como en la banda de Entrenar: mientras la
              tarjeta sea más estrecha que la fotografía el recorte se lleva ancho, y en
              cuanto sea más ancha se llevará alto — de los pies y no de la cabeza. */}
          <Image
            source={program.cover_url}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            transition={200}
          />
          <Scrim height={CARD_TALL} coverage={0.999} onset={0.26} />
        </>
      )}

      {suggested ? (
        <View style={styles.chip}>
          <Badge label="Sugerido para ti" tone="accent" variant="quiet" />
        </View>
      ) : null}

      {/* Outside the free selection: shown like the rest, and Pro opens taking it. */}
      {program.locked ? (
        <View style={styles.lock}>
          <Badge label="Pro" tone="accent" variant="quiet" />
        </View>
      ) : null}

      <View style={styles.naming}>
        {/* **La píldora opaca y no la teñida.** El acento translúcido que llevaban se
            perdía sobre una fotografía clara; la variante apagada del sistema pinta el
            lienzo entero detrás del rótulo, que es lo que la hace legible sobre
            cualquier cosa. Y en neutro, no en acento: son datos, y el acento de esta
            tarjeta ya lo gasta la chapa de sugerido. */}
        <View style={styles.zones}>
          {zones.map((zone) => (
            <Badge key={zone} label={ZONE_LABEL[zone] ?? zone} variant="quiet" />
          ))}
          {rest > 0 ? (
            <Text role="control" size="2xs" color="muted">
              {`+${String(rest)}`}
            </Text>
          ) : null}
        </View>
        <Text role="display" size="3xl" uppercase numberOfLines={1}>
          {program.title}
        </Text>
        <Text role="body" size="sm" color="secondary">
          {posterCaption(program)}
        </Text>
      </View>

      <View style={styles.action}>
        {/* **Acento sólo en el sugerido.** `DT-009` reserva el cian a un énfasis por
            pantalla: en el carrusel de Hoy se ve una tarjeta a la vez, pero aquí van
            apiladas y veinticuatro botones de acento no señalan ninguno. */}
        <Button
          label="Ver programa"
          icon="checklist"
          variant={suggested ? 'primary' : 'secondary'}
          disabled={disabled}
          accessibilityLabel={`Ver ${program.title}. ${programCaption(program)}${
            suggested ? '. Sugerido para ti' : ''
          }`}
          onPress={onPress}
        />
      </View>
    </SignalBlock>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: 1, overflow: 'hidden' },
  bare: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: { position: 'absolute', top: 14, left: 14 },
  lock: { position: 'absolute', top: 14, right: 14 },
  // Anclado abajo y no arriba: el velo cae ahí, así que es donde el texto se lee.
  naming: { position: 'absolute', left: PAD, right: PAD, bottom: 74, gap: 2 },
  zones: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 },
  action: { position: 'absolute', left: PAD, right: PAD, bottom: 12 },
})
