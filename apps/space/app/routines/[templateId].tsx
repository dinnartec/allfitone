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
 * **`S-1` is the separate route the canvas draws, after all.** It was built as a sheet
 * to avoid "a second copy of that draft with a way to disagree with this one", and the
 * worry was right — each screen builds its own flow, so each holds its own etag map,
 * and two writers would be two etags and a `409`. But a sheet is anchored to the
 * bottom edge, which is where the keyboard appears: searching left about three results
 * visible, and every pick wrote the draft, so five exercises were five saves.
 *
 * The route avoids the duplication by carrying a **selection** and never a draft.
 * `exercise-pick` is the mailbox; this screen stays the only thing that writes, and it
 * appends the whole batch in one save.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { declareAlreadyIn, takeExercisePick } from '../../src/client/exercise-pick'
import {
  DISCIPLINE,
  countSets,
  reasonsNotToPublish,
  stepsToContent,
  withPicked,
  withoutStep,
  type WorkingStep,
} from '../../src/client/routine-draft'
import { ScreenHeader } from '../../src/components/screen-header'

const SUGGESTIONS = ['Empuje', 'Tirón', 'Pierna', 'Full body']

/** Long enough that a name is not a save per keystroke, short enough to feel saved. */
const SAVE_DELAY_MS = 700

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const SAVE_FAILED = 'No pudimos guardar el borrador. Revisa tu conexión.'

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
  const [showIssues, setShowIssues] = useState(false)

  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Held outside state as well: a save scheduled before the creation resolved must
  // see the identity the creation produced, and state would still be the old one.
  const identity = useRef<string | undefined>(templateId)
  // The activity type the creation put in the draft. Every save has to send it back:
  // sending null erases it, and without it every step is refused as `target-family`.
  const activityType = useRef<string | null>(null)

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
          activityType.current = template.draft.content.activity_type_id
          setTemplateId(template.id)
        }
        await flow.saveTemplateDraft(
          identity.current,
          stepsToContent(trimmed, nextSteps, activityType.current),
        )
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

  // Read through a ref so the effect below does not depend on it: naming a routine is
  // typing, and a dependency on the name would resubscribe on every keystroke.
  const named = useRef(title)
  useEffect(() => {
    named.current = title
  }, [title])

  // On focus rather than on mount: this screen stays on the stack while the picker is
  // above it, so mounting happens once and would never see what was chosen. Taking
  // empties the batch, which is what stops a second look from appending it again.
  useFocusEffect(
    useCallback(() => {
      const picked = takeExercisePick()
      if (picked.length === 0) return
      setSteps((current) => {
        const next = withPicked(current, picked)
        // One save for the whole batch. The sheet wrote the draft once per exercise.
        schedule(named.current, next)
        return next
      })
    }, [schedule]),
  )

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
                <Text role="body" size="sm" color="muted">
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
            declareAlreadyIn(steps.map((one) => one.movementId))
            router.push('/routines/exercises')
          }}
        />

        <Text role="body" size="sm" color="muted" style={styles.centered}>
          Se guarda como borrador según escribes. Necesita conexión.
        </Text>
      </ScrollView>
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
})
