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
    // e.g. "腾讯控股 (700.HK)" instead of just "700"
    c.symbol = `${entry.stockName} (${lbSymbol.toUpperCase()})`
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
  { symbol: '700',   lbSymbol: '700.HK',   secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Tencent Holdings' },
  { symbol: '9988', lbSymbol: '9988.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Alibaba Group' },
  { symbol: '3690', lbSymbol: '3690.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Meituan' },
  { symbol: '9618', lbSymbol: '9618.HK',   secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'JD.com' },
  { symbol: '1810', lbSymbol: '1810.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Xiaomi Corporation' },
  { symbol: '0941', lbSymbol: '0941.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'China Mobile' },
  { symbol: '2628', lbSymbol: '2628.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'China Life Insurance' },
  { symbol: '1398', lbSymbol: '1398.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'ICBC' },
  { symbol: '3968', lbSymbol: '3968.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'China Merchants Bank' },
  { symbol: '3868', lbSymbol: '3868.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'China Overseas Water' },
  { symbol: '1088', lbSymbol: '1088.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'China Shenhua Energy' },
  { symbol: '6633', lbSymbol: '6633.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'China Telecom' },
  { symbol: '1211', lbSymbol: '1211.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'BYD' },
  { symbol: '2319', lbSymbol: '2319.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Mengniu Dairy' },
  { symbol: '0011', lbSymbol: '0011.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'HSBC Holdings' },
  { symbol: '2388', lbSymbol: '2388.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Hang Seng Bank' },
  { symbol: '0001', lbSymbol: '0001.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'CKH Holdings' },
  { symbol: '0016', lbSymbol: '0016.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Sun Hung Kai Properties' },
  { symbol: '0012', lbSymbol: '0012.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Henderson Land' },
  { symbol: '6060', lbSymbol: '6060.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'ZhongAn Online' },
  { symbol: '6030', lbSymbol: '6030.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Citic Securities' },
  { symbol: '6837', lbSymbol: '6837.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Huaan Securities' },
  { symbol: '3888', lbSymbol: '3888.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'China International Capital' },
  { symbol: '1772', lbSymbol: '1772.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'Jiangsu Hengrui Medicine' },
  { symbol: '1515', lbSymbol: '1515.HK',  secType: 'STK', exchange: 'HKEX', currency: 'HKD', stockName: 'CSPC Pharma' },

  // ---- US ----
  { symbol: 'AAPL',  lbSymbol: 'AAPL.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Apple Inc.' },
  { symbol: 'MSFT',  lbSymbol: 'MSFT.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Microsoft Corporation' },
  { symbol: 'NVDA',  lbSymbol: 'NVDA.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'NVIDIA Corporation' },
  { symbol: 'GOOGL', lbSymbol: 'GOOGL.US', secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Alphabet Inc. Class A' },
  { symbol: 'GOOG',  lbSymbol: 'GOOG.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Alphabet Inc. Class C' },
  { symbol: 'AMZN',  lbSymbol: 'AMZN.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Amazon.com Inc.' },
  { symbol: 'META',  lbSymbol: 'META.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Meta Platforms' },
  { symbol: 'TSLA',  lbSymbol: 'TSLA.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Tesla Inc.' },
  { symbol: 'BRK.B', lbSymbol: 'BRK.B.US', secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Berkshire Hathaway B' },
  { symbol: 'JPM',   lbSymbol: 'JPM.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'JPMorgan Chase & Co.' },
  { symbol: 'V',     lbSymbol: 'V.US',     secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Visa Inc.' },
  { symbol: 'MA',    lbSymbol: 'MA.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Mastercard Inc.' },
  { symbol: 'JNJ',   lbSymbol: 'JNJ.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Johnson & Johnson' },
  { symbol: 'WMT',   lbSymbol: 'WMT.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Walmart Inc.' },
  { symbol: 'PG',    lbSymbol: 'PG.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Procter & Gamble' },
  { symbol: 'UNH',   lbSymbol: 'UNH.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'UnitedHealth Group' },
  { symbol: 'HD',   lbSymbol: 'HD.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Home Depot' },
  { symbol: 'BAC',   lbSymbol: 'BAC.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Bank of America' },
  { symbol: 'XOM',   lbSymbol: 'XOM.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Exxon Mobil' },
  { symbol: 'DIS',   lbSymbol: 'DIS.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Walt Disney' },
  { symbol: 'NFLX',  lbSymbol: 'NFLX.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Netflix Inc.' },
  { symbol: 'INTC',  lbSymbol: 'INTC.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Intel Corporation' },
  { symbol: 'AMD',   lbSymbol: 'AMD.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Advanced Micro Devices' },
  { symbol: 'PYPL',  lbSymbol: 'PYPL.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'PayPal Holdings' },
  { symbol: 'CRM',   lbSymbol: 'CRM.US',   secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Salesforce Inc.' },
  { symbol: 'UBER',  lbSymbol: 'UBER.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Uber Technologies' },
  { symbol: 'COIN',  lbSymbol: 'COIN.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Coinbase Global' },
  { symbol: 'SQ',    lbSymbol: 'SQ.US',    secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Block Inc.' },
  { symbol: 'SHOP',  lbSymbol: 'SHOP.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Shopify Inc.' },
  { symbol: 'SPXL',  lbSymbol: 'SPXL.US',  secType: 'STK', exchange: 'SMART', currency: 'USD', stockName: 'Direxion Daily S&P500 3x' },

  // ---- Shanghai Stock Connect ----
  { symbol: '600000', lbSymbol: 'SH.600000', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Shanghai Pudong Dev Bank' },
  { symbol: '600519', lbSymbol: 'SH.600519', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Kweichow Moutai' },
  { symbol: '600036', lbSymbol: 'SH.600036', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'China Merchants Bank' },
  { symbol: '601012', lbSymbol: 'SH.601012', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: '隆基绿能 LONGi Green Energy' },
  { symbol: '601318', lbSymbol: 'SH.601318', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Ping An Insurance' },
  { symbol: '601398', lbSymbol: 'SH.601398', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Industrial and Commercial Bank of China' },
  { symbol: '600276', lbSymbol: 'SH.600276', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Jiangsu Hengrui Medicine' },
  { symbol: '600030', lbSymbol: 'SH.600030', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Citic Securities' },
  { symbol: '600887', lbSymbol: 'SH.600887', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Inner Mongolia Yili' },
  { symbol: '600009', lbSymbol: 'SH.600009', secType: 'STK', exchange: 'SH', currency: 'CNH', stockName: 'Shanghai International Airport' },

  // ---- Shenzhen Stock Connect ----
  { symbol: '000001', lbSymbol: 'SZ.000001', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'Ping An Bank' },
  { symbol: '000002', lbSymbol: 'SZ.000002', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'China Vanke' },
  { symbol: '000063', lbSymbol: 'SZ.000063', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'ZTE Corporation' },
  { symbol: '000333', lbSymbol: 'SZ.000333', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'Midea Group' },
  { symbol: '000858', lbSymbol: 'SZ.000858', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'Wuliangye Yibin' },
  { symbol: '000876', lbSymbol: 'SZ.000876', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'New Hope Liuhe' },
  { symbol: '002594', lbSymbol: 'SZ.002594', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'BYD' },
  { symbol: '002415', lbSymbol: 'SZ.002415', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'Hikvision' },
  { symbol: '002475', lbSymbol: 'SZ.002475', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'Luxshare Precision' },
  { symbol: '300750', lbSymbol: 'SZ.300750', secType: 'STK', exchange: 'SZ', currency: 'CNH', stockName: 'CATL (Contemporary Amperex Technology)' },

  // ---- Singapore ----
  { symbol: 'STI',    lbSymbol: 'STI.SG',    secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'Straits Times Index ETF' },
  { symbol: 'D05',   lbSymbol: 'D05.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'DBS Group Holdings' },
  { symbol: 'O39',   lbSymbol: 'O39.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'OCBC Bank' },
  { symbol: 'U11',   lbSymbol: 'U11.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'United Overseas Bank' },
  { symbol: 'C6L',   lbSymbol: 'C6L.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'Singapore Airlines' },
  { symbol: 'Z74',   lbSymbol: 'Z74.SG',   secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'SATS Ltd' },
  { symbol: 'ME8U',  lbSymbol: 'ME8U.SG',  secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'Mapletree Pan Asia Commercial Trust' },
  { symbol: 'BUOU',  lbSymbol: 'BUOU.SG',  secType: 'STK', exchange: 'SGX', currency: 'SGD', stockName: 'Mapletree Oakwood REIT' },
]
