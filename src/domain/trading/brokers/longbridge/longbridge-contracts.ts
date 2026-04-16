/**
 * Contract mapping between Longbridge and OpenAlice (IBKR-style).
 *
 * Longbridge symbol format:
 *   HK equities:  "700.HK"
 *   US equities: "AAPL.US"
 *   Shanghai:     "SH.600000"
 *   Shenzhen:     "SZ.000001"
 *   Singapore:    "STI.SG"
 *
 * Longbridge Market enum (from 'longbridge'):
 *   1  = US Mainland
 *   6  = HK Equity
 *   13 = Shanghai Stock Connect
 *   18 = Shenzhen Stock Connect
 *   22 = Singapore
 *
 * SecurityBoard enum:
 *   HK = Hong Kong listed
 *   US = US listed
 *   SH = Shanghai A shares
 *   SZ = Shenzhen A shares
 *   SG = Singapore
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'

// ---- Longbridge Market and Board helpers ----

export function lbMarketToBoard(market: number): string {
  switch (market) {
    case 6:  return 'HK'
    case 1:  return 'US'
    case 13: return 'SH'
    case 18: return 'SZ'
    case 22: return 'SG'
    default: return 'Unknown'
  }
}

/** Build the Longbridge native symbol string from a Contract. */
export function resolveSymbol(contract: Contract): string | null {
  const { symbol, exchange, secType, currency } = contract

  if (!symbol) return null

  // Extract raw symbol from "腾讯控股 (700.HK)" display format
  const rawMatch = symbol.match(/\(([^)]+)\)$/i)
  const rawSymbol = rawMatch ? rawMatch[1] : symbol

  // Already has a board suffix
  if (/\.(HK|US|SH|SZ|SG)$/i.test(rawSymbol)) {
    return rawSymbol.toUpperCase()
  }

  // Derive from exchange + secType + currency
  if (secType === 'STK' || secType === 'CS' || !secType) {
    if (currency === 'HKD') return `${rawSymbol.toUpperCase()}.HK`
    if (currency === 'USD') return `${rawSymbol.toUpperCase()}.US`
    if (currency === 'CNH' || currency === 'RMB') {
      // Try Shanghai first (SH.600000 style = main index), then SZ
      if (/^\d{6}$/.test(rawSymbol)) {
        // Known Shanghai Stock Connect prefix ranges (simplified)
        if (rawSymbol.startsWith('6') || rawSymbol.startsWith('9')) return `SH.${rawSymbol}`
        return `SZ.${rawSymbol}`
      }
      return `SH.${rawSymbol}`
    }
    if (currency === 'SGD') return `${rawSymbol.toUpperCase()}.SG`
  }

  // Generic fallback
  return rawSymbol.toUpperCase()
}

/** Parse a Longbridge symbol string into IBKR-style Contract fields. */
export function parseSymbol(lbSymbol: string): {
  symbol: string
  exchange: string
  secType: string
  currency: string
} {
  // Handle "腾讯控股 (700.HK)" display format — extract raw symbol from parentheses
  const rawMatch = lbSymbol.match(/\(([^)]+)\)$/i)
  const upper = (rawMatch ? rawMatch[1] : lbSymbol).toUpperCase()

  if (upper.endsWith('.HK')) {
    return { symbol: rawMatch ? lbSymbol : upper.slice(0, -3), exchange: 'HKEX', secType: 'STK', currency: 'HKD' }
  }
  if (upper.endsWith('.US')) {
    return { symbol: rawMatch ? lbSymbol : upper.slice(0, -3), exchange: 'SMART', secType: 'STK', currency: 'USD' }
  }
  if (upper.endsWith('.SH')) {
    return { symbol: rawMatch ? lbSymbol : upper.slice(0, -3), exchange: 'SH', secType: 'STK', currency: 'CNH' }
  }
  if (upper.endsWith('.SZ')) {
    return { symbol: rawMatch ? lbSymbol : upper.slice(0, -3), exchange: 'SZ', secType: 'STK', currency: 'CNH' }
  }
  if (upper.endsWith('.SG')) {
    return { symbol: rawMatch ? lbSymbol : upper.slice(0, -3), exchange: 'SGX', secType: 'STK', currency: 'SGD' }
  }

  // Plain symbol — assume US SMART
  return { symbol: lbSymbol, exchange: 'SMART', secType: 'STK', currency: 'USD' }
}

/** Build a fully qualified IBKR Contract from a Longbridge symbol string. */
export function makeContract(lbSymbol: string): Contract {
  const parsed = parseSymbol(lbSymbol)
  const c = new Contract()
  c.symbol = parsed.symbol
  c.exchange = parsed.exchange
  c.secType = parsed.secType
  c.currency = parsed.currency
  // Find Chinese stock name from registry and prepend to symbol for display
  const entry = STATIC_CONTRACT_REGISTRY.find(
    e => e.lbSymbol.toUpperCase() === lbSymbol.toUpperCase(),
  )
  if (entry?.stockName) {
    // e.g. "腾讯控股(700.HK)" 或 "苹果(AAPL)" (parsed.symbol strips .US/.SG suffix)
    c.symbol = `${entry.stockName}(${parsed.symbol})`
  }
  return c
}

