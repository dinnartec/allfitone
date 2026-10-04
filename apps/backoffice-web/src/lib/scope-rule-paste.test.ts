import { describe, expect, test } from 'bun:test'

import { parseRuleDrafts } from './scope-definitions'

const ONE_RULE = `[
  {"resource":"identity.body_progress_records","field":"value_numeric",
   "data_classification_code":"body","max_action":"read","historical_readable":true}
]`

describe('pasting the rules of a permission', () => {
  test('loads a rule with every column it names', () => {
    const parsed = parseRuleDrafts(ONE_RULE)

    expect(parsed).toEqual({
      drafts: [
        {
          resource: 'identity.body_progress_records',
          field: 'value_numeric',
          classification: 'body',
          action: 'read',
          excluded: false,
          historical: true,
        },
      ],
    })
  })

  test('fills the two optional flags as false rather than leaving them undefined', () => {
    const parsed = parseRuleDrafts(
      '[{"resource":"nutrition.meals","field":"*","data_classification_code":"nutrition","max_action":"read"}]',
    )

    expect(parsed).toEqual({
      drafts: [
        {
          resource: 'nutrition.meals',
          field: '*',
          classification: 'nutrition',
          action: 'read',
          excluded: false,
          historical: false,
        },
      ],
    })
  })

  test('refuses a key it does not know instead of ignoring it', () => {
    // The whole point of pasting is that a typo cannot become a frozen rule. A
    // misspelled `historical_readable` that silently read false would be worse than
    // typing the rule by hand.
    const parsed = parseRuleDrafts(
      '[{"resource":"nutrition.meals","field":"*","data_classification_code":"nutrition","max_action":"read","historical_readible":true}]',
    )

    expect(parsed).toEqual({
      issue: 'La regla 1 trae una llave que no existe: historical_readible.',
    })
  })

  test('refuses text that is not a list of rules', () => {
    expect(parseRuleDrafts('no soy json')).toEqual({
      issue: 'Eso no es JSON válido.',
    })
    expect(parseRuleDrafts('{}')).toEqual({
      issue: 'Se espera una lista de reglas, entre corchetes.',
    })
    expect(parseRuleDrafts('[]')).toEqual({
      issue: 'La lista no trae ninguna regla.',
    })
    expect(parseRuleDrafts('[1]')).toEqual({ issue: 'La regla 1 no es un objeto.' })
  })

  test('refuses a classification or a level that is not in the closed list', () => {
    expect(
      parseRuleDrafts(
        '[{"resource":"nutrition.meals","field":"*","data_classification_code":"comida","max_action":"read"}]',
      ),
    ).toEqual({ issue: 'La regla 1 clasifica el dato como «comida», que no existe.' })
    expect(
      parseRuleDrafts(
        '[{"resource":"nutrition.meals","field":"*","data_classification_code":"nutrition","max_action":"borrar"}]',
      ),
    ).toEqual({ issue: 'La regla 1 pide el nivel «borrar», que no existe.' })
  })

  test('refuses a rule missing the resource or the field', () => {
    expect(
      parseRuleDrafts('[{"field":"*","data_classification_code":"nutrition","max_action":"read"}]'),
    ).toEqual({ issue: 'La regla 1 no dice sobre qué recurso aplica.' })
    expect(
      parseRuleDrafts(
        '[{"resource":"nutrition.meals","data_classification_code":"nutrition","max_action":"read"}]',
      ),
    ).toEqual({ issue: 'La regla 1 no dice sobre qué campo aplica.' })
  })

  test('loads the twenty rules of the widest permission in one go', () => {
    const rules = Array.from({ length: 20 }, (_, index) => ({
      resource: `planning.table_${index}`,
      field: '*',
      data_classification_code: 'training',
      max_action: 'contribute',
    }))
    const parsed = parseRuleDrafts(JSON.stringify(rules))

    expect('drafts' in parsed && parsed.drafts).toHaveLength(20)
  })
})
