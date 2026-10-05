export {
  DETAIL_BOUNDS,
  DETAIL_CODES,
  FOOD_GROUPS,
  RecognitionError,
  type DetailCode,
  type Estimate,
  type FoodGroup,
  type FoodRecognizer,
  type RecognisedItem,
  type Recognition,
  type RecognitionFailure,
} from './port.js'
export { createGatewayRecognizer, type GatewaySettings } from './adapters/gateway.js'
export { createMemoryRecognizer, type MemoryRecognizer } from './adapters/memory.js'
export { createFoodRecognizerFromEnv, DEFAULT_MODEL } from './factory.js'
