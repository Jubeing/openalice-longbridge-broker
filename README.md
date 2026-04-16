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

## 已实现的 IBroker 接口方法

| 方法 | 说明 |
|------|------|
| `init()` | 初始化 TradeContext 和 QuoteContext，验证 API 凭证，5 次重试 + 指数退避 |
| `close()` | 关闭连接（SDK 自动释放） |
| `searchContracts(pattern)` | 在本地静态注册表中搜索合约（支持精确匹配和前缀匹配，最多 50 条） |
| `getContractDetails(query)` | 根据合约解析 Longbridge 标的符号，返回合约详细信息 |
| `placeOrder(contract, order, tpsl?)` | 提交订单，支持市价/限价/止损/跟踪止损/TPSL |
| `modifyOrder(orderId, changes)` | 修改订单（价格、数量、跟踪百分比） |
| `cancelOrder(orderId)` | 取消指定订单 |
| `closePosition(contract, quantity?)` | 平仓（自动判断多空方向） |
| `getAccount()` | 获取账户余额、购买力、净资产（多币种汇总） |
| `getPositions()` | 获取持仓列表（含实时行情批量拉取） |
| `getOrders(orderIds)` | 批量查询订单详情 |
| `getOrder(orderId)` | 查询单个订单详情 |
| `getQuote(contract)` | 获取实时行情（五档盘口、成交量、时间戳） |
| `getMarketClock()` | 查询各市场交易时段，返回当前是否在交易中 |
| `getCapabilities()` | 返回支持的证券类型和订单类型列表 |
| `getNativeKey(contract)` | 将合约解析为 Longbridge 原生标的符号 |
| `resolveNativeKey(nativeKey)` | 将 Longbridge 标的符号解析为 OpenAlice 合约对象 |

### 订单类型支持

`MKT` `LMT` `STP` `STP LMT` `LIT` `MIT` `TSMAMT` `TSLPPCT` `TSMPCT` `ELO` `AO` `ALO` `ODD`

### 持仓映射

持仓自动映射 `StockPosition` → OpenAlice `Position`，实时行情批量查询，失败时回落至成本价。

## 前置要求

- Node.js 18+
- 已克隆 [OpenAlice](https://github.com/TraderAlice/OpenAlice)

## 安装

### 方式一：手动安装补丁

```bash
# 1. 克隆 OpenAlice（跳过如果已有）
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install

# 2. 克隆本仓库获取补丁文件
git clone https://github.com/Jubeing/openalice-longbridge-broker.git
cd openalice-longbridge-broker

# 3. 回到 OpenAlice 目录，应用补丁
git apply /path/to/longbridge-broker.patch

# 4. 安装 longbridge 依赖（-w 表示写入 workspace 根目录）
pnpm add -w longbridge@^4.0.5
```

### 方式二：下载补丁文件

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
curl -fsSL https://raw.githubusercontent.com/Jubeing/openalice-longbridge-broker/main/longbridge-broker.patch -o longbridge-broker.patch
git apply longbridge-broker.patch
pnpm add -w longbridge@^4.0.5
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
| `src/domain/trading/brokers/longbridge/LongbridgeBroker.ts` | 核心 `IBroker` 实现（603 行） |
| `src/domain/trading/brokers/longbridge/index.ts` | 模块导出 |
| `src/domain/trading/brokers/longbridge/longbridge-types.ts` | TypeScript 类型定义 + 原始 API 类型 |
| `src/domain/trading/brokers/longbridge/longbridge-contracts.ts` | 标的符号映射、合约解析、静态注册表（60+ 标的） |
| `src/domain/trading/brokers/index.ts` | 导出 `LongbridgeBroker` |
| `src/domain/trading/brokers/registry.ts` | 在工厂中注册 broker |
| `package.json` | 添加 `longbridge` 依赖 |

## 静态合约注册表

内置 60+ 热门标的，覆盖：

- **港股**：腾讯、阿里、美团、京东、小米、移动、工行、招行等
- **美股**：Apple、Microsoft、NVIDIA、Google、Meta、Tesla、BRK、JPM、V 等
- **沪股通**：茅台、招行、平安、隆基绿能等
- **深股通**：平安银行、万科、中兴、美的、宁德时代、比亚迪等
- **新加坡**：海峡时报指数、DBS、OCBC、大华银行、新航等
