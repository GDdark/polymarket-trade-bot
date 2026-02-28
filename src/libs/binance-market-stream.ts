import { WebSocketConnection } from './websocket-connection';
import { AggTradePayload, BinanceStreamMessage, DepthUpdatePayload } from '../common/interfaces';
import { OrderBook } from './order-book';

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
    public readonly orderBook: OrderBook = new OrderBook();

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
                this.orderBook.applyAggTrade(payload as AggTradePayload);
            } else if (stream === STREAM_CHANNEL.DEPTH) {
                const depthUpdate = payload as DepthUpdatePayload;
                this.orderBook.applyDepthUpdate(depthUpdate.b, depthUpdate.a);
            }
        } catch (e) {
            console.error(`[BinanceMarketStream] handleMessage error: ${e}`);
        }
    }
}
