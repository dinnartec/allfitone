/**
 * The energy goal's figure, typed in place with a line under it (N-6f).
 *
 * No box: the card already frames it, and a box inside a card inside a screen was one
 * frame too many for the one number the card is about. The line turns accent and the
 * label under it too while the figure is being typed, which is what says where the
 * keyboard is writing when there are two of them — «Desde» and «Hasta».
 *
 * Shown with its thousands mark (2.100) and typed as bare digits; the figure is
 * selected when the field opens, so typing replaces it, and above the keyboard a bar
 * says what is being typed and closes it.
 */

import { getNativeFontFamily } from '@allfitone/react-native/fonts'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { typography } from '@allfitone/react-native/tokens'
import { useEffect, useId, useRef, useState } from 'react'
import { InputAccessoryView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'

const SIZE = typography.size['5xl']
const digits = (value: number) => String(Math.round(value))
const shown = (value: number) => Math.round(value).toLocaleString('es-CO')

export function GoalEnergyFigure({
  value,
  onChange,
  max,
  label,
  keyboardTitle,
  onDone,
}: {
  readonly value: number
  readonly onChange: (value: number) => void
  readonly max: number
  /** Under the line: «Desde», «Hasta» or «Exacta»; also what VoiceOver reads. */
  readonly label: string
  readonly keyboardTitle: string
  readonly onDone?: () => void
}) {
  const theme = useTheme()
  const input = useRef<TextInput>(null)
  const accessory = useId()
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(shown(value))

  useEffect(() => {
    if (!focused) setText(shown(value))
  }, [value, focused])

  const tint = focused ? theme.color.icon.accent : theme.color.border.default

  return (
    <View style={styles.root}>
      <TextInput
        ref={input}
        accessibilityLabel={`Energía, ${label.toLowerCase()}`}
        value={text}
        onChangeText={(typed) => {
          const clean = typed.replace(/[^0-9]/g, '')
          setText(clean)
          if (clean !== '') onChange(Math.min(max, Number(clean)))
        }}
        onFocus={() => {
          setFocused(true)
          const raw = digits(value)
          setText(raw)
          requestAnimationFrame(() => input.current?.setSelection(0, raw.length))
        }}
        onBlur={() => {
          setFocused(false)
          setText(shown(value))
          onDone?.()
        }}
        keyboardType="number-pad"
        inputAccessoryViewID={Platform.OS === 'ios' ? accessory : undefined}
        selectionColor={theme.color.icon.accent}
        maxLength={5}
        style={[styles.input, { color: theme.color.text.primary }]}
      />
      <View style={[styles.line, { backgroundColor: tint }]} />
      <Text role="control" size="sm" style={{ color: focused ? tint : theme.color.text.muted }}>
        {label}
      </Text>

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
  root: { flex: 1, gap: 6 },
  input: {
    fontFamily: getNativeFontFamily('poster'),
    fontSize: SIZE,
    lineHeight: SIZE * 1.05,
    paddingVertical: 0,
  },
  line: { height: 2, borderRadius: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
})
