/**
 * `V-H`, `V-E1` and `V-G` — one screen in three states.
 *
 * The canvases draw them apart and they are the same screen: an empty routine, a
 * routine with exercises, and a routine that cannot be published yet. Three files
 * would put the same name field, the same list and the same confirm in three places,
 * and the disabled state would drift between them within a week.
 *
 * `templateId` is the literal `new` before anything exists. **Nothing is created until
 * the routine has a name**, which is what "aún sin guardar" says out loud: a routine
 * with no name is not a draft anybody would recognise in a list.
 *
 * **The draft saves as it is edited and the etag is not this screen's business.**
 * `createSpaceContentFlow` carries it from one save to the next; a screen holding it
 * would eventually save a stale one and answer `409` for no reason a person could act
 * on.
 *
 * `S-1` is a sheet and not the separate route the canvas draws. The search appends to
 * the draft being edited, and a second route would mean a second copy of that draft
 * with a way to disagree with this one.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import type { Movement } from '../../src/client/content'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import {
  DISCIPLINE,
  countSets,
  reasonsNotToPublish,
  stepsToContent,
  withoutStep,
  type WorkingStep,
} from '../../src/client/routine-draft'
import { ScreenHeader } from '../../src/components/screen-header'

const SUGGESTIONS = ['Empuje', 'Tirón', 'Pierna', 'Full body']

/** Long enough that a name is not a save per keystroke, short enough to feel saved. */
const SAVE_DELAY_MS = 700

const DEFAULT_SETS = 4
const DEFAULT_REPS = 8

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const SAVE_FAILED = 'No pudimos guardar el borrador. Revisa tu conexión.'
const SEARCH_FAILED = 'No pudimos buscar en el catálogo. Inténtalo otra vez.'

