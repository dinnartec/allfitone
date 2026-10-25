/**
 * What a limit looks like from the person's side (DT-018).
 *
 * `usePlan` reads the functions of the person's plan once per screen focus, so a screen
 * can say beforehand what Pro opens (a lock on a programme, «Lo anterior sigue guardado»
 * at the end of a history). The database is still what enforces every limit: whatever a
 * command is refused with `plan-limit`, `UpgradeSheet` explains for exactly the function
 * that was refused and leads to «Gratis y Pro». Nothing here ever deletes or hides data.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { ApiError } from '../client/api-error'
import { upgradeCopy } from '../client/plan'
import type { ProFeature } from '../client/pro'
import { createSpaceProFlow } from '../client/pro-transport'

/** The functions of the person's plan; empty until read, which limits nothing. */
export function usePlan(): readonly ProFeature[] {
  const flow = useMemo(() => createSpaceProFlow(), [])
  const [features, setFeatures] = useState<readonly ProFeature[]>([])
  useFocusEffect(
    useCallback(() => {
      let active = true
      flow
        .read()
        .then((status) => active && setFeatures(status.features))
        .catch(() => undefined)
      return () => {
        active = false
      }
    }, [flow]),
  )
  return features
}

/** The function a refusal names, when the plan is why; undefined for any other failure. */
export function refusedFeature(cause: unknown): string | undefined {
  return cause instanceof ApiError && cause.failure === 'plan-limit' ? cause.feature : undefined
}

/** One sheet per screen: `offer(code)` opens it for a function, `sheet` is what to render. */
export function useUpgradeSheet(features: readonly ProFeature[]) {
  const [code, setCode] = useState<string | undefined>(undefined)
  // Stable, so a screen can read inside an effect without reading again every render.
  const handled = useCallback((cause: unknown): boolean => {
    const feature = refusedFeature(cause)
    if (feature) setCode(feature)
    return feature !== undefined
  }, [])
  return {
    offer: setCode,
    /** True when the cause was a plan limit, and the sheet is now open for it. */
    handled,
    sheet: <UpgradeSheet code={code} features={features} onDismiss={() => setCode(undefined)} />,
  }
}

export function UpgradeSheet({
  code,
  features,
  onDismiss,
}: {
  readonly code: string | undefined
  readonly features: readonly ProFeature[]
  readonly onDismiss: () => void
}) {
  const router = useRouter()
  const theme = useTheme()
  const copy = upgradeCopy(code ?? '', features)
  return (
    <Sheet visible={code !== undefined} onDismiss={onDismiss} title={copy.title}>
      <View style={styles.stack}>
        <View style={styles.row}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: theme.color.accent.tonal,
                borderColor: theme.color.accent.tonalBorder,
              },
            ]}
          >
            <FoundationIcon name="favourite" size="md" color={theme.color.icon.accent} decorative />
          </View>
          <Text role="body" size="md" color="secondary" style={styles.grow}>
            {copy.body}
          </Text>
        </View>
        <Button
          label="Comparar Gratis y Pro"
          onPress={() => {
            onDismiss()
            router.push('/pro/plans')
          }}
        />
        <Button label="Ahora no" variant="ghost" onPress={onDismiss} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
})
