/**
 * `/programs` — el catálogo entero de Allfit, empujado sobre las pestañas.
 *
 * **Era otra pantalla y otra pregunta.** Preguntaba «¿cuántos días por semana puedes
 * entrenar?» y respondía con los tres programas de esa frecuencia, en fichas de texto.
 * Esa pregunta ya la contesta Hoy el primer día —sus tres tarjetas **son** las tres
 * frecuencias—, así que aquí sobraba: quien llega desde Entrenamiento no viene a elegir
 * una frecuencia, viene a ver qué hay.
 *
 * Ahora es la lista de Hoy sin plegar: el catálogo entero con la tarjeta que la persona
 * verá cada mañana si acepta, ordenado por correspondencia y con el sugerido delante.
 * Una lista que crece era lo único que había que mantener bien; dos listas con las
 * mismas tarjetas y distinto encabezado eran dos.
 *
 * Con flecha de volver, que es lo que distingue esta ruta de la lista de Hoy: se llega
 * desde algún sitio y se vuelve a él.
 */

import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { createSpaceProgramFlow } from '../../src/client/programs-transport'
import type { ProgramCatalogue } from '../../src/client/programs'
import {
  catalogueList,
  type ProgramSummary,
  type TrainingProfile,
} from '../../src/client/program-catalogue'
import { OfferRow } from '../../src/components/offer-row'
import { ProgramPoster } from '../../src/components/program-poster'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar los programas. Inténtalo otra vez.'

const EMPTY_PROFILE: TrainingProfile = {
  given_name: '',
  primary_training_goal: null,
  training_experience: null,
  biological_sex: null,
  focus_areas: [],
}

export default function Programs() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceProgramFlow(), [])

  const [catalogue, setCatalogue] = useState<ProgramCatalogue | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    flow
      .readCatalogue()
      .then((current) => {
        if (active) setCatalogue(current)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : READ_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [flow])

  // Extendida siempre: esta pantalla **es** el catálogo entero, así que plegarla sería
  // esconder justo lo que se vino a ver.
  const offered = useMemo(
    () => catalogueList(catalogue?.programs ?? [], catalogue?.profile ?? EMPTY_PROFILE, true),
    [catalogue],
  )

  const open = (program: ProgramSummary) => router.push(`/programs/${program.program_version_id}`)

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.top}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <View style={styles.heading}>
          <Text role="display" size="2xl" uppercase accessibilityRole="header">
            Programas de Allfit
          </Text>
          <Text role="body" size="sm" color="secondary">
            Planes armados por el equipo. Primero los que mejor encajan contigo.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failure ? <InlineAlert message={failure} onDismiss={() => setFailure(undefined)} /> : null}

        {offered.cards.map((card) => (
          <ProgramPoster
            key={card.program.program_version_id}
            program={card.program}
            suggested={card.suggested}
            disabled={false}
            onPress={() => open(card.program)}
          />
        ))}

        {catalogue === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando programas…
          </Text>
        ) : null}

        {/* Nunca se está obligado a elegir uno, y la otra salida lleva la misma forma
            que en Hoy: la misma cosa dicha dos veces igual. */}
        {catalogue ? (
          <OfferRow
            icon="create"
            label="Crear el mío"
            caption="Arma tu propio programa, día por día"
            tone="quiet"
            onPress={() => router.push('/programs/new')}
          />
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  // La cabecera no se va con el desplazamiento: es de dónde se vuelve, y una que se
  // escapa obliga a subir hasta arriba para salir.
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 16 },
  heading: { flex: 1, gap: 4 },
  content: { gap: 12, paddingBottom: 32 },
})