export default function RoutineEditor() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceContentFlow(), [])
  const params = useLocalSearchParams<{ templateId: string }>()

  const [templateId, setTemplateId] = useState<string | undefined>(
    params.templateId === 'new' ? undefined : params.templateId,
  )
  const [title, setTitle] = useState('')
  const [steps, setSteps] = useState<readonly WorkingStep[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly Movement[]>([])
  const [showIssues, setShowIssues] = useState(false)

  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Held outside state as well: a save scheduled before the creation resolved must
  // see the identity the creation produced, and state would still be the old one.
  const identity = useRef<string | undefined>(templateId)

  /**
   * Saves, and says whether it did. It reports a failure through `failure` as well,
   * because the autosave has nobody waiting on it — but publishing does, and a caller
   * that cannot tell a save from a silent failure will navigate away from the message.
   */
  const persist = useCallback(
    async (nextTitle: string, nextSteps: readonly WorkingStep[]): Promise<boolean> => {
      const trimmed = nextTitle.trim()
      if (trimmed === '') return false

      setSaving(true)
      try {
        if (!identity.current) {
          const template = await flow.createTemplate(DISCIPLINE, trimmed)
          identity.current = template.id
          setTemplateId(template.id)
        }
        await flow.saveTemplateDraft(identity.current, stepsToContent(trimmed, nextSteps))
        setSaved(true)
        setFailure(undefined)
        return true
      } catch (cause: unknown) {
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : SAVE_FAILED,
        )
        return false
      } finally {
        setSaving(false)
      }
    },
    [flow],
  )

  const schedule = useCallback(
    (nextTitle: string, nextSteps: readonly WorkingStep[]) => {
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => void persist(nextTitle, nextSteps), SAVE_DELAY_MS)
    },
    [persist],
  )

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current)
    },
    [],
  )

  useEffect(() => {
    if (!searching) return
    let active = true

    flow
      .searchMovements(DISCIPLINE, query)
      .then((found) => {
        if (active) setResults(found)
      })
      .catch(() => {
        if (active) setFailure(SEARCH_FAILED)
      })

    return () => {
      active = false
    }
  }, [flow, query, searching])

  const rename = (next: string) => {
    setTitle(next)
    setSaved(false)
    schedule(next, steps)
  }

  const change = (next: readonly WorkingStep[]) => {
    setSteps(next)
    setSaved(false)
    schedule(title, next)
  }

  const add = (movement: Movement) =>
    change([
      ...steps,
      {
        position: steps.length + 1,
        movementId: movement.id,
        name: movement.name,
        sets: DEFAULT_SETS,
        reps: DEFAULT_REPS,
      },
    ])

  const issues = reasonsNotToPublish(title, steps)
  const publishable = issues.length === 0 && templateId !== undefined

  const publish = async () => {
    if (!templateId) return
    if (!publishable) {
      setShowIssues(true)
      return
    }
    if (pending.current) clearTimeout(pending.current)
    try {
      // Stay put when the draft did not land. Publishing on top of a failed save would
      // publish whatever the server still holds, and leaving hides the message.
      const stored = await persist(title, steps)
      if (!stored) return
      await flow.publishTemplate(templateId)
      router.back()
    } catch (cause: unknown) {
      setFailure(
        cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : SAVE_FAILED,
      )
    }
  }

  const subtitle = () => {
    if (saving) return 'guardando…'
    if (failure) return 'sin guardar'
    if (saved) return 'borrador guardado'
    return 'aún sin guardar'
  }

  const alreadyIn = new Set(steps.map((step) => step.movementId))

  return (
    <Screen edges={['top', 'bottom']}>
      {/* The keyboard moves the scroll inset rather than resizing the container, the
          same as every other screen here that takes typing. */}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <ScreenHeader
          title={title.trim() === '' ? 'Nueva rutina' : title}
          subtitle={subtitle()}
          onClose={() => router.back()}
          onConfirm={templateId ? publish : undefined}
          confirmLabel="Listo"
        />

        {failure ? <InlineAlert message={failure} /> : null}

        {showIssues && issues.length > 0 ? (
          <View
            style={[
              styles.issues,
              {
                borderColor: theme.color.status.danger,
                backgroundColor: theme.color.background.surface,
              },
            ]}
          >
            <View style={styles.issuesHead}>
              <FoundationIcon
                name="warning"
                size="sm"
                color={theme.color.status.danger}
                decorative
              />
              <Text role="eyebrow" size="2xs" style={{ color: theme.color.status.danger }}>
                {issues.length === 1
                  ? 'FALTA UNA COSA PARA GUARDAR'
                  : `FALTAN ${issues.length} COSAS PARA GUARDAR`}
              </Text>
            </View>
            {issues.map((issue) => (
              <View key={issue.title} style={styles.issueText}>
                <Text role="control" size="sm">
                  {issue.title}
                </Text>
                <Text role="body" size="xs" color="muted">
                  {issue.hint}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <TextField
            label="Ponle un nombre"
            placeholder="Empuje, Pierna, Día 1…"
            value={title}
            onChangeText={rename}
            autoCapitalize="sentences"
          />
          <View style={styles.chips}>
            {SUGGESTIONS.map((suggestion) => (
              <Chip
                key={suggestion}
                label={suggestion}
                selected={title.trim() === suggestion}
                onPress={() => rename(suggestion)}
              />
            ))}
          </View>
        </View>

        {steps.length === 0 ? (
          <View
            style={[
              styles.empty,
              {
                borderColor: theme.color.border.subtle,
                backgroundColor: theme.color.background.surface,
              },
            ]}
          >
            <FoundationIcon
              name="training"
              size="lg"
              color={theme.color.icon.secondary}
              decorative
            />
            <Text role="display" size="md">
              Todavía no hay ejercicios
            </Text>
            <Text role="body" size="sm" color="muted" style={styles.centered}>
              Busca en el catálogo y añade el primero. Luego le pones series, peso y descanso.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.stats, { borderColor: theme.color.border.subtle }]}>
              <Figure value={String(steps.length)} label="ejercicios" />
              <View style={[styles.divider, { backgroundColor: theme.color.border.subtle }]} />
              <Figure value={String(countSets(steps))} label="series" accent />
            </View>

            <View style={styles.list}>
              {steps.map((step) => (
                <View
                  key={step.position}
                  style={[styles.row, { borderColor: theme.color.border.subtle }]}
                >
                  <Text role="display" size="sm" color="muted">
                    {String(step.position).padStart(2, '0')}
                  </Text>
                  <View style={styles.rowText}>
                    <Text role="display" size="sm" uppercase>
                      {step.name}
                    </Text>
                    <Text role="body" size="xs" color="accent">
                      {`${step.sets} series · ${step.reps} reps`}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar ${step.name}`}
                    onPress={() => change(withoutStep(steps, step.position))}
                  >
                    <FoundationIcon
                      name="remove"
                      size="sm"
                      color={theme.color.icon.secondary}
                      decorative
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}

        <Button
          label={steps.length === 0 ? 'BUSCAR Y AÑADIR EJERCICIO' : 'Añadir ejercicio'}
          variant={steps.length === 0 ? 'primary' : 'secondary'}
          icon={steps.length === 0 ? 'search' : 'add'}
          onPress={() => {
            setQuery('')
            setSearching(true)
          }}
        />

        <Text role="body" size="xs" color="muted" style={styles.centered}>
          Se guarda como borrador según escribes. Necesita conexión.
        </Text>
      </ScrollView>

      <Sheet visible={searching} onDismiss={() => setSearching(false)} title="Añadir ejercicio">
        <View style={styles.searchBody}>
          <Text role="body" size="xs" color="muted">
            {title.trim() === '' ? 'a tu rutina nueva' : `a la rutina ${title.trim()}`}
          </Text>
          <TextField
            label="Buscar ejercicio"
            placeholder="Busca por nombre"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          <Text role="eyebrow" size="2xs" color="muted">
            {results.length === 1
              ? '1 RESULTADO EN EL CATÁLOGO'
              : `${results.length} RESULTADOS EN EL CATÁLOGO`}
          </Text>
          <ScrollView style={styles.searchList} showsVerticalScrollIndicator={false}>
            {results.map((movement) => (
              <View
                key={movement.id}
                style={[
                  styles.result,
                  {
                    borderColor: theme.color.border.subtle,
                    backgroundColor: theme.color.background.surface,
                  },
                ]}
              >
                <View style={styles.rowText}>
                  <Text role="control" size="sm">
                    {movement.name}
                  </Text>
                </View>
                {alreadyIn.has(movement.id) ? (
                  <Text role="label" size="2xs" color="muted">
                    Ya está
                  </Text>
                ) : (
                  <IconButton
                    icon="add"
                    accessibilityLabel={`Añadir ${movement.name}`}
                    onPress={() => add(movement)}
                  />
                )}
              </View>
            ))}
            {results.length === 0 ? (
              <Text role="body" size="sm" color="muted">
                No hay ejercicios con ese nombre en el catálogo.
              </Text>
            ) : null}
          </ScrollView>
          <Text role="body" size="xs" color="muted" style={styles.centered}>
            Solo el catálogo global de Allfit.
          </Text>
        </View>
      </Sheet>
    </Screen>
  )
}

function Figure({
  value,
  label,
  accent,
}: {
  readonly value: string
  readonly label: string
  readonly accent?: boolean
}) {
  return (
    <View style={styles.figure}>
      {accent ? (
        <Text role="display" size="lg" color="accent">
          {value}
        </Text>
      ) : (
        <Text role="display" size="lg">
          {value}
        </Text>
      )}
      <Text role="label" size="2xs" color="muted">
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 48 },
  section: { gap: 10 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  centered: { textAlign: 'center' },
  empty: {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 10,
  },
  stats: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 14 },
  figure: { flex: 1, alignItems: 'center', gap: 2 },
  divider: { width: 1, height: 32 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  rowText: { flex: 1, gap: 3 },
  issues: { borderWidth: 2, borderRadius: 18, padding: 16, gap: 12 },
  issuesHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  issueText: { gap: 2 },
  searchBody: { gap: 12 },
  searchList: { maxHeight: 300 },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
})
