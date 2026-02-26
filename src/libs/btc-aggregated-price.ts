import { WebSocketConnection, ConnectionState } from './websocket-connection';

/**
 * BTC 综合价格数据
 */
export interface BtcAggregatedPriceData {
    price: number;           // 综合价格 (USD)
    timestamp: number;       // 价格更新时间戳 (ms)
    activeSources: number;   // 活跃数据源数量
    usdtRate: number;        // USDT/USD 汇率
}

/**
 * 交易所配置
 */
interface ExchangeConfig {
    url: string;
    type: 'USDT' | 'USD' | 'FX';
    subscribe?: object;
}

/**
 * 交易所配置：涵盖 Chainlink 最核心的 5 个数据源
 */
const EXCHANGES: Record<string, ExchangeConfig> = {
    // USDT 计价源 (通过汇率修正)
    BINANCE: { 
        url: 'wss://stream.binance.com:9443/ws', 
        type: 'USDT',
        subscribe: { method: "SUBSCRIBE", params: ["btcusdt@bookTicker"], id: 1 }
    },
    OKX: { 
        url: 'wss://ws.okx.com:8443/ws/v5/public', 
        type: 'USDT',
        subscribe: { op: "subscribe", args: [{ channel: "tickers", instId: "BTC-USDT" }] }
    },
    // USD 直接计价源
    COINBASE: { 
        url: 'wss://ws-feed.exchange.coinbase.com', 
        type: 'USD',
        subscribe: { type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }
    },
    KRAKEN_BTC: { 
        url: 'wss://ws.kraken.com', 
        type: 'USD',
        subscribe: { event: "subscribe", pair: ["BTC/USD"], subscription: { name: "ticker" } }
    },
    BITSTAMP: { 
        url: 'wss://ws.bitstamp.net', 
        type: 'USD', 
        subscribe: { event: "bts:subscribe", data: { channel: "live_trades_btcusd" } }
    },
    // 关键汇率修正源
    FX_KRAKEN: { 
        url: 'wss://ws.kraken.com', 
        type: 'FX',
        subscribe: { event: "subscribe", pair: ["USDT/USD"], subscription: { name: "ticker" } }
    }
};

/**
 * BTC 综合价格服务
 * 从多个交易所获取 BTC 价格，使用中位数算法聚合，模拟 Chainlink 的抗操纵逻辑
 */
export class BtcAggregatedPriceService {
    private connections: Map<string, WebSocketConnection> = new Map();
    private sourcePrices: Map<string, number> = new Map();  // 存储原始价格（USDT源存USDT价格，USD源存USD价格）
    private sourceTypes: Map<string, 'USDT' | 'USD'> = new Map();  // 记录每个源的计价类型
    private usdtRate: number = 0;  // USDT/USD 汇率，0 表示尚未获取
    private hasValidUsdtRate: boolean = false;  // 是否已获取有效汇率
    
    private currentPrice: number = 0;
    private lastUpdateTimestamp: number = 0;
    
    private onPriceUpdate?: (data: BtcAggregatedPriceData) => void;
    private isStarted: boolean = false;

    private silent: boolean = false;

    constructor(options?: { 
        onPriceUpdate?: (data: BtcAggregatedPriceData) => void;
        silent?: boolean;  // 静默模式，不输出连接日志
    }) {
        this.onPriceUpdate = options?.onPriceUpdate;
        this.silent = options?.silent ?? false;
    }

    /**
     * 启动服务，连接所有交易所
     */
    public start(): void {
        if (this.isStarted) {
            console.warn('[BtcAggregatedPrice] Already started');
            return;
        }

        if (!this.silent) console.log('[BtcAggregatedPrice] Starting, connecting to exchanges...');
        this.isStarted = true;

        for (const [id, config] of Object.entries(EXCHANGES)) {
            this.createConnection(id, config);
        }
    }

    /**
     * 停止服务，断开所有连接
     */
    public stop(): void {
        if (!this.isStarted) {
            return;
        }

        if (!this.silent) console.log('[BtcAggregatedPrice] Stopping...');
        this.isStarted = false;

        for (const connection of this.connections.values()) {
            connection.destroy();
        }
        this.connections.clear();
        this.sourcePrices.clear();
    }

    /**
     * 获取当前综合价格数据
     */
    public getPriceData(): BtcAggregatedPriceData {
        return {
            price: this.currentPrice,
            timestamp: this.lastUpdateTimestamp,
            activeSources: this.getActiveSources().length,
            usdtRate: this.usdtRate
        };
    }

    /**
     * 获取当前综合价格
     */
    public getPrice(): number {
        return this.currentPrice;
    }

    /**
     * 获取最后更新时间戳
     */
    public getTimestamp(): number {
        return this.lastUpdateTimestamp;
    }

    /**
     * 获取各数据源价格 (USD)
     * USDT 源会转换为 USD，如果没有有效汇率则返回 0
     */
    public getSourcePrices(): Record<string, number> {
        const result: Record<string, number> = {};
        for (const [id, price] of this.sourcePrices.entries()) {
            const sourceType = this.sourceTypes.get(id);
            if (sourceType === 'USD') {
                result[id] = price;
            } else if (sourceType === 'USDT' && this.hasValidUsdtRate) {
                result[id] = price * this.usdtRate;
            } else {
                result[id] = 0;  // 没有有效汇率，无法转换
            }
        }
        return result;
    }

