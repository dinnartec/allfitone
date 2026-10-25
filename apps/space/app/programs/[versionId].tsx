/**
 * `FIN-10b` · Programa de Allfit · detalle y asignación — `HU-SP-100`.
 *
 * Choosing used to happen on the card. It shouldn't: somebody about to hand eight
 * weeks of their life to a program deserves to see every session in it first, and
 * "8 semanas · 3 días" is a summary, not the content.
 *
 * **Y se decide mirando, no leyendo.** La pantalla era una lista de nombres: el
 * programa, sus días y sus ejercicios, todo en texto. Ahora la fotografía del programa
 * encabeza, cada día del reparto lleva la de su rutina —la misma que tendrá en Hoy si
 * se toma, para que abrirlo y vivirlo no sean dos productos— y cada ejercicio su
 * demostración.
 *
 * **Los días son un selector y no una lista apilada.** Los cuatro están a la vista y se
 * abre el que se quiera; antes había que desplazar ocho semanas de texto para saber qué
 * había en el cuarto. `HU-SP-100` criterio 5 pide el contenido completo, y completo no
 * quiere decir todo a la vez: quiere decir que nada queda fuera de alcance.
 *
 * **La demostración no viene con el programa.** Viene del catálogo de movimientos, que
 * es de quien es, y se cruza por identificador — igual que hace el editor de rutina. La
 * biblioteca es una caché de por vida del proceso, así que pedirla aquí no cuesta una
 * espera, y colgarla del paso habría puesto la misma imagen en dos respuestas.
 *
 * **The split, not the calendar.** A twelve-week program composes sixty sessions out
 * of five templates; what is being chosen is the five, so the days shown are the
 * distinct days of the first week.
 *
 * El estimado lleva `~` porque lo es. Nada en el catálogo registra el descanso entre
 * series ni el ritmo al que alguien corre, así que `estimatedMinutes` asume dos
 * coeficientes y los nombra donde están. Un número sin la tilde sería un número que
 * alguien se cree.
 *
 * The footer says where the program goes, because "tomar" is otherwise ambiguous: it
 * lands on the agenda and starts from Hoy.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { Scrim } from '@allfitone/react-native/gradient'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ApiError } from '../../src/client'
import { createSpaceProgramFlow } from '../../src/client/programs-transport'
import { deviceTimezone } from '../../src/client/timezone'
import type { ProgramDetail } from '../../src/client/programs'
import { sessionMinutes, targetLabel, totalExercises } from '../../src/client/program-catalogue'
import { readExerciseLibrary } from '../../src/client/exercise-library'
import { FROM_PROGRAM } from '../../src/client/exercise-pick'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { ZONE_LABEL } from '../../src/components/program-card'
import { DayCard, ExerciseCard, Figure } from '../../src/components/program-detail'
import { programNutritionCopy } from '../../src/client/program-nutrition'
import { ProgramNutritionCard } from '../../src/components/program-nutrition-card'
import { usePlan, useUpgradeSheet } from '../../src/components/upgrade-sheet'

/** Lo que ocupa la fotografía del programa. La del lienzo, sobre un alto de 844. */
const HERO = 252

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar este programa. Inténtalo otra vez.'
const NOT_FOUND = 'Este programa ya no está disponible.'
const CHOOSE_FAILED = 'No pudimos guardar tu programa. Inténtalo otra vez.'

