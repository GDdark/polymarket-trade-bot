import { WebSocketConnection } from './websocket-connection';
import { AggTradePayload, BinanceStreamMessage, DepthLevel, DepthUpdatePayload } from '../common/interfaces';

enum STREAM_CHANNEL {
    AGG_TRADE = 'btcusdt@aggTrade',
    DEPTH = 'btcusdt@depth@100ms',
}

const BINANCE_MARKET_STREAM_URL = 'wss://stream.binance.com:9443/stream';
const SUBSCRIBE_MESSAGE = JSON.stringify({
    method: 'SUBSCRIBE',
    params: [
        STREAM_CHANNEL.AGG_TRADE,
        STREAM_CHANNEL.DEPTH,
    ],
    id: 1,
});

export class BinanceMarketStream {
    private connection: WebSocketConnection | null = null;
    private isStarted: boolean = false;
    private silent: boolean = false;
    private bids: Map<string, string> = new Map();
    private asks: Map<string, string> = new Map();

    constructor(options?: {
        silent?: boolean;  // 静默模式，不输出连接日志
    }) {
        this.silent = options?.silent ?? false;
    }

    /**
     * 启动服务，连接所有交易所
     */
    public start(): void {
        if (this.isStarted) {
            console.warn('[BinanceMarketStream] Already started');
            return;
        }

        if (!this.silent) {
            console.log('[BinanceMarketStream] Starting, connecting to exchanges...');
        }

        this.isStarted = true;
        this.createConnection();
    }

    /**
     * 停止服务，断开所有连接
     */
    public stop(): void {
        if (!this.isStarted) {
            return;
        }

        if (!this.silent) console.log('[BinanceMarketStream] Stopping...');
        this.isStarted = false;
        this.connection.destroy();
    }

    private createConnection(): void {
        this.connection = new WebSocketConnection({
            url: BINANCE_MARKET_STREAM_URL,
            maxReconnectAttempts: 0, // 无限重连
            reconnectBaseDelayMs: 3000,
            reconnectMaxDelayMs: 30000,
            pingIntervalMs: 10000, // 10秒 ping 一次，防止代理超时断开

            onOpen: () => {
                if (!this.silent) {
                    console.log(`[BinanceMarketStream] connected`);
                }

                this.connection.sendMessage(SUBSCRIBE_MESSAGE);
            },

            onMessage: (message: string) => {
                this.handleMessage(message);
            },

            onClose: () => {
                if (!this.silent) console.warn(`[BinanceMarketStream] disconnected`);
            },

            onReconnect: (attempt: number) => {
                if (!this.silent) console.log(`[BinanceMarketStream] reconnecting (attempt ${attempt})`);
            }
        });

        this.connection.connect();
    }

    private handleMessage(rawData: string): void {
        try {
            const parsed: BinanceStreamMessage = JSON.parse(rawData);

            const stream = parsed.stream;
            const payload = parsed.data;

            if (stream === STREAM_CHANNEL.AGG_TRADE) {
                this.applyAggTrade(payload as AggTradePayload);
            } else if (stream === STREAM_CHANNEL.DEPTH) {
                const depthUpdate = payload as DepthUpdatePayload;
                this.applyDepthUpdate(depthUpdate.b, depthUpdate.a);
            }

            const orderBook = this.getOrderBook();
            console.log('[BinanceMarketStream] Asks top10:', orderBook.asks.length, orderBook.asks.slice(0, 10).reverse());

            if (stream === STREAM_CHANNEL.AGG_TRADE) {
                const aggTrade = payload as AggTradePayload;
                console.log('aggTrade:', aggTrade.p, aggTrade.q);
            }

            console.log('[BinanceMarketStream] Bids top10:', orderBook.bids.length, orderBook.bids.slice(0, 10));
        } catch (e) {
            console.error(`[BinanceMarketStream] handleMessage error: ${e}`);
        }
    }

    /** aggTrade 实时扣减订单簿：m=true 扣 bid，m=false 扣 ask */
    private applyAggTrade(trade: AggTradePayload): void {
        const side = trade.m ? this.bids : this.asks;
        const existing = side.get(trade.p);
        if (!existing) return;

        const remaining = parseFloat(existing) - parseFloat(trade.q);
        if (remaining <= 0) {
            side.delete(trade.p);
        } else {
            side.set(trade.p, remaining.toFixed(8));
        }
    }

    private applyDepthUpdate(newBids: DepthLevel[], newAsks: DepthLevel[]): void {
        for (const [price, qty] of newBids) {
            if (parseFloat(qty) === 0) {
                this.bids.delete(price);
            } else {
                this.bids.set(price, qty);
            }
        }
        for (const [price, qty] of newAsks) {
            if (parseFloat(qty) === 0) {
                this.asks.delete(price);
            } else {
                this.asks.set(price, qty);
            }
        }
    }

    /** 获取排序后的订单簿快照：bids 降序，asks 升序 */
    public getOrderBook(): { bids: DepthLevel[]; asks: DepthLevel[] } {
        const bids: DepthLevel[] = Array.from(this.bids, ([p, q]) => [p, q]);
        const asks: DepthLevel[] = Array.from(this.asks, ([p, q]) => [p, q]);
        bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
        asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
        return { bids, asks };
    }
}
