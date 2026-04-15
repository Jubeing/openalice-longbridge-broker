# OpenAlice 长桥证券 Broker 补丁

通过 `git apply` 将 **Longbridge Broker** 接入 [TraderAlice/OpenAlice](https://github.com/TraderAlice/OpenAlice)。

## 支持的市场

| 市场 | 后缀 | 示例 |
|------|------|------|
| 港股 | `.HK` | `700.HK`（腾讯） |
| 美股 | `.US` | `AAPL.US`（苹果） |
| 沪股通 | `.SH` | `SH.600000` |
| 深股通 | `.SZ` | `SZ.000001` |
| 新加坡 | `.SG` | `STI.SG` |

## 前置要求

- Node.js 18+
- 已克隆 [OpenAlice](https://github.com/TraderAlice/OpenAlice)

## 安装

```bash
# 1. 克隆 OpenAlice
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install

# 2. 应用本补丁
git apply /path/to/longbridge-broker.patch

# 3. 安装 longbridge 依赖
pnpm add longbridge@^4.0.5
```

## 配置

在 OpenAlice 的 config YAML 中添加 broker 条目：

```yaml
brokers:
  - id: longbridge
    type: longbridge
    brokerConfig:
      appKey: "<你的 App Key>"
      appSecret: "<你的 App Secret>"
      accessToken: "<你的 Access Token>"
      live: false   # true 为实盘交易
```

或通过环境变量配置：

```bash
export LONGBRIDGE_APP_KEY="<App Key>"
export LONGBRIDGE_APP_SECRET="<App Secret>"
export LONGBRIDGE_ACCESS_TOKEN="<Access Token>"
```

## 申请 API 凭证

1. 打开 [app.longbridge.global](https://app.longbridge.global) → 设置 → API
2. 创建一个 App，复制 App Key、App Secret 和 Access Token
3. 开通交易权限（行情 + 交易，无提现权限）

## 补丁包含的文件

| 文件 | 说明 |
|------|------|
| `src/domain/trading/brokers/longbridge/LongbridgeBroker.ts` | 核心 `IBroker` 实现 |
| `src/domain/trading/brokers/longbridge/index.ts` | 模块导出 |
| `src/domain/trading/brokers/longbridge/longbridge-types.ts` | TypeScript 类型定义 |
| `src/domain/trading/brokers/longbridge/longbridge-contracts.ts` | 标的符号映射、合约解析、静态注册表 |
| `src/domain/trading/brokers/index.ts` | 导出 `LongbridgeBroker` |
| `src/domain/trading/brokers/registry.ts` | 在工厂中注册 broker |
| `package.json` | 添加 `longbridge` 依赖 |