export default function ProgramVersion() {
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { versionId } = useLocalSearchParams<{ versionId: string }>()
  const flow = useMemo(() => createSpaceProgramFlow(), [])

  const content = useMemo(() => createSpaceContentFlow(), [])
  const [detail, setDetail] = useState<ProgramDetail | undefined>(undefined)
  /** Qué día del reparto está abierto. El primero, porque uno tiene que estarlo. */
  const [openDay, setOpenDay] = useState(0)
  /** La demostración de cada movimiento, por identificador. Del catálogo, no del programa. */
  const [previews, setPreviews] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [choosing, setChoosing] = useState(false)
  const [adoptNutrition, setAdoptNutrition] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!versionId) return
    let active = true

    // La biblioteca detrás y no delante: la pantalla ya tiene qué dibujar sin las
    // demostraciones, y es una caché de por vida del proceso.
    void readExerciseLibrary(content)
      .then((library) => {
        if (!active) return
        setPreviews(new Map(library.movements.map((one) => [one.id, one.demo_url])))
      })
      .catch(() => undefined)

    flow
      .readDetail(versionId)
      .then((current) => {
        if (active) setDetail(current)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(
          cause instanceof ApiError && cause.failure === 'not-found' ? NOT_FOUND : READ_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [content, flow, versionId])

  const features = usePlan()
  const upgrade = useUpgradeSheet(features)

  const take = async () => {
    if (!detail) return
    setChoosing(true)
    setFailure(undefined)
    try {
      await flow.choose({
        program_version_id: detail.program_version_id,
        timezone: deviceTimezone(),
        adopt_nutrition: detail.nutrition !== null && adoptNutrition,
      })
      router.replace('/today')
    } catch (cause: unknown) {
      if (upgrade.handled(cause)) return
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
      } else {
        setFailure(CHOOSE_FAILED)
      }
    } finally {
      setChoosing(false)
    }
  }

  const nutrition = detail?.nutrition
    ? programNutritionCopy(detail.nutrition, detail.days_per_week)
    : null
  const days = detail?.days ?? []
  const shown = days[Math.min(openDay, Math.max(0, days.length - 1))]

  return (
    <Screen edges={[]} style={styles.bare}>
      <ScrollView
        contentContainerStyle={[styles.content, nutrition ? styles.contentWithAdopt : null]}
        showsVerticalScrollIndicator={false}
      >
        {/* La fotografía llega hasta el borde superior, así que la pantalla no reserva
            área segura y el héroe paga la suya: el botón de volver cae bajo la hora. */}
        <View style={[styles.hero, { height: HERO }]}>
          {detail?.cover_url ? (
            <>
              <Image
                source={detail.cover_url}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                contentPosition="top"
                transition={200}
              />
              {/* El velo lo pone la pantalla y no el archivo: la portada es la misma
                  que el catálogo sirve sin tratamiento, y hornearlo la apagaría en
                  todos los sitios donde sale. */}
              <Scrim height={HERO} coverage={0.999} onset={0.24} />
            </>
          ) : null}

          {detail ? (
            <View style={styles.heading}>
              <Text role="eyebrow" size="2xs" color="accent">
                PROGRAMA DE ALLFIT
              </Text>
              <Text role="display" size="3xl" uppercase accessibilityRole="header">
                {detail.title}
              </Text>
            </View>
          ) : null}
        </View>

        {failure ? <InlineAlert message={failure} style={styles.gutter} /> : null}

        {detail ? (
          <>
            <View style={[styles.figures, styles.gutter]}>
              <Figure
                value={detail.weeks === null ? '∞' : String(detail.weeks)}
                unit={detail.weeks === null ? 'Sin fin' : 'Semanas'}
              />
              <Figure value={String(detail.days_per_week)} unit="Días por semana" />
              {sessionMinutes(days) > 0 ? (
                <Figure value={String(sessionMinutes(days))} unit="Min por sesión" />
              ) : null}
            </View>

            {detail.notes ? (
              <Text role="body" size="sm" color="secondary" style={styles.gutter}>
                {detail.notes}
              </Text>
            ) : null}

            <View style={[styles.zones, styles.gutter]}>
              {detail.emphases.map((zone) => (
                <Badge key={zone} label={ZONE_LABEL[zone] ?? zone} variant="quiet" />
              ))}
            </View>

            {nutrition ? (
              <View style={styles.gutter}>
                <ProgramNutritionCard copy={nutrition} />
              </View>
            ) : null}

            <View style={[styles.sectionHead, styles.gutter]}>
              <Text role="eyebrow" size="2xs" color="muted">
                LOS DÍAS
              </Text>
              <Text role="control" size="xs" color="muted">
                {`${totalExercises(days)} ejercicios en total`}
              </Text>
            </View>

            {/* Los días se desplazan en horizontal y sangran el margen: el cuarto tiene
                que asomar, o un reparto de cinco parece de tres. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.deck}
            >
              {days.map((day, index) => (
                <DayCard
                  key={day.day}
                  day={day}
                  ordinal={index + 1}
                  open={index === openDay}
                  onPress={() => setOpenDay(index)}
                />
              ))}
            </ScrollView>

            {shown ? (
              <>
                <View style={[styles.sectionHead, styles.gutter]}>
                  <Text role="eyebrow" size="2xs" color="muted">
                    {`${shown.title.toUpperCase()} · ${shown.steps.length} ${
                      shown.steps.length === 1 ? 'EJERCICIO' : 'EJERCICIOS'
                    }`}
                  </Text>
                  <Text role="eyebrow" size="2xs" color="muted">
                    SERIES × REPS
                  </Text>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.deck}
                >
                  {shown.steps.map((step) => {
                    const movementId = step.movement_id
                    return (
                      <ExerciseCard
                        key={step.position}
                        name={step.movement ?? 'Ejercicio'}
                        target={targetLabel(step.target)}
                        picture={movementId ? (previews.get(movementId) ?? null) : null}
                        // Push, so volver lands back here with the same day open.
                        onPress={
                          movementId
                            ? () =>
                                router.push({
                                  pathname: '/routines/exercises/[movementId]',
                                  params: { movementId, from: FROM_PROGRAM },
                                })
                            : undefined
                        }
                      />
                    )
                  })}
                </ScrollView>
              </>
            ) : null}
          </>
        ) : null}

        {detail === undefined && !failure ? (
          <Text role="body" size="sm" color="muted" style={styles.gutter}>
            Cargando el programa…
          </Text>
        ) : null}
      </ScrollView>

      {/* **Fuera del desplazamiento.** Dentro del héroe se iba con la fotografía, y en
          un programa de doce semanas salir exigía subir hasta arriba del todo. Va
          después del `ScrollView` para quedar encima de él sin pelearse por el orden. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver"
        onPress={() => router.back()}
        hitSlop={8}
        style={[
          styles.back,
          {
            backgroundColor: theme.color.background.surface,
            borderColor: theme.color.border.subtle,
            top: insets.top + 8,
          },
        ]}
      >
        <FoundationIcon name="back" size="sm" color={theme.color.icon.primary} decorative />
      </Pressable>

      {detail ? (
        <View style={[styles.footer, { backgroundColor: theme.color.background.canvas }]}>
          <View style={[styles.hairline, { backgroundColor: theme.color.border.subtle }]} />
          {/* Encendido por defecto: quien elige un programa suele querer comer para él, y
              apagarlo es un toque. Adoptar reemplaza la meta; la anterior queda en el historial. */}
          {nutrition ? (
            <View
              style={[
                styles.adopt,
                {
                  backgroundColor: theme.color.background.surface,
                  borderColor: theme.color.border.subtle,
                },
              ]}
            >
              <View style={styles.adoptText}>
                <Text role="control" size="sm">
                  Usar también su meta de nutrición
                </Text>
                <Text role="body" size="xs" color="muted">
                  Reemplaza tu meta actual; la anterior queda en el historial
                </Text>
              </View>
              <Switch
                accessibilityLabel="Usar también su meta de nutrición"
                value={adoptNutrition}
                onValueChange={setAdoptNutrition}
                trackColor={{
                  true: theme.color.icon.accent,
                  false: theme.color.background.surfaceMuted,
                }}
              />
            </View>
          ) : null}
          <Button
            label="Tomar este programa"
            icon="check"
            loading={choosing}
            disabled={sessionExpired}
            onPress={() => void take()}
          />
          <Text role="body" size="sm" color="muted" align="center">
            Se añade a tu agenda y lo empiezas desde Hoy.
          </Text>
        </View>
      ) : null}
      {upgrade.sheet}
    </Screen>
  )
}

