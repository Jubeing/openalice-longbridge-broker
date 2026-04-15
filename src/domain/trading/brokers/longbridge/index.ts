/**
 * LongbridgeBroker — OpenAlice broker adapter for Longbridge (长桥证券).
 *
 * Supports: Hong Kong (HK), United States (US), Shanghai (SH),
 * Shenzhen (SZ), Singapore (SG) equity markets.
 *
 * @module
 */

export { LongbridgeBroker } from './LongbridgeBroker.js'
export type { LongbridgeBrokerConfig } from './longbridge-types.js'
export {
  resolveSymbol,
  makeContract,
  STATIC_CONTRACT_REGISTRY,
} from './longbridge-contracts.js'
