/**
 * One end of a nutrition target, typed rather than stepped (N-6d).
 *
 * The goal used to be set in a sheet with steppers, and reaching 150 g of protein from
 * 120 in steps of five is six presses where three keys do. The figure is typed on the
 * number pad, with − and + beside it for the small corrections a stepper was good at.
 *
 * Above the keyboard a bar says what is being typed — «Proteína · al menos» — and
 * «Listo» closes it: the number pad has no return key, and a keyboard without a way out
 * is the one thing that makes a typed field worse than a stepper.
 *
 * What is typed stays as typed while the field has focus, so a «1» on the way to «150»
 * is not rewritten under the finger; it is kept within bounds when focus leaves.
 */

import { getNativeFontFamily } from '@allfitone/react-native/fonts'
import { IconButton } from '@allfitone/react-native/icon-button'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { typography } from '@allfitone/react-native/tokens'
import { useEffect, useId, useRef, useState } from 'react'
import { InputAccessoryView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'

const digits = (value: number | null) => (value === null ? '' : String(Math.round(value)))
// The width of one condensed digit at the field's size, a little generous.
const DIGIT = typography.size['3xl'] * 0.52

export function GoalValueField({
  value,
  onChange,
  unit,
  step,
  max,
  accessibilityLabel,
  keyboardTitle,
  autoFocus = false,
  onDone,
}: {
  readonly value: number | null
  readonly onChange: (value: number) => void
  readonly unit: string
  readonly step: number
  readonly max: number
  /** What the field holds, read aloud: «Proteína, al menos». */
  readonly accessibilityLabel: string
  /** Shown above the keyboard while typing: «Proteína · al menos». */
  readonly keyboardTitle: string
  readonly autoFocus?: boolean
  /** When typing ends, by «Listo» or by leaving the field. */
  readonly onDone?: () => void
}) {
  const theme = useTheme()
  const input = useRef<TextInput>(null)
  const accessory = useId()
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(digits(value))

  useEffect(() => {
    if (!focused) setText(digits(value))
  }, [value, focused])

  const clamp = (next: number) => Math.min(max, Math.max(0, next))
  const nudge = (by: number) => onChange(clamp((value ?? 0) + by))

  return (
    <View
      style={[
        styles.field,
        {
          backgroundColor: theme.color.background.canvas,
          borderColor: focused ? theme.color.border.accent : theme.color.border.default,
          borderWidth: focused ? 1.5 : 1,
        },
      ]}
    >
      <IconButton
        icon="subtract"
        size="sm"
        variant="outline"
        accessibilityLabel={`Menos, ${accessibilityLabel}`}
        onPress={() => nudge(-step)}
      />
      {/* Not a control of its own: the field inside is what VoiceOver reaches. */}
      <Pressable accessible={false} onPress={() => input.current?.focus()} style={styles.figure}>
        <TextInput
          ref={input}
          accessibilityLabel={accessibilityLabel}
          value={text}
          onChangeText={(typed) => {
            const clean = typed.replace(/[^0-9]/g, '')
            setText(clean)
            if (clean !== '') onChange(clamp(Number(clean)))
          }}
          onFocus={() => {
            setFocused(true)
            // Selected on every focus, also the automatic one, where selectTextOnFocus does not act.
            requestAnimationFrame(() => input.current?.setSelection(0, text.length))
          }}
          onBlur={() => {
            setFocused(false)
            setText(digits(value))
            onDone?.()
          }}
          autoFocus={autoFocus}
          // Typing replaces the figure: a cursor dropped mid-number mixed old and new digits.
          selectTextOnFocus
          keyboardType="number-pad"
          inputAccessoryViewID={Platform.OS === 'ios' ? accessory : undefined}
          selectionColor={theme.color.border.accent}
          maxLength={5}
          // Sized to its digits: left to measure itself, it kept the width of the last
          // figure, and a value put right after typing showed one digit short.
          style={[
            styles.input,
            { color: theme.color.text.primary, width: (Math.max(1, text.length) + 0.3) * DIGIT },
          ]}
        />
        <Text
          role="control"
          size="sm"
          color="muted"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {unit}
        </Text>
      </Pressable>
      <IconButton
        icon="add"
        size="sm"
        variant="outline"
        accessibilityLabel={`Más, ${accessibilityLabel}`}
        onPress={() => nudge(step)}
      />

      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessory}>
          <View style={[styles.bar, { backgroundColor: theme.color.background.surface }]}>
            <Text role="control" size="sm" color="secondary">
              {keyboardTitle}
            </Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => input.current?.blur()}
            >
              <Text role="control" size="md" color="accent">
                Listo
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 8,
    minHeight: 64,
  },
  figure: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 4,
  },
  input: {
    fontFamily: getNativeFontFamily('poster'),
    fontSize: typography.size['3xl'],
    paddingVertical: 0,
    textAlign: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
})
