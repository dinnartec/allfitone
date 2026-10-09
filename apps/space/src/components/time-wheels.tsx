/**
 * A time picked on wheels, as the phone's own clock picks one: hours from 1 to 12,
 * minutes, and the half of the day, each its own wheel (FIN-18d). The clock it holds
 * stays on 24 hours; only what turns reads as people read it.
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

import { fromTwelve, rangeLabel, toTwelve, twelveHour } from '../client/finished'

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1)
const PERIODS = [0, 1]
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute)
const two = (value: number) => String(value).padStart(2, '0')

export interface Clock {
  readonly hour: number
  readonly minute: number
}

export const clockText = (clock: Clock) => `${two(clock.hour)}:${two(clock.minute)}`

/** «6:02 p. m.», for a label; `clockText` stays the value the clock is compared by. */
export function clockShown(clock: Clock): string {
  const { time, period } = twelveHour(clockText(clock))
  return `${time} ${period}`
}

export const clockRange = (start: Clock, end: Clock) => rangeLabel(clockText(start), clockText(end))

/** Hour, minutes and half of the day, turning one clock. */
export function ClockWheels({
  clock,
  onChange,
  label,
}: {
  readonly clock: Clock
  readonly onChange: (clock: Clock) => void
  readonly label: { readonly hour: string; readonly minute: string; readonly period: string }
}) {
  const twelve = toTwelve(clock.hour)
  return (
    <View style={styles.wheels}>
      <WheelPicker
        values={HOURS}
        value={twelve.hour}
        onChange={(hour) => onChange({ ...clock, hour: fromTwelve(hour, twelve.pm) })}
        accessibilityLabel={label.hour}
        style={styles.wheel}
      />
      <Text role="poster" size="3xl" color="muted">
        :
      </Text>
      <WheelPicker
        values={MINUTES}
        value={clock.minute}
        onChange={(minute) => onChange({ ...clock, minute })}
        formatValue={two}
        accessibilityLabel={label.minute}
        style={styles.wheel}
      />
      <WheelPicker
        values={PERIODS}
        value={twelve.pm ? 1 : 0}
        onChange={(period) => onChange({ ...clock, hour: fromTwelve(twelve.hour, period === 1) })}
        formatValue={(period) => (period === 1 ? 'p. m.' : 'a. m.')}
        accessibilityLabel={label.period}
        style={styles.wheel}
      />
    </View>
  )
}

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
          { value: 'start', label: `Empezó · ${clockShown(start)}` },
          { value: 'end', label: `Terminó · ${clockShown(end)}` },
        ]}
        value={turning}
        onChange={setTurning}
      />
      <ClockWheels
        key={turning}
        clock={shown}
        onChange={set}
        label={
          turning === 'start'
            ? {
                hour: 'Hora de inicio',
                minute: 'Minutos de inicio',
                period: 'Mañana o tarde, inicio',
              }
            : { hour: 'Hora de fin', minute: 'Minutos de fin', period: 'Mañana o tarde, fin' }
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  wheel: { flex: 1 },
})