const GUTTER = 24

const styles = StyleSheet.create({
  // La fotografía llega al borde, así que el margen lo pone cada bloque y no la pantalla.
  bare: { paddingHorizontal: 0 },
  // La barra de acción flota encima, y debajo de la tira de ejercicios va su
  // nombre: con ciento cincuenta, el nombre quedaba detrás del botón.
  content: { gap: 14, paddingBottom: 190 },
  gutter: { marginHorizontal: GUTTER },
  hero: { justifyContent: 'flex-end', overflow: 'hidden' },
  // Redondo, que es como vuelve atrás el resto de la aplicación. El lienzo lo dibuja
  // con esquina blanda, pero dos formas para el mismo gesto son dos gestos.
  back: {
    position: 'absolute',
    left: GUTTER,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { gap: 4, paddingHorizontal: GUTTER, paddingBottom: 18 },
  figures: { flexDirection: 'row', gap: 22 },
  zones: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  // Sangra el margen por dentro, para que la primera tarjeta quede alineada con el
  // texto y la última no se pegue al borde.
  deck: { gap: 10, paddingHorizontal: GUTTER },
  hairline: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
  // Anclado, porque la decisión tiene que alcanzarse sin llegar al final de doce semanas.
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 10,
  },
  adopt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  adoptText: { flex: 1, gap: 2 },
  // The footer grows by the switch; the list ends above it, not under it.
  contentWithAdopt: { paddingBottom: 270 },
})
