/**
 * LongbridgeBroker — IBroker adapter for Longbridge (长桥证券)
 *
 * Supports: HK, US, Shanghai (SH), Shenzhen (SZ), Singapore (SG) equities.
 *
 * Authentication:
 *   Configure via Config.fromApikeyEnv() (reads LONGBRIDGE_APP_KEY,
 *   LONGBRIDGE_APP_SECRET, LONGBRIDGE_ACCESS_TOKEN) or pass credentials
 *   directly in brokerConfig.
 *
 * Symbol format:
 *   HK: "700.HK"        US: "AAPL.US"
 *   Shanghai: "SH.600000"    Shenzhen: "SZ.000001"
 *   Singapore: "STI.SG"
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import {
  Contract,
  ContractDescription,
  ContractDetails,
  Order,
  UNSET_DOUBLE,
  UNSET_DECIMAL,
} from '@traderalice/ibkr'
import {
  BrokerError,
  type IBroker,
  type AccountCapabilities,
  type AccountInfo,
  type Position,
  type PlaceOrderResult,
  type OpenOrder,
  type Quote,
  type MarketClock,
  type BrokerConfigField,
  type TpSlParams,
} from '../types.js'
import '../../contract-ext.js'

import {
  Config,
  TradeContext,
  QuoteContext,
  Decimal as LbDecimal,
  OrderType as LbOrderType,
  OrderSide as LbOrderSide,
  TimeInForceType as LbTimeInForceType,
  OrderStatus as LbOrderStatus,
  StockPosition,
} from 'longbridge'

import {
  resolveSymbol,
  makeContract,
  mapOrderStatus,
  makeOrderState,
  lookupEntry,
} from './longbridge-contracts.js'

import type { LongbridgeBrokerConfig } from './longbridge-types.js'

// ==================== Helpers ====================

/** Convert Longbridge Decimal (NAPI-RS) to plain numeric string. */
function lbToString(d: LbDecimal | null | undefined): string {
  return d ? d.toString() : '0'
}

/** Convert Longbridge Decimal (NAPI-RS) to number. */
function lbToNumber(d: LbDecimal | null | undefined): number {
  return d ? d.toNumber() : 0
}

// ==================== Order type mapping ====================

function ibkrOrderTypeToLb(orderType: string): LbOrderType {
  switch (orderType) {
    case 'LMT':      return LbOrderType.LO
    case 'ELO':      return LbOrderType.ELO
    case 'MKT':      return LbOrderType.MO
    case 'AO':       return LbOrderType.AO
    case 'ALO':      return LbOrderType.ALO
    case 'ODD':      return LbOrderType.ODD
    case 'STP':
    case 'STP LMT':  return LbOrderType.LIT
    case 'LIT':      return LbOrderType.LIT
    case 'MIT':      return LbOrderType.MIT
    case 'TSLPPCT':  return LbOrderType.TSLPPCT
    case 'TSL':
    case 'TSLPAMT': return LbOrderType.TSLPAMT
    case 'TSMAMT':  return LbOrderType.TSMAMT
    case 'TSMPCT':  return LbOrderType.TSMPCT
    default:         return LbOrderType.LO
  }
}

function ibkrTifToLb(tif: string): LbTimeInForceType {
  switch (tif) {
    case 'DAY': return LbTimeInForceType.Day
    case 'GTC': return LbTimeInForceType.GoodTilCanceled
    case 'GTD': return LbTimeInForceType.GoodTilDate
    default:    return LbTimeInForceType.Day
  }
}

function lbStatusToIbkr(status: LbOrderStatus): string {
  switch (status) {
    case LbOrderStatus.Filled:          return 'Filled'
    case LbOrderStatus.PartialFilled:  return 'Submitted'
    case LbOrderStatus.Canceled:        return 'Cancelled'
    case LbOrderStatus.Rejected:        return 'Rejected'
    case LbOrderStatus.Expired:         return 'Expired'
    case LbOrderStatus.New:
    case LbOrderStatus.WaitToNew:
    case LbOrderStatus.WaitToReplace:
    case LbOrderStatus.PendingReplace:
    case LbOrderStatus.Replaced:
    case LbOrderStatus.WaitToCancel:
    case LbOrderStatus.PendingCancel:
    case LbOrderStatus.NotReported:
    case LbOrderStatus.ReplacedNotReported:
    case LbOrderStatus.ProtectedNotReported:
    case LbOrderStatus.VarietiesNotReported:
      return 'Submitted'
    default:
      return 'Submitted'
  }
}

// ==================== Broker ====================

