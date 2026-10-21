'use client'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@allfitone/react/components/alert'
import { Button } from '@allfitone/react/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@allfitone/react/components/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@allfitone/react/components/collapsible'
import { Spinner } from '@allfitone/react/components/spinner'
import { FoundationIcon } from '@allfitone/react/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { WorkspacePageHeader } from './workspace-page-header'
import type { InformationCategory } from '@/lib/studio-api'
import { informationCategoriesQueryOptions, isStudioForbidden } from '@/lib/studio-query'

/**
 * `HU-STUDIO-034`. What a member of the gym may ask a client for, and — the
 * half that is easy to drop — where each category stops.
 *
 * **Two voices, kept apart on purpose.** The summary is written for the
 * professional reading this screen: "sessions you assign them", "the photos she
 * picks". The description is written for the client who will be asked: "the
 * sessions we assign you", "the photos you select". Mixing them would leave a
 * reader wondering who "you" is, so the description is presented as what it is
 * — the words the client will read — which is itself worth knowing before
 * asking for something on their behalf.
 *
 * Every summary already carries its own limit ("sin datos de salud", "sin
 * historia clínica", "nunca podrás editarlas"), which is what satisfies the
 * story's first criterion in one line.
 *
 * Unlike the invitation form, this screen answers before anyone curates the
 * permission catalogue: `OP-PRV-022` reads the wording alone.
 */

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; categories: InformationCategory[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }

/*
 * The seven V1 codes, in the order the story names them: training, prior
 * history, body, health, and then the nutrition ones. The database already
 * answers in this order; repeating it here is the guard, not the sort — a
 * catalogue that comes back short is not a catalogue, and showing six of seven
 * would quietly teach somebody that the missing one does not exist.
 */
const EXPECTED_CODES = [
  'relationship_training',
  'prior_training_history',
  'body_progress',
  'health_context',
  'nutrition_intake',
  'nutrition_media',
  'nutrition_guidance',
] as const

export function InformationCategoryCatalog() {
  const query = useQuery(informationCategoriesQueryOptions())
  const forbidden = isStudioForbidden(query.error)
  const categories =
    !forbidden && query.data?.items && hasEveryCategory(query.data.items)
      ? query.data.items
      : undefined
  const state: CatalogState = forbidden
    ? { kind: 'forbidden' }
    : categories
      ? { kind: 'ready', categories }
      : query.isPending
        ? { kind: 'loading' }
        : { kind: 'error' }

  return (
    <section data-team-page data-category-page aria-label="Categorías de información">
      <WorkspacePageHeader description="Allfit One tiene siete categorías de información fijas. Consulta qué abarca cada una, y dónde para, antes de pedirle algo a un cliente." />

      {query.isFetching && state.kind === 'ready' ? (
        <p data-query-refreshing role="status" aria-live="polite">
          Actualizando categorías de información…
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <Card>
          <CardContent data-category-catalog-state>
            <Spinner label="Cargando categorías de información" />
            <p>Cargando categorías de información…</p>
          </CardContent>
        </Card>
      ) : null}

      {state.kind === 'forbidden' ? (
        <Alert variant="warning">
          <AlertTitle>No puedes consultar estas categorías</AlertTitle>
          <AlertDescription>
            Tu membresía ya no está disponible. Vuelve a entrar para consultarlas.
          </AlertDescription>
        </Alert>
      ) : null}

      {state.kind === 'error' ? (
        <Alert variant="danger" live="polite">
          <AlertTitle>No pudimos cargar las categorías</AlertTitle>
          <AlertDescription>
            La conexión falló de forma temporal. El catálogo permanecerá oculto hasta comprobarlo de
            nuevo.
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {state.kind === 'ready' ? (
        <div data-category-register>
          {state.categories.map((category) => (
            <CategoryRegisterItem key={category.scope_code} category={category} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function CategoryRegisterItem({ category }: { category: InformationCategory }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-category-card={category.scope_code}>
      <Card data-category-register-item>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {category.display_name}
          </CardTitle>
          {/* The professional's line. It says what the category covers and, in
              the same breath, where it stops — which is the whole reason it is
              the text on this screen rather than the longer one. */}
          {category.summary ? <CardDescription>{category.summary}</CardDescription> : null}
          {/* No code badge here, unlike the role catalogue. A role code is four
              characters and names something a member picks elsewhere; a scope
              code is `prior_training_history`, English, twenty-two characters,
              and nothing on any screen ever asks a member to type it. It earned
              nothing and overflowed its badge on a phone. */}
        </CardHeader>

        <CardContent data-category-card-body>
          <div data-category-disclosure>
            <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
              {open ? 'Ocultar lo que lee tu cliente' : 'Ver lo que lee tu cliente'}
              <FoundationIcon name={open ? 'collapse' : 'expand'} decorative />
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            {/* Written in the client's voice, because it is literally what the
                invitation shows them. A member who knows these words knows what
                is being promised on their behalf. */}
            <div data-category-client-view>
              <p data-category-client-label>Lo que verá tu cliente</p>
              <p data-category-description>{category.description}</p>
              <p data-category-purpose-label>Y para qué se lo pides</p>
              <p data-category-purpose>{category.default_purpose}</p>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  )
}

/*
 * Seven or nothing. The screen cannot tell a short answer from a complete one,
 * and a member who counts six categories would conclude the seventh does not
 * exist — the opposite of what a reference page is for.
 */
function hasEveryCategory(categories: InformationCategory[]): boolean {
  return (
    categories.length === EXPECTED_CODES.length &&
    categories.every((category, index) => category.scope_code === EXPECTED_CODES[index])
  )
}