    private createConnection(id: string, config: ExchangeConfig): void {
        const connection = new WebSocketConnection({
            url: config.url,
            maxReconnectAttempts: 0, // 无限重连
            reconnectBaseDelayMs: 3000,
            reconnectMaxDelayMs: 30000,
            pingIntervalMs: 10000, // 10秒 ping 一次，防止代理超时断开

            onOpen: () => {
                if (!this.silent) console.log(`[BtcAggregatedPrice] ${id} connected`);
                if (config.subscribe) {
                    connection.sendMessage(config.subscribe);
                }
            },

            onMessage: (message: string) => {
                this.handleMessage(id, config, message);
            },

            onClose: () => {
                if (!this.silent) console.warn(`[BtcAggregatedPrice] ${id} disconnected`);
            },

            onReconnect: (attempt: number) => {
                if (!this.silent) console.log(`[BtcAggregatedPrice] ${id} reconnecting (attempt ${attempt})`);
            }
        });

        this.connections.set(id, connection);
        connection.connect();
    }

    private handleMessage(id: string, config: ExchangeConfig, rawData: string): void {
        try {
            const data = JSON.parse(rawData);
            let mid = 0;

            // 解析各平台数据
            if (id === 'BINANCE') {
                if (data.b && data.a) {
                    mid = (parseFloat(data.b) + parseFloat(data.a)) / 2;
                }
            } else if (id === 'OKX') {
                if (data.data && data.data[0]) {
                    mid = (parseFloat(data.data[0].bidPx) + parseFloat(data.data[0].askPx)) / 2;
                }
            } else if (id === 'COINBASE') {
                if (data.best_bid && data.best_ask) {
                    mid = (parseFloat(data.best_bid) + parseFloat(data.best_ask)) / 2;
                }
            } else if (id === 'KRAKEN_BTC') {
                if (Array.isArray(data) && data[1]?.b && data[1]?.a) {
                    mid = (parseFloat(data[1].b[0]) + parseFloat(data[1].a[0])) / 2;
                }
            } else if (id === 'BITSTAMP') {
                if (data.event === 'trade' && data.data?.price) {
                    mid = parseFloat(data.data.price);
                }
            } else if (id === 'FX_KRAKEN') {
                if (Array.isArray(data) && data[1]?.b && data[1]?.a) {
                    this.usdtRate = (parseFloat(data[1].b[0]) + parseFloat(data[1].a[0])) / 2;
                    this.hasValidUsdtRate = true;
                    // 汇率更新后重新聚合
                    this.runAggregation();
                }
                return;
            }

            if (mid > 0) {
                // 存储原始价格和计价类型
                this.sourcePrices.set(id, mid);
                this.sourceTypes.set(id, config.type as 'USDT' | 'USD');
                this.runAggregation();
            }
        } catch (e) {
            // 忽略解析错误
        }
    }

    /**
     * 获取活跃的 USD 价格列表
     * USDT 源必须有有效汇率才能转换为 USD
     */
    private getActiveSources(): number[] {
        const prices: number[] = [];
        for (const [id, price] of this.sourcePrices.entries()) {
            if (price <= 0) continue;
            
            const sourceType = this.sourceTypes.get(id);
            if (sourceType === 'USD') {
                // USD 源直接使用
                prices.push(price);
            } else if (sourceType === 'USDT' && this.hasValidUsdtRate) {
                // USDT 源必须有有效汇率才能转换
                prices.push(price * this.usdtRate);
            }
            // 没有有效汇率的 USDT 源不参与聚合
        }
        return prices;
    }

    private runAggregation(): void {
        const activePrices = this.getActiveSources();
        
        // 至少需要 3 个源激活以计算中位数
        if (activePrices.length < 3) {
            return;
        }

        // 核心算法：中位数 (Median) - 模拟 Chainlink 的抗操纵逻辑
        activePrices.sort((a, b) => a - b);
        let median: number;
        const midIdx = Math.floor(activePrices.length / 2);
        
        if (activePrices.length % 2 === 0) {
            median = (activePrices[midIdx - 1] + activePrices[midIdx]) / 2;
        } else {
            median = activePrices[midIdx];
        }

        // 更新价格和时间戳
        const now = Date.now();
        
        // 只有价格变化时才更新时间戳
        if (Math.abs(median - this.currentPrice) > 0.01) {
            this.currentPrice = median;
            this.lastUpdateTimestamp = now;

            // 触发回调
            if (this.onPriceUpdate) {
                this.onPriceUpdate({
                    price: this.currentPrice,
                    timestamp: this.lastUpdateTimestamp,
                    activeSources: activePrices.length,
                    usdtRate: this.usdtRate
                });
            }
        }
    }

    /**
     * 获取连接状态摘要
     */
    public getConnectionStatus(): Record<string, string> {
        const status: Record<string, string> = {};
        for (const [id, connection] of this.connections.entries()) {
            status[id] = connection.getState();
        }
        return status;
    }

    /**
     * 是否有有效的 USDT/USD 汇率
     */
    public hasUsdtRate(): boolean {
        return this.hasValidUsdtRate;
    }

    /**
     * 是否有有效的综合价格（至少 3 个源且价格 > 0）
     */
    public hasValidPrice(): boolean {
        return this.currentPrice > 0 && this.getActiveSources().length >= 3;
    }
}