/** Build a fully qualified IBKR Contract from an IBKR-style Contract (passthrough). */
export function makeContractFromContract(contract: Contract): Contract {
  const lbSymbol = resolveSymbol(contract) ?? contract.symbol ?? ''
  return makeContract(lbSymbol)
}

/** Map Longbridge order status string to IBKR-style OrderState status. */
export function mapOrderStatus(status: string): string {
  switch (status) {
    case 'Filled':
    case 'filled':
      return 'Filled'
    case 'PartialFilled':
    case 'partial_filled':
    case 'PartialFill':
      return 'Submitted'  // still active
    case 'Cancelled':
    case 'canceled':
    case 'cancelled':
      return 'Cancelled'
    case 'Rejected':
    case 'rejected':
      return 'Rejected'
    case 'Expired':
    case 'expired':
      return 'Expired'
    case 'New':
    case 'new':
    case 'Submitted':
    case 'submitted':
      return 'Submitted'
    case 'Pending':
    case 'pending':
      return 'Submitted'
    case 'Inactive':
      return 'Inactive'
    default:
      return 'Submitted'
  }
}

/** Create an IBKR OrderState from a Longbridge order status string. */
export function makeOrderState(status: string, rejectReason?: string): OrderState {
  const s = new OrderState()
  s.status = mapOrderStatus(status)
  if (rejectReason) s.rejectReason = rejectReason
  return s
}

/**
 * Static contract registry for Longbridge — seeded with major symbols.
 * This is a fallback for searchContracts() since Longbridge has no search API.
 *
 * Coverage: HK (large-cap), US (major), SG ( Straits Times ),
 * SH/SZ (Shanghai/Shenzhen A-share via Stock Connect).
 */
