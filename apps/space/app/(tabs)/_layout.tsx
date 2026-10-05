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
 * Every destination leads somewhere now: Comida got its screen with nutrition
 * (ADR-040), and Progreso left the bar (1 Oct 2026).
 */

import { usePathname } from 'expo-router'
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui'

import { Tab, TabBar } from '../../src/components/tab-bar'

export default function TabsLayout() {
  // `TabTrigger` hands its child the press handling but never says whether it is the
  // focused one, and `usePathname` drops the group segment — so this compares against
  // the same paths the rest of the app navigates to.
  const path = usePathname()

  return (
    <Tabs>
      <TabSlot />

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
          <TabTrigger name="food" href="/food" asChild>
            <Tab icon="nutrition" label="Comida" active={path === '/food'} />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <Tab icon="person" label="Perfil" active={path === '/profile'} />
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  )
}
