export interface IMarket {
    id: string;
    question: string;
    conditionId: string;
    slug: string;
    resolutionSource: string;
    endDate: string;
    startDate: string;
    image: string;
    icon: string;
    description: string;
    outcomes: string;
    outcomePrices: string[];
    volume: string;
    active: boolean;
    closed: boolean;
    marketMakerAddress: string;
    createdAt: string;
    updatedAt: string;
    new: boolean;
    featured: boolean;
    archived: boolean;
    restricted: boolean;
    groupItemThreshold: string;
    questionID: string;
    enableOrderBook: boolean;
    orderPriceMinTickSize: number;
    orderMinSize: number;
    volumeNum: number;
    liquidityNum: number;
    endDateIso: string;
    startDateIso: string;
    hasReviewedDates: boolean;
    volume24hr: number;
    volume1wk: number;
    volume1mo: number;
    volume1yr: number;
    clobTokenIds: string;
    volume24hrClob: number;
    volume1wkClob: number;
    volume1moClob: number;
    volume1yrClob: number;
    volumeClob: number;
    liquidityClob: number;
    makerBaseFee: number;
    takerBaseFee: number;
    acceptingOrders: boolean;
    negRisk: boolean;
    events: any[];
    ready: boolean;
    funded: boolean;
    acceptingOrdersTimestamp: string;
    cyom: boolean;
    competitive: number;
    pagerDutyNotificationEnabled: boolean;
    approved: boolean;
    rewardsMinSize: number;
    rewardsMaxSpread: number;
    spread: number;
    oneHourPriceChange: number;
    lastTradePrice: number;
    bestBid: number;
    bestAsk: number;
    automaticallyActive: boolean;
    clearBookOnStart: boolean;
    showGmpSeries: boolean;
    showGmpOutcome: boolean;
    manualActivation: boolean;
    negRiskOther: boolean;
    umaResolutionStatuses: string;
    pendingDeployment: boolean;
    deploying: boolean;
    rfqEnabled: boolean;
    eventStartTime: string;
    holdingRewardsEnabled: boolean;
    feesEnabled: boolean;
    requiresTranslation: boolean;
    makerRebatesFeeShareBps: number;
}

/**
 * Polymarket Order Book Manager - Readable Version
 * 
 * 这是 Polymarket 前端订单簿处理逻辑的可读版本
 * 原始文件: 25415611023858e6.js
 * 
 * 数据源:
 * - CLOB REST API: https://clob.polymarket.com
 * - CLOB WebSocket: wss://ws-subscriptions-clob.polymarket.com/ws/market
 * - RTDS WebSocket: wss://live-data-ws.polymarket.com/ws
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 订单级别 */
export interface IOrderLevel {
    price: string;
    size: string;
}

/** 处理后的订单级别 */
export interface IProcessedLevel {
    price: string;
    size: string;
    value: string;
    netSize: string;
    netValue: string;
    includedLevels: string[];
}

/** 价格 Map 结构 */
export interface IPriceMap {
    bids: Map<string, string>;  // price -> size
    asks: Map<string, string>;
}

/** 单边订单簿 */
export interface IOrderBookSide {
    askArray: IProcessedLevel[];
    bidArray: IProcessedLevel[];
    bestAsk: number | null;
    bestBid: number | null;
    spread: number | null;
    midpoint: number | null;
}

/** 完整订单簿（YES + NO） */
export interface IFullOrderBook {
    zero: IOrderBookSide;   // YES
    one: IOrderBookSide;    // NO
    activeTickSize: number;
}

/** 投影后的订单簿（用于 UI） */
export interface IProjectedOrderBook {
    tickSize: number;
    zero: IProjectedSide;
    one: IProjectedSide;
    bestPrices: {
        '~zero': { buy: string | null; sell: string | null };
        '~one': { buy: string | null; sell: string | null };
    };
    ts: number;
}

export interface IProjectedSide {
    asks: IProjectedSideData;
    bids: IProjectedSideData;
    spread: number | null;
    midpoint: number | null;
    totalBidCount: number;
    totalAskCount: number;
}

export interface IProjectedSideData {
    rows: IProcessedLevel[];
    bestPrice: string | undefined;
    hasLiquidity: boolean;
    totalSize: number;
    totalValue: number;
}

/** WebSocket 消息事件 */
export interface IWsBookEvent {
    type: 'book';
    assetId: string;
    ts: number;
    hash?: string;
    data: any;
}

export interface IWsPriceChangeEvent {
    type: 'price_change';
    assetId: string;
    ts: number;
    data: {
        price_changes: Array<{
            price: string;
            size: string;
            side: string;
        }>;
    };
}

export interface IWsLastTradePriceEvent {
    type: 'last-trade-price';
    assetId: string;
    ts: number;
    data: {
        price: string;
        side: string;
    };
}

export interface IWsTickSizeChangeEvent {
    type: 'tick-size-change';
    assetId: string;
    ts: number;
    data: {
        new_tick_size: string;
        old_tick_size: string;
    };
}

export type IWsEvent = IWsBookEvent | IWsPriceChangeEvent | IWsLastTradePriceEvent | IWsTickSizeChangeEvent;

/** Clamp 结果 */
export interface IClampResult {
    valid: boolean;
    number: number | null;
    string: string | null;
}