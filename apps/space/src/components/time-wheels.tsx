/**
 * A time picked on wheels, as the phone's own clock picks one: hours and minutes, each
 * its own wheel (FIN-18d).
 *
 * The session's start and end are one choice made twice, so a segmented control says
 * which of the two the wheels are turning, each with its time on it, and the wheels
 * never show a time that is not one: there is nothing to mistype.
 */

import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Text } from '@allfitone/react-native/text'
import { WheelPicker } from '@allfitone/react-native/wheel-picker'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute)
const two = (value: number) => String(value).padStart(2, '0')

export interface Clock {
  readonly hour: number
  readonly minute: number
}

export const clockText = (clock: Clock) => `${two(clock.hour)}:${two(clock.minute)}`

/** «18:02» as the wheels hold it; anything else is midnight, which the wheels then show. */
export function clockFrom(text: string): Clock {
  const [hour = 0, minute = 0] = text.split(':').map(Number)
  return { hour, minute }
}

export function TimeWheels({
  start,
  end,
  onChange,
}: {
  readonly start: Clock
  readonly end: Clock
  readonly onChange: (next: { readonly start: Clock; readonly end: Clock }) => void
}) {
  const [turning, setTurning] = useState<'start' | 'end'>('start')
  const shown = turning === 'start' ? start : end
  const set = (clock: Clock) =>
    onChange(turning === 'start' ? { start: clock, end } : { start, end: clock })

  return (
    <View style={styles.wrap}>
      <SegmentedControl
        accessibilityLabel="Qué hora cambias"
        items={[
          { value: 'start', label: `Empezó · ${clockText(start)}` },
          { value: 'end', label: `Terminó · ${clockText(end)}` },
        ]}
        value={turning}
        onChange={setTurning}
      />
      <View style={styles.wheels}>
        <WheelPicker
          key={`${turning}-hour`}
          values={HOURS}
          value={shown.hour}
          onChange={(hour) => set({ ...shown, hour })}
          formatValue={two}
          accessibilityLabel={turning === 'start' ? 'Hora de inicio' : 'Hora de fin'}
          style={styles.wheel}
        />
        <Text role="poster" size="3xl" color="muted">
          :
        </Text>
        <WheelPicker
          key={`${turning}-minute`}
          values={MINUTES}
          value={shown.minute}
          onChange={(minute) => set({ ...shown, minute })}
          formatValue={two}
          accessibilityLabel={turning === 'start' ? 'Minutos de inicio' : 'Minutos de fin'}
          style={styles.wheel}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  wheel: { flex: 1 },
})
