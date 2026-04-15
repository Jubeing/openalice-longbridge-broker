# OpenAlice Longbridge Broker Patch

Integrate **Longbridge Broker** into [TraderAlice/OpenAlice](https://github.com/TraderAlice/OpenAlice) via `git apply`.

## Supported Markets

| Market | Suffix | Example |
|--------|--------|---------|
| Hong Kong | `.HK` | `700.HK` (Tencent) |
| United States | `.US` | `AAPL.US` (Apple) |
| Shanghai A (Stock Connect) | `.SH` | `SH.600000` |
| Shenzhen A (Stock Connect) | `.SZ` | `SZ.000001` |
| Singapore | `.SG` | `STI.SG` |

## Prerequisites

- Node.js 18+
- [OpenAlice](https://github.com/TraderAlice/OpenAlice) clone

## Installation

```bash
# 1. Clone OpenAlice
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install

# 2. Apply this patch
git apply /path/to/longbridge-broker.patch

# 3. Add longbridge dependency
pnpm add longbridge@^4.0.5
```

## Configuration

In your OpenAlice config YAML, add a broker entry:

```yaml
brokers:
  - id: longbridge
    type: longbridge
    brokerConfig:
      appKey: "<your app key>"
      appSecret: "<your app secret>"
      accessToken: "<your access token>"
      live: false   # true for real trading
```

Or set environment variables:

```bash
export LONGBRIDGE_APP_KEY="<key>"
export LONGBRIDGE_APP_SECRET="<secret>"
export LONGBRIDGE_ACCESS_TOKEN="<token>"
```

## API Credentials

1. Open [app.longbridge.global](https://app.longbridge.global) → Settings → API
2. Create an app — copy the App Key, App Secret, and Access Token
3. Grant trading permissions (read + trade, no withdrawal)

## Files in Patch

| File | Purpose |
|------|---------|
| `src/domain/trading/brokers/longbridge/LongbridgeBroker.ts` | Core `IBroker` implementation |
| `src/domain/trading/brokers/longbridge/index.ts` | Module exports |
| `src/domain/trading/brokers/longbridge/longbridge-types.ts` | TypeScript type definitions |
| `src/domain/trading/brokers/longbridge/longbridge-contracts.ts` | Symbol mapping, contract resolution, static registry |
| `src/domain/trading/brokers/index.ts` | Exports `LongbridgeBroker` |
| `src/domain/trading/brokers/registry.ts` | Registers broker in factory |
| `package.json` | Adds `longbridge` dependency |