export const STATIC_CONTRACT_REGISTRY: Array<{
  symbol: string
  lbSymbol: string
  secType: string
  exchange: string
  currency: string
  stockName: string
}> = [
  // ---- Hong Kong ----
  { symbol: '700',   lbSymbol: '700.HK',   secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '腾讯控股' },
  { symbol: '9988', lbSymbol: '9988.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '阿里巴巴' },
  { symbol: '3690', lbSymbol: '3690.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '美团' },
  { symbol: '9618', lbSymbol: '9618.HK',   secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '京东集团' },
  { symbol: '1810', lbSymbol: '1810.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '小米集团' },
  { symbol: '0941', lbSymbol: '0941.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '中国移动' },
  { symbol: '2628', lbSymbol: '2628.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '中国人寿' },
  { symbol: '1398', lbSymbol: '1398.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '工商银行' },
  { symbol: '3968', lbSymbol: '3968.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '招商银行' },
  { symbol: '3868', lbSymbol: '3868.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '中国海外发展' },
  { symbol: '1088', lbSymbol: '1088.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '中国神华' },
  { symbol: '6633', lbSymbol: '6633.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '中国电信' },
  { symbol: '1211', lbSymbol: '1211.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '比亚迪' },
  { symbol: '2319', lbSymbol: '2319.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '蒙牛乳业' },
  { symbol: '0011', lbSymbol: '0011.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '汇丰控股' },
  { symbol: '2388', lbSymbol: '2388.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '恒生银行' },
  { symbol: '0001', lbSymbol: '0001.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '长和' },
  { symbol: '0016', lbSymbol: '0016.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '新鸿基地产' },
  { symbol: '0012', lbSymbol: '0012.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '恒基兆业' },
  { symbol: '6060', lbSymbol: '6060.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '众安在线' },
  { symbol: '6030', lbSymbol: '6030.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '中信证券' },
  { symbol: '6837', lbSymbol: '6837.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '华安证券' },
  { symbol: '3888', lbSymbol: '3888.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '中金公司' },
  { symbol: '1772', lbSymbol: '1772.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '恒瑞医药' },
  { symbol: '1515', lbSymbol: '1515.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: '石药集团' },

  // ---- US ----
  { symbol: 'AAPL',  lbSymbol: 'AAPL.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '苹果' },
  { symbol: 'MSFT',  lbSymbol: 'MSFT.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '微软' },
  { symbol: 'NVDA',  lbSymbol: 'NVDA.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '英伟达' },
  { symbol: 'GOOGL', lbSymbol: 'GOOGL.US', secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '谷歌A' },
  { symbol: 'GOOG',  lbSymbol: 'GOOG.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '谷歌C' },
  { symbol: 'AMZN',  lbSymbol: 'AMZN.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '亚马逊' },
  { symbol: 'META',  lbSymbol: 'META.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Meta' },
  { symbol: 'TSLA',  lbSymbol: 'TSLA.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '特斯拉' },
  { symbol: 'BRK.B', lbSymbol: 'BRK.B.US', secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '伯克希尔B' },
  { symbol: 'JPM',   lbSymbol: 'JPM.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '摩根大通' },
  { symbol: 'V',     lbSymbol: 'V.US',     secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '维萨' },
  { symbol: 'MA',    lbSymbol: 'MA.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '万事达' },
  { symbol: 'JNJ',   lbSymbol: 'JNJ.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '强生' },
  { symbol: 'WMT',   lbSymbol: 'WMT.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '沃尔玛' },
  { symbol: 'PG',    lbSymbol: 'PG.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '宝洁' },
  { symbol: 'UNH',   lbSymbol: 'UNH.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '联合健康' },
  { symbol: 'HD',    lbSymbol: 'HD.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '家得宝' },
  { symbol: 'BAC',   lbSymbol: 'BAC.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '美国银行' },
  { symbol: 'XOM',   lbSymbol: 'XOM.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '埃克森美孚' },
  { symbol: 'DIS',   lbSymbol: 'DIS.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '迪士尼' },
  { symbol: 'NFLX',  lbSymbol: 'NFLX.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '奈飞' },
  { symbol: 'INTC',  lbSymbol: 'INTC.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '英特尔' },
  { symbol: 'AMD',   lbSymbol: 'AMD.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '超微半导体' },
  { symbol: 'PYPL',  lbSymbol: 'PYPL.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '贝宝' },
  { symbol: 'CRM',   lbSymbol: 'CRM.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '赛富时' },
  { symbol: 'UBER',  lbSymbol: 'UBER.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '优步' },
  { symbol: 'COIN',  lbSymbol: 'COIN.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Coinbase' },
  { symbol: 'SQ',    lbSymbol: 'SQ.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Block' },
  { symbol: 'SHOP',  lbSymbol: 'SHOP.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Shopify' },
  { symbol: 'SPXL',  lbSymbol: 'SPXL.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: '标普500三倍做多' },

  // ---- Shanghai Stock Connect ----
  { symbol: '600000', lbSymbol: 'SH.600000', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '浦发银行' },
  { symbol: '600519', lbSymbol: 'SH.600519', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '贵州茅台' },
  { symbol: '600036', lbSymbol: 'SH.600036', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '招商银行' },
  { symbol: '601012', lbSymbol: 'SH.601012', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '隆基绿能' },
  { symbol: '601318', lbSymbol: 'SH.601318', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '中国平安' },
  { symbol: '601398', lbSymbol: 'SH.601398', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '工商银行' },
  { symbol: '600276', lbSymbol: 'SH.600276', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '恒瑞医药' },
  { symbol: '600030', lbSymbol: 'SH.600030', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '中信证券' },
  { symbol: '600887', lbSymbol: 'SH.600887', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '伊利股份' },
  { symbol: '600009', lbSymbol: 'SH.600009', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '上海机场' },

  // ---- Shenzhen Stock Connect ----
  { symbol: '000001', lbSymbol: 'SZ.000001', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '平安银行' },
  { symbol: '000002', lbSymbol: 'SZ.000002', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '万科A' },
  { symbol: '000063', lbSymbol: 'SZ.000063', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '中兴通讯' },
  { symbol: '000333', lbSymbol: 'SZ.000333', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '美的集团' },
  { symbol: '000858', lbSymbol: 'SZ.000858', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '五粮液' },
  { symbol: '000876', lbSymbol: 'SZ.000876', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '新希望' },
  { symbol: '002594', lbSymbol: 'SZ.002594', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '比亚迪' },
  { symbol: '002415', lbSymbol: 'SZ.002415', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '海康威视' },
  { symbol: '002475', lbSymbol: 'SZ.002475', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '立讯精密' },
  { symbol: '300750', lbSymbol: 'SZ.300750', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: '宁德时代' },

  // ---- Singapore ----
  { symbol: 'STI',    lbSymbol: 'STI.SG',    secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: '新加坡海峡时报指数' },
  { symbol: 'D05',   lbSymbol: 'D05.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: '星展集团' },
  { symbol: 'O39',   lbSymbol: 'O39.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: '华侨银行' },
  { symbol: 'U11',   lbSymbol: 'U11.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: '大华银行' },
  { symbol: 'C6L',   lbSymbol: 'C6L.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: '新加坡航空' },
  { symbol: 'Z74',   lbSymbol: 'Z74.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: '星和机场服务' },
  { symbol: 'ME8U',  lbSymbol: 'ME8U.SG',  secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'Mapletree泛亚商业信托' },
  { symbol: 'BUOU',  lbSymbol: 'BUOU.SG',  secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'Mapletree Oakwood REIT' },
]
