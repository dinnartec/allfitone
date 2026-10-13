/**
 * Buying and restoring Pro from a screen: the store's sheet, then the API, then the store
 * again (`pro-store.ts` explains the order).
 *
 * The listener lives as long as the screen that can buy. A purchase that arrives while it
 * is mounted — just bought, or replayed by the store because it was never finished — is
 * presented and finished here; one that arrives elsewhere comes back on the next restore.
 */

import { useEffect, useRef, useState } from 'react'

import type { ProFlow, ProStatus } from '../client/pro'
import {
  buy,
  finish,
  heldPurchases,
  listenForPurchases,
  purchaseOf,
  type StoreOffer,
} from '../client/pro-store'

const NOT_TAKEN =
  'La tienda cobró, pero no pudimos confirmar tu compra. Vuelve a intentarlo con «Restaurar compras»; no se te cobrará otra vez.'
const STORE_FAILED = 'La tienda no pudo completar la compra. Inténtalo de nuevo en un momento.'
const NOTHING_TO_RESTORE = 'No encontramos compras de Allfit Pro en esta cuenta de la tienda.'

export function useProPurchase(flow: ProFlow, onPro: (status: ProStatus) => void) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const done = useRef(onPro)
  done.current = onPro

  useEffect(() => {
    const take = async (purchase: Parameters<typeof purchaseOf>[0]) => {
      const presented = purchaseOf(purchase)
      if (!presented) return
      setBusy(true)
      try {
        const status = await flow.present(presented)
        await finish(purchase)
        setFailure(undefined)
        done.current(status)
      } catch {
        // Left unfinished on purpose: the store hands it back and it is presented again.
        setFailure(NOT_TAKEN)
      } finally {
        setBusy(false)
      }
    }
    return listenForPurchases({
      onPurchase: (purchase) => void take(purchase),
      onFailure: () => {
        setBusy(false)
        setFailure(STORE_FAILED)
      },
    })
  }, [flow])

  return {
    busy,
    failure,
    async subscribe(offer: StoreOffer, accountToken: string) {
      setFailure(undefined)
      setBusy(true)
      try {
        await buy(offer, accountToken)
      } catch {
        setBusy(false)
        setFailure(STORE_FAILED)
      }
    },
    async restore() {
      setFailure(undefined)
      setBusy(true)
      try {
        const held = await heldPurchases()
        let last: ProStatus | undefined
        for (const purchase of held) {
          const presented = purchaseOf(purchase)
          if (!presented) continue
          last = await flow.present(presented)
          await finish(purchase)
        }
        if (last) done.current(last)
        else setFailure(NOTHING_TO_RESTORE)
      } catch {
        setFailure(NOT_TAKEN)
      } finally {
        setBusy(false)
      }
    },
  }
}
