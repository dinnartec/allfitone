/**
 * The three places you go, as a navigator rather than a pile.
 *
 * They used to be plain `Stack` screens reached with `router.push` and
 * `router.replace`, which meant every visit unmounted the last one and asked the API
 * for its data again. That is what made arriving at Hoy jump: the screen mounted
 * empty, the transition finished, and the content landed afterwards with nothing to
 * cover it. Perfil never jumped because Perfil fetches nothing.
 *
 * A tab navigator keeps them mounted, so coming back is instant and already
 * populated — the jump does not happen rather than being hidden. It also ends two
 * quieter defects: a stack that grew without bound as somebody crossed between
 * Entrenar and Perfil, and three `navigate` functions that each implemented two of
 * the three transitions and disagreed about `push` versus `replace`.
 *
 * **The group is parenthesised, so the URLs do not move.** `(tabs)/today.tsx` still
 * serves `/today`, every `router.replace('/today')` in the app keeps working, and
 * `allfitspace://today` keeps opening.
 *
 * **The triggers are children of the bar, not inside it.** Expo Router finds them by
 * walking the tree through fragments and one `asChild` level and no further, so a
 * `TabTrigger` created inside `TabBar` would never be seen. The bar is a shell now;
 * this file says where each destination leads.
 *
 * Comida has no route to lead to, so it is a plain `Tab` among the triggers — the
 * parser skips anything that is not a trigger, and it answers with what it is waiting
 * on instead of navigating into an empty screen. Progreso left the bar (1 Oct 2026).
 */

import { Text } from '@allfitone/react-native/text'
import { usePathname } from 'expo-router'
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui'
import { useState } from 'react'
import { StyleSheet } from 'react-native'

import { DOCK_HEIGHT, PENDING, Tab, TabBar } from '../../src/components/tab-bar'

export default function TabsLayout() {
  const [pending, setPending] = useState<string | undefined>(undefined)
  // `TabTrigger` hands its child the press handling but never says whether it is the
  // focused one, and `usePathname` drops the group segment — so this compares against
  // the same paths the rest of the app navigates to.
  const path = usePathname()

  return (
    <Tabs>
      <TabSlot />

      {pending ? (
        <Text role="body" size="sm" color="muted" style={styles.pending}>
          {pending}
        </Text>
      ) : null}

      <TabList asChild>
        <TabBar>
          <TabTrigger name="today" href="/today" asChild>
            <Tab icon="home" label="Hoy" active={path === '/today'} />
          </TabTrigger>
          <TabTrigger name="train" href="/train" asChild>
            <Tab icon="training" label="Entrenamiento" active={path === '/train'} />
          </TabTrigger>
          {/* Cubiertos y no una cámara: Comida es dónde vive lo que registraste, y un
              obturador prometía una foto que no es lo que abre. */}
          <Tab
            icon="nutrition"
            label="Comida"
            active={false}
            onPress={() => setPending(PENDING.food)}
          />
          <TabTrigger name="profile" href="/profile" asChild>
            <Tab icon="person" label="Perfil" active={path === '/profile'} />
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  )
}

const styles = StyleSheet.create({
  // Above the bar, out of the way of the content, and in one place rather than
  // repeated in every screen that used to own this state.
  pending: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: DOCK_HEIGHT + 34,
    textAlign: 'center',
  },
})
