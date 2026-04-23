/**
 * Longbridge SDK type definitions and raw API shapes.
 *
 * Matches the official `longbridge` npm package (NAPI-RS, Node.js 18+).
 * Import Config, TradeContext, QuoteContext, Decimal, Market from 'longbridge'.
 */

import type {
  Config,
  TradeContext,
  QuoteContext,
  Market,
  SecurityBoard,
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForceType,
  Decimal,
  SubmitOrderOptions,
  AccountBalance,
  StockPosition,
  Order,
  Execution,
} from 'longbridge'

export type {
  Config,
  TradeContext,
  QuoteContext,
  Market,
  SecurityBoard,
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForceType,
  Decimal,
  SubmitOrderOptions,
  AccountBalance,
  StockPosition,
  Order as LbOrder,
  Execution,
}

export {
  // Market enum values
  Market as LbMarket,
  // SecurityBoard enum values
  SecurityBoard as LbSecurityBoard,
  // OrderType
  OrderType as LbOrderType,
  // OrderSide
  OrderSide as LbOrderSide,
  // OrderStatus
  OrderStatus as LbOrderStatus,
  // TimeInForceType
  TimeInForceType as LbTimeInForceType,
  // Config static methods
} from 'longbridge'

// ==================== Config shapes ====================

export interface LbConfigOptions {
  appKey?: string
  appSecret?: string
  accessToken?: string
  environment?: 'test' | 'live'
}

// ==================== Raw API shapes ====================

/** AccountBalance.cashList[].currency */
export type LbCurrency = 'HKD' | 'USD' | 'CNH' | 'RMB' | 'SGD' | 'HKDC' | 'USDC'

export interface LbAccountBalanceRaw {
  baseCurrency: LbCurrency
  cash: string
  frozenCash: string
  /** Cash available for trading */
  availableCash: string
  /** Account net value */
  netAssets: string
  /** Market value of positions */
  marketValue: string
  currency: LbCurrency
}

export interface LbPositionRaw {
  symbol: string
  stockName: string
  /** Number of shares */
  quantity: number
  /** Shares available to sell */
  availableQuantity: number
  /** Average cost per share */
  averageCost: number
  /** Latest market price */
  lastPrice: number
  /** Market value */
  marketValue: number
  /** Unrealized profit/loss */
  unrealizedPnl: number
  /** Realized profit/loss */
  realizedPnl: number
  /** Currency */
  currency: LbCurrency
  /** Position side */
  side: 'Long' | 'Short'
}

export interface LbOrderRaw {
  orderId: string
  orderIdStr: string
  status: string
  stockName: string
  submittedEdt: string
  submittedAt: string
  expiredAt?: string
  side: string
  orderType: string
  lastPrice: number
  triggerPrice?: number
  submittedPrice?: number
  playedPrice?: number
  playedAt?: string
  securitiesAccountId?: string
  segmentName?: string
  totalQuantity: number
  filledQuantity: number
  averagePrice: number
  currency: LbCurrency
  comment?: string
  timeInForce: string
  /** For trailing orders */
  trailingAmount?: number
  /** For trailing percent orders */
  trailingPercent?: number
  /** For TSLP (trailing stop limit) */
  limitOffset?: number
  /** For stop orders */
  triggerAt?: string
  /** Outside regular trading hours */
  outsideRth?: boolean
  /** Take profit price */
  takeProfitPrice?: number
  /** Stop loss price */
  stopLossPrice?: number
}

export interface LbExecutionRaw {
  executionId: string
  orderId: string
  orderIdStr: string
  symbol: string
  stockName: string
  side: string
  executionPrice: number
  executionQuantity: number
  executionVolume: number
  timestamp: string
  currency: LbCurrency
  transactionId?: string
}

export interface LbQuoteRaw {
  symbol: string
  lastPrice: number
  lastClose: number
  open: number
  high: number
  low: number
  volume: number
  timestamp: number
  bidPriceList: number[]
  askPriceList: number[]
  bidVolumeList: number[]
  askVolumeList: number[]
}

export interface LbTradingSessionRaw {
  /** Unix timestamp ms */
  tradingSessionId: number
  /** 1=pre-market, 2=day, 3=after-hours, 4=closed */
  sessionType: number
  /** ISO timestamp */
  startAt: string
  /** ISO timestamp */
  endAt: string
}

export interface LbMarketTradingSessionRaw {
  market: number
  sessions: LbTradingSessionRaw[]
}

// ==================== Config schema ====================

export interface LongbridgeBrokerConfig {
  id?: string
  label?: string
  appKey?: string
  appSecret?: string
  accessToken?: string
  /** Enable live trading (default: false = paper/test) */
  live?: boolean
}