export class LongbridgeBroker implements IBroker {

  // ---- Self-registration ----

  static configSchema = z.object({
    appKey:       z.string().optional(),
    appSecret:    z.string().optional(),
    accessToken:  z.string().optional(),
    live:         z.boolean().default(false),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'appKey',       type: 'password', label: 'App Key',        required: true, sensitive: true,
      description: 'Longbridge app key from app.longbridge.global → Settings → API' },
    { name: 'appSecret',    type: 'password', label: 'App Secret',    required: true, sensitive: true,
      description: 'Longbridge app secret' },
    { name: 'accessToken',  type: 'password', label: 'Access Token', required: true, sensitive: true,
      description: 'Longbridge access token (long-lived OAuth bearer token)' },
    { name: 'live',         type: 'boolean',  label: 'Live Trading', default: false,
      description: 'When disabled, routes to test/paper environment. Enable only when ready for real orders.' },
  ]

  static fromConfig(config: {
    id: string; label?: string; brokerConfig: Record<string, unknown>
  }): LongbridgeBroker {
    const bc = LongbridgeBroker.configSchema.parse(config.brokerConfig)
    return new LongbridgeBroker({
      id:          config.id,
      label:       config.label,
      appKey:      bc.appKey,
      appSecret:   bc.appSecret,
      accessToken: bc.accessToken,
      live:        bc.live,
    })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string

  private tradeCtx!: TradeContext
  private quoteCtx!: QuoteContext
  private readonly config: LongbridgeBrokerConfig

  constructor(config: LongbridgeBrokerConfig) {
    this.config = config
    this.id    = config.id    ?? (config.live ? 'longbridge-live' : 'longbridge')
    this.label = config.label ?? (config.live ? 'Longbridge Live' : 'Longbridge')
  }

  // ---- Lifecycle ----

  private static readonly MAX_INIT_RETRIES   = 5
  private static readonly MAX_AUTH_RETRIES   = 3
  private static readonly INIT_RETRY_BASE_MS = 1000

  async init(): Promise<void> {
    const { appKey, appSecret, accessToken } = this.config

    const cfg: Config =
      (appKey && appSecret && accessToken)
        ? Config.fromApikey(appKey, appSecret, accessToken)
        : Config.fromApikeyEnv()

    let lastErr: unknown
    for (let attempt = 1; attempt <= LongbridgeBroker.MAX_INIT_RETRIES; attempt++) {
      try {
        const [tc, qc] = await Promise.all([
          TradeContext.new(cfg),
          QuoteContext.new(cfg),
        ])
        this.tradeCtx = tc
        this.quoteCtx  = qc

        const balances = await this.tradeCtx.accountBalance()
        console.log(
          `LongbridgeBroker[${this.id}]: connected (accounts=${balances.length})`,
        )
        return
      } catch (err) {
        lastErr = err
        const isAuth = err instanceof Error && /401|unauthorized|invalid/i.test(err.message)
        if (isAuth && attempt >= LongbridgeBroker.MAX_AUTH_RETRIES) {
          throw new BrokerError('AUTH', `Longbridge authentication failed — check your API credentials.`)
        }
        if (attempt < LongbridgeBroker.MAX_INIT_RETRIES) {
          const delay = LongbridgeBroker.INIT_RETRY_BASE_MS * 2 ** (attempt - 1)
          console.warn(`LongbridgeBroker[${this.id}]: init attempt ${attempt} failed, retrying in ${delay}ms…`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    throw lastErr
  }

  async close(): Promise<void> {
    // Longbridge SDK auto-releases on process exit
  }

  // ---- Contract search ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    const needle = pattern.toUpperCase().trim()
    const results: ContractDescription[] = []

    // Single-pass: exact match → prefix match, supports EN + CN name + symbol + lbSymbol
    for (const entry of STATIC_CONTRACT_REGISTRY) {
      const sym   = entry.symbol.toUpperCase()
      const lbSym = entry.lbSymbol.toUpperCase()
      const nameEn = entry.stockName.toUpperCase()
      const nameCn = entry.stockNameCn

      const isExact = sym === needle || lbSym === needle || nameEn === needle
      const isPartial = nameCn.includes(needle) || nameEn.includes(needle) || sym.startsWith(needle) || lbSym.startsWith(needle)

      if (!isExact && !isPartial) continue

      const desc = new ContractDescription()
      desc.contract = makeContract(entry.lbSymbol)
      results.push(desc)

      // Cap exact matches at 50, partial at 20 more
      if (results.length >= (isExact ? 50 : 70)) break
    }

    return results
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const lbSymbol = resolveSymbol(query)
    if (!lbSymbol) return null
    const entry = lookupEntry(lbSymbol)
    const details = new ContractDetails()
    details.contract = entry ? makeContract(entry.lbSymbol) : makeContract(lbSymbol)
    if (entry) {
      details.contract.description = entry.stockName
      details.validExchanges     = entry.exchange
      details.orderTypes         = 'MKT,LMT,STP,LIT,MIT,TSMAMT,TSLPPCT'
      details.stockType          = 'COMMON'
    }
    return details
  }

  // ---- Trading operations ----

  async placeOrder(
    contract: Contract,
    order: Order,
    tpsl?: TpSlParams,
  ): Promise<PlaceOrderResult> {
    const lbSymbol = resolveSymbol(contract)
    if (!lbSymbol) {
      return { success: false, error: `Cannot resolve contract to Longbridge symbol` }
    }

    try {
      const opts: Record<string, unknown> = {
        symbol:       lbSymbol,
        side:        order.action === 'BUY' ? LbOrderSide.Buy : LbOrderSide.Sell,
        orderType:   ibkrOrderTypeToLb(order.orderType),
        timeInForce: ibkrTifToLb(order.tif ?? 'DAY'),
      }

      if (!order.totalQuantity.equals(UNSET_DECIMAL)) {
        opts.submittedQuantity = new LbDecimal(order.totalQuantity.toString())
      } else if (order.cashQty !== UNSET_DOUBLE) {
        opts.submittedQuantity = new LbDecimal(order.cashQty)
      }

      if (order.lmtPrice !== UNSET_DOUBLE) {
        opts.submittedPrice = new LbDecimal(order.lmtPrice)
      }
      if (order.auxPrice !== UNSET_DOUBLE) {
        if (order.orderType === 'TRAIL') {
          opts.trailingAmount = new LbDecimal(order.auxPrice)
        } else {
          opts.triggerPrice = new LbDecimal(order.auxPrice)
        }
      }
      if (order.trailingPercent !== UNSET_DOUBLE) {
        opts.trailingPercent = new LbDecimal(order.trailingPercent)
      }
      if (order.outsideRth) {
        opts.outsideRth = 2  // AnyTime
      }

      if (tpsl?.takeProfit || tpsl?.stopLoss) {
        if (tpsl.takeProfit) opts.takeProfitPrice = new LbDecimal(tpsl.takeProfit.price)
        if (tpsl.stopLoss)   opts.stopLossPrice  = new LbDecimal(tpsl.stopLoss.price)
      }

      const response = await this.tradeCtx.submitOrder(opts as never)

      return {
        success: true,
        orderId: response.orderId,
        message: `Order submitted: ${response.orderId}`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/market.?closed|not.?open|trading.?halt/i.test(msg)) {
        throw new BrokerError('MARKET_CLOSED', msg)
      }
      return { success: false, error: msg }
    }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    try {
      const opts: Record<string, unknown> = { orderId }
      if (changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL)) {
        opts.quantity = new LbDecimal(changes.totalQuantity.toString())
      }
      if (changes.lmtPrice != null && changes.lmtPrice !== UNSET_DOUBLE) {
        opts.price = new LbDecimal(changes.lmtPrice)
      }
      if (changes.auxPrice != null && changes.auxPrice !== UNSET_DOUBLE) {
        opts.triggerPrice = new LbDecimal(changes.auxPrice)
      }
      if (changes.trailingPercent != null && changes.trailingPercent !== UNSET_DOUBLE) {
        opts.trailingPercent = new LbDecimal(changes.trailingPercent)
      }
      await this.tradeCtx.replaceOrder(opts as never)
      return { success: true, orderId, message: `Order ${orderId} replaced` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    try {
      await this.tradeCtx.cancelOrder(orderId)
      return { success: true, orderId, orderState: makeOrderState('Canceled') }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const lbSymbol = resolveSymbol(contract)
    if (!lbSymbol) return { success: false, error: 'Cannot resolve symbol' }

    const positions = await this.getPositions()
    const pos = positions.find(p => {
      const ps = resolveSymbol(p.contract)
      return ps?.toUpperCase() === lbSymbol.toUpperCase()
    })
    if (!pos) return { success: false, error: `No position for ${lbSymbol}` }

    const order = new Order()
    order.action        = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType     = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity

    return this.placeOrder(contract, order)
  }

  // ---- Queries ----

  async getAccount(): Promise<AccountInfo> {
    try {
      const rawBalances = await this.tradeCtx.accountBalance()
      if (rawBalances.length === 0) {
        return {
          baseCurrency:  'HKD',
          netLiquidation: '0',
          totalCashValue: '0',
          unrealizedPnL: '0',
          buyingPower:   '0',
        }
      }

      // Longbridge does not expose cross-currency FX rates, so we cannot safely
      // sum across currencies (e.g. HKD + USD + CNH). Report primary-account
      // values in that account's base currency and note the limitation.
      const primary = rawBalances[0]
      const totalNet  = primary.netAssets
      const totalCash = primary.totalCash

      return {
        baseCurrency:   primary.currency || 'HKD',
        netLiquidation: lbToString(totalNet),
        totalCashValue: lbToString(totalCash),
        // Unrealized PnL is calculated per-position in getPositions() and
        // aggregated by the UTA layer; account-level unrealizedPnL is not
        // available as a single figure from Longbridge.
        unrealizedPnL: '0',
        buyingPower:   lbToString(primary.buyPower),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const resp = await this.tradeCtx.stockPositions()
      const channels = resp.channels ?? []
      const positions: Position[] = []
      const symbols: string[] = []

      // Collect all position symbols for batch quote
      for (const channel of channels) {
        for (const pos of channel.positions ?? []) {
          symbols.push(pos.symbol)
        }
      }

      // Fetch live quotes and Chinese names in parallel
      let livePrices: Map<string, number> = new Map()
      let cnNames: Map<string, string> = new Map()
      if (symbols.length > 0) {
        try {
          const [quotes, staticInfos] = await Promise.all([
            this.quoteCtx.quote(symbols),
            this.quoteCtx.staticInfo(symbols),
          ])
          for (const q of quotes) {
            if (q) livePrices.set(q.symbol, lbToNumber(q.lastDone))
          }
          for (const info of staticInfos) {
            if (info && info.nameCn) cnNames.set(info.symbol, info.nameCn)
          }
        } catch (err) {
          // staticInfo failure is non-fatal — Chinese names will fall back to registry/English.
          console.warn(`LongbridgeBroker[${this.id}].getPositions: staticInfo failed:`, err)
        }
      }

      for (const channel of channels) {
        for (const pos of channel.positions ?? []) {
          positions.push(this.mapStockPosition(pos, livePrices, cnNames))
        }
      }
      return positions
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const results: OpenOrder[] = []
    for (const id of orderIds) {
      const order = await this.getOrder(id)
      if (order) results.push(order)
    }
    return results
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    try {
      const raw = await this.tradeCtx.orderDetail(orderId)
      return this.mapOpenOrder(raw)
    } catch {
      return null
    }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const lbSymbol = resolveSymbol(contract)
    if (!lbSymbol) throw new BrokerError('EXCHANGE', 'Cannot resolve symbol')

    try {
      const [quotes, depthData] = await Promise.all([
        this.quoteCtx.quote([lbSymbol]),
        this.quoteCtx.depth(lbSymbol),
      ])
      const q = quotes[0]
      if (!q) throw new BrokerError('EXCHANGE', `No quote for ${lbSymbol}`)

      // SecurityDepth.bids/asks — each element has .price (Decimal) and .volume
      const bids = depthData.bids ?? []
      const asks = depthData.asks ?? []

      return {
        contract:  makeContract(lbSymbol),
        last:      lbToNumber(q.lastDone),
        bid:       bids[0]?.price ? lbToNumber(bids[0].price) : 0,
        ask:       asks[0]?.price ? lbToNumber(asks[0].price) : 0,
        volume:    q.volume ?? 0,
        high:      lbToNumber(q.high ?? null),
        low:       lbToNumber(q.low ?? null),
        timestamp: q.timestamp ?? new Date(),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  // ---- Market Clock ----

  async getMarketClock(): Promise<MarketClock> {
    try {
      const sessions = await this.quoteCtx.tradingSession()
      const nowMs = Date.now()

      // HKT = UTC+8
      const HKT_OFFSET_MS = 8 * 3600000
      const hktDate = new Date(nowMs + HKT_OFFSET_MS)
      const hktYear  = hktDate.getUTCFullYear()
      const hktMonth = hktDate.getUTCMonth()
      const hktDay   = hktDate.getUTCDate()
      // HKT midnight on date D = UTC 16:00 on date D-1
      const hktMidnightMs = Date.UTC(hktYear, hktMonth, hktDay) - HKT_OFFSET_MS

      for (const mts of sessions) {
        for (const s of mts.tradeSessions) {
          // Extract primitive values from NAPI-RS Time getters
          const bh = s.beginTime.hour   ?? 0, bm = s.beginTime.minute ?? 0, bs = s.beginTime.second ?? 0
          const eh = s.endTime.hour     ?? 0, em = s.endTime.minute   ?? 0, es = s.endTime.second   ?? 0
          const beginMs = hktMidnightMs + bh * 3600000 + bm * 60000 + bs * 1000
          const endMs   = hktMidnightMs + eh * 3600000 + em * 60000 + es * 1000
          if (nowMs >= beginMs && nowMs <= endMs) {
            return { isOpen: s.tradeSession === 0, timestamp: new Date() }
          }
        }
      }
      return { isOpen: false, timestamp: new Date() }
    } catch (err) {
      console.warn(`LongbridgeBroker[${this.id}].getMarketClock failed:`, err)
      return { isOpen: false, timestamp: new Date() }
    }
  }

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes:   ['STK', 'CS'],
      supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT', 'LIT', 'MIT', 'TSMAMT', 'TSLPPCT', 'TSMPCT'],
    }
  }

  // ---- Contract identity ----

  getNativeKey(contract: Contract): string {
    return resolveSymbol(contract) ?? contract.symbol ?? ''
  }

  resolveNativeKey(nativeKey: string): Contract {
    return makeContract(nativeKey)
  }

  // ---- Internal ----

  /** Detect if a Longbridge symbol is a US equity option (e.g. AAPL250517C00150000.US) */
  private isOption(symbol: string): boolean {
    return /^([A-Z]{1,5})(\d{6})([CP])(\d+)\.(US|HK)$/.test(symbol.toUpperCase())
  }

  private mapStockPosition(pos: StockPosition, livePrices: Map<string, number>, cnNames?: Map<string, string>): Position {
    const contract = makeContract(pos.symbol)
    // Priority: Longbridge API nameCn (latest) > registry Chinese name > symbolName (English) > symbol
    const apiCnName = cnNames?.get(pos.symbol)
    if (apiCnName) {
      // Use API Chinese name — append code in brackets
      contract.description = `${apiCnName}（${contract.symbol}）`
    } else if (!contract.description) {
      // Fallback to registry or English name
      contract.description = pos.symbolName ?? pos.symbol
    }
    const qty          = new Decimal(lbToString(pos.quantity))
    const cost         = new Decimal(lbToString(pos.costPrice))
    const livePrice    = livePrices.get(pos.symbol)
    const mktPrice     = livePrice !== undefined ? new Decimal(livePrice) : cost
    // Options use contract multiplier of 100 (each contract = 100 shares)
    const isOpt        = this.isOption(pos.symbol)
    const multiplier   = isOpt ? new Decimal(100) : new Decimal(1)

    return {
      contract,
      currency:     pos.currency ?? 'HKD',
      // Longbridge StockPosition does not expose a long/short side field.
      // initQuantity < 0 would indicate a short position but is not reliably
      // set for all short positions — treat all as 'long' until API exposes it.
      side:         'long',
      quantity:     qty,
      avgCost:      lbToString(pos.costPrice),
      marketPrice:  mktPrice.toString(),
      marketValue:  qty.mul(mktPrice).mul(multiplier).abs().toString(),
      unrealizedPnL: mktPrice.sub(cost).mul(qty).mul(multiplier).toString(),
      // Realized PnL is not exposed per position by Longbridge.
      // It is calculated from execution history (todayExecutions / historyExecutions)
      // which requires a separate aggregation pass; leave as 0 until needed.
      realizedPnL:  '0',
    }
  }

  private mapOpenOrder(o: import('longbridge').OrderDetail): OpenOrder {
    const contract = makeContract(o.symbol)

    const order = new Order()
    order.action         = o.side === LbOrderSide.Buy ? 'BUY' : 'SELL'
    order.totalQuantity  = new Decimal(o.quantity.toString())
    order.orderType      = String(o.orderType)
    if (o.price)         order.lmtPrice = lbToNumber(o.price)
    if (o.triggerPrice)  order.auxPrice = lbToNumber(o.triggerPrice)
    if (o.timeInForce)   order.tif = String(o.timeInForce)
    if (o.outsideRth != null) order.outsideRth = o.outsideRth === 2
    order.orderId = 0   // numeric IBKR convention; string ID in orderId field

    return {
      contract,
      order,
      orderState:  makeOrderState(lbStatusToIbkr(o.status)),
      avgFillPrice: lbToNumber(o.executedPrice),
    }
  }
}
