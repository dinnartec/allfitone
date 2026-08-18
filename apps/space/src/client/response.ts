/**
 * Reads a successful response that may legitimately carry nothing.
 *
 * Some operations answer with an empty body on purpose. Password recovery is the
 * clearest: `202` with nothing in it, because anything returned would describe
 * what happened and not describing it is exactly the guarantee. Parsing every
 * success as JSON turned that empty body into a thrown error, and the sheet
 * reported a failure for a request that had already sent the mail.
 *
 * A body that is present but malformed still throws. That is a real fault, and
 * reading it as "nothing came back" would hide it.
 */

/** Only what this needs, so a plain object stands in for a `Response` in tests. */
export interface ReadableResponse {
  status: number
  text(): Promise<string>
}

export async function readJsonBody<T>(response: ReadableResponse): Promise<T | undefined> {
  if (response.status === 204) return undefined
  const body = (await response.text()).trim()
  if (body.length === 0) return undefined
  return JSON.parse(body) as T
}
