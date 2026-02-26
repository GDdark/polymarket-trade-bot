import { WebSocket } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { IS_DEVELOPMENT } from '../../common/common-types';
import { IMarket, IPriceMap, IWsEvent } from './interfaces';
import { getPrecisionFromPrice } from './utils';
import { MessageQueue } from './message-queue';
import { BookBuilder } from './book-builder';
import { Aggregator } from './aggregator';
import { Projector } from './projector';
import { OrderSummary, Side } from '@polymarket/clob-client';

const POLYMARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export class OrderBookManager {
    private market: IMarket;
    private clobTokenIds: string[];
    private outcomes: string[];
    private subscribedAssetIds: Set<string> = new Set();
    private onEventUpdate: (event: any) => void = null;

    // 状态
    private wsClient: WebSocket = null;
    private intervalTimer: NodeJS.Timeout = null;
    private isInitialized: boolean = false;
    private assetLastBookTs: Map<string, number> = new Map();
    private messageQueue: MessageQueue = new MessageQueue();

    // 重连相关
    private isDestroyed: boolean = false;
    private reconnectAttempts: number = 0;
    private reconnectTimer: NodeJS.Timeout = null;
    private readonly maxReconnectAttempts = 0; // 0 = 无限重连
    private readonly reconnectBaseDelayMs = 1000;
    private readonly reconnectMaxDelayMs = 30000;

    // 数据存储
    private priceMaps: Record<string, IPriceMap> = {};
    private marketTickSizeByAsset: Map<string, number> = new Map();
    private userTickSizeByAsset: Map<string, number> = new Map();
    private snapshotRequired: Set<string> = new Set();

    public constructor(market: IMarket) {
        this.market = market;

        this.clobTokenIds = JSON.parse(market.clobTokenIds);
        this.outcomes = JSON.parse(market.outcomes);
        this.subscribedAssetIds.add(this.clobTokenIds[0]);
        this.marketTickSizeByAsset.set(this.clobTokenIds[0], market.orderPriceMinTickSize);

        this.intervalTimer = setInterval(this.onInterval.bind(this), 1000);
    }

    private onInterval() {
        if (!this.isInitialized || !this.wsClient) {
            return;
        }

        if (Date.now() % 5 === 0) {
            try {
                this.wsClient.send('PING');
            } catch (e) {
                // 忽略发送错误
            }
        }
    }

    public initialize(onEventUpdate: (event: any) => void) {
        this.onEventUpdate = onEventUpdate;
        this.isDestroyed = false;
        this.createWebSocket();
    }

    private createWebSocket() {
        // 如果已销毁，不再创建连接
        if (this.isDestroyed) {
            return;
        }

        // 清理旧连接
        if (this.wsClient) {
            this.wsClient.removeAllListeners();
            try {
                this.wsClient.terminate();
            } catch (e) {
                // 忽略关闭错误
            }
            this.wsClient = null;
        }

        let agent: HttpsProxyAgent<string> | undefined;
        if (IS_DEVELOPMENT) {
            const proxy = "http://127.0.0.1:7890";
            agent = new HttpsProxyAgent(proxy);
        }

        this.wsClient = new WebSocket(POLYMARKET_WS_URL, { agent });

        this.wsClient.on('open', () => {
            console.log('[OrderBook] 🔗 WebSocket 连接成功');
            this.isInitialized = true;
            this.reconnectAttempts = 0;
            this.wsClient.send(JSON.stringify({
                assets_ids: [this.clobTokenIds[0]],
                type: 'market',
            }));
        });

        this.wsClient.on('message', (message) => {
            const msgString = message.toString();
            if (!msgString) {
                return;
            }

            if (msgString === 'PONG') {
                return;
            }

            const msg = JSON.parse(message.toString());
            const events = this.processMessage(msg);
            if (events.length > 0) {
                this.messageQueue.push(events);
                this.messageQueue.process({
                    priceMaps: this.priceMaps,
                    assetLastBookTs: this.assetLastBookTs,
                    snapshotRequired: this.snapshotRequired,
                    marketTickSizeByAsset: this.marketTickSizeByAsset,
                    project: (assetId, type) => {
                        const { marketTickSize, preferredTickSize, isAggregated } =
                            this.getTickSizeConfig(assetId);

                        const priceMap = this.priceMaps[assetId] ?? { bids: new Map(), asks: new Map() };
                        const book = BookBuilder.build(priceMap, marketTickSize);
                        const finalBook = isAggregated
                            ? Aggregator.aggregate(book, preferredTickSize, marketTickSize)
                            : book;

                        const projected = Projector.project(finalBook, {
                            tickSize: preferredTickSize,
                            ts: Date.now(),
                            minified: type === 'minified'
                        });

                        return { status: 'success', data: projected };
                    }
                });
            }

            this.onEventUpdate?.(msg);
        });

        this.wsClient.on('close', (code) => {
            console.warn(`\n[OrderBook] WebSocket 关闭: ${code}`);
            this.isInitialized = false;
            
            // 非主动销毁时自动重连
            if (!this.isDestroyed) {
                this.scheduleReconnect();
            }
        });

        this.wsClient.on('error', (error) => {
            console.error('[OrderBook] WebSocket 错误:', error.message);
        });
    }

    private scheduleReconnect() {
        // 检查是否超过最大重连次数
        if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`[OrderBook] 重连次数超限 (${this.maxReconnectAttempts})，放弃重连`);
            return;
        }

        // 指数退避：delay = baseDelay * 2^attempts，加随机抖动
        const exponentialDelay = this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts);
        const jitter = Math.random() * 1000;
        const delay = Math.min(exponentialDelay + jitter, this.reconnectMaxDelayMs);

        this.reconnectAttempts++;
        console.log(`[OrderBook] 🔄 ${Math.round(delay / 1000)}s 后重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts || '∞'})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.createWebSocket();
        }, delay);
    }

    public destroy() {
        this.isDestroyed = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }

        if (this.wsClient) {
            this.wsClient.removeAllListeners();
            this.wsClient.close();
            this.wsClient = null;
        }
        
        this.isInitialized = false;
    }

    public processMessage(parsed: any): IWsEvent[] {
        if (!parsed) return [];

        const events: IWsEvent[] = [];
        const msgs = Array.isArray(parsed) ? parsed : [parsed];

        for (const msg of msgs) {
            switch (msg.event_type) {
                case 'book': {
                    // 订单簿快照
                    const assetId = String(msg.asset_id || '').toLowerCase();
                    if (this.subscribedAssetIds.has(assetId)) {
                        const ts = parseInt(msg.timestamp ?? '0', 10) || Date.now();
                        events.push({
                            type: 'book',
                            assetId,
                            ts,
                            hash: msg.hash,
                            data: msg,
                        });
                    }
                    break;
                }

                case 'price_change': {
                    // 增量更新
                    const changes = (Array.isArray(msg.price_changes) ? msg.price_changes : []).filter((c: any) => {
                        const assetId = String(c.asset_id || '').toLowerCase();
                        return this.subscribedAssetIds.has(assetId);
                    });

                    if (changes.length) {
                        const assetId = String(changes[0].asset_id || '').toLowerCase();
                        const ts = parseInt(msg.timestamp ?? '0', 10) || Date.now();
                        events.push({
                            type: 'price_change',
                            assetId,
                            ts,
                            data: {
                                price_changes: changes.map((c: any) => ({
                                    price: c.price,
                                    size: c.size,
                                    side: c.side,
                                })),
                            },
                        });
                    }
                    break;
                }

                case 'last_trade_price': {
                    // 最后成交价
                    const assetId = String(msg.asset_id || '').toLowerCase();
                    if (this.subscribedAssetIds.has(assetId)) {
                        events.push({
                            type: 'last-trade-price',
                            assetId,
                            ts: Date.now(),
                            data: {
                                price: msg.price,
                                side: msg.side,
                            },
                        });
                    }
                    break;
                }

                case 'tick_size_change': {
                    // Tick size 变化
                    const assetId = String(msg.asset_id || '').toLowerCase();
                    if (this.subscribedAssetIds.has(assetId)) {
                        events.push({
                            type: 'tick-size-change',
                            assetId,
                            ts: Date.now(),
                            data: {
                                new_tick_size: msg.new_tick_size,
                                old_tick_size: msg.old_tick_size,
                            },
                        });
                    }
                    break;
                }
            }
        }

        return events;
    }

    private getTickSizeConfig(assetId: string): {
        marketTickSize: number;
        userTickSize: number | undefined;
        preferredTickSize: number;
        isAggregated: boolean;
    } {
        const userTickSize = this.userTickSizeByAsset.get(assetId);
        const marketTickSize = this.marketTickSizeByAsset.get(assetId);
        const priceMap = this.priceMaps[assetId] ?? { bids: new Map(), asks: new Map() };

        let detectedTickSize = marketTickSize ?? 0.01;

        // 自动检测 tick size
        if (!marketTickSize) {
            if (priceMap.asks.size > 0) {
                const firstAskPrice = priceMap.asks.keys().next().value;
                const precision = getPrecisionFromPrice(firstAskPrice);
                detectedTickSize = precision === 2 ? 0.01 : precision === 3 ? 0.001 : 0.01;
            } else if (priceMap.bids.size > 0) {
                const firstBidPrice = priceMap.bids.keys().next().value;
                const precision = getPrecisionFromPrice(firstBidPrice);
                detectedTickSize = precision === 2 ? 0.01 : precision === 3 ? 0.001 : 0.01;
            }
        }

        const preferredTickSize = userTickSize ?? detectedTickSize;

        return {
            marketTickSize: detectedTickSize,
            userTickSize,
            preferredTickSize,
            isAggregated: preferredTickSize > detectedTickSize
        };
    }

    public getOrderBookSnapshotByTokenId(tokenId: string, side: Side) {
        let priceMap: IPriceMap = null;
        if (tokenId === this.clobTokenIds[0]) {
            priceMap = this.priceMaps[tokenId];
        } else if (tokenId === this.clobTokenIds[1]) {
            priceMap = this.getInvertedPriceMap(this.clobTokenIds[0]);
        }

        if (!priceMap) {
            throw new Error(`Price map not found for token id: ${tokenId}`);
        }

        let results: OrderSummary[] = [];
        if (side === Side.BUY) {
            priceMap.asks.forEach((size, price) => {
                results.push({
                    price,
                    size,
                });
            });
        } else {
            priceMap.bids.forEach((size, price) => {
                results.push({
                    price,
                    size,
                });
            });
        }

        return results;
    }

    public getCompleteOrderBookSnapshot() {
        const yesPriceMap: IPriceMap = this.priceMaps[this.clobTokenIds[0]];
        const noPriceMap: IPriceMap = this.getInvertedPriceMap(this.clobTokenIds[0]);

        if (!yesPriceMap || !noPriceMap) {
            return null;
        }

        const yesOrderBook = { outcome: this.outcomes[0], asks: [], bids: [] };
        const noOrderBook = { outcome: this.outcomes[1], asks: [], bids: [] };

        yesPriceMap.asks.forEach((size, price) => {
            yesOrderBook.asks.push({
                price: parseFloat(price),
                size: parseFloat(size),
            });

            // sort by price
            yesOrderBook.asks.sort((a, b) => a.price - b.price);
        });

        yesPriceMap.bids.forEach((size, price) => {
            yesOrderBook.bids.push({
                price: parseFloat(price),
                size: parseFloat(size),
            });

            // sort by price
            yesOrderBook.bids.sort((a, b) => b.price - a.price);
        });

        noPriceMap.asks.forEach((size, price) => {
            noOrderBook.asks.push({
                price: parseFloat(price),
                size: parseFloat(size),
            });

            // sort by price
            noOrderBook.asks.sort((a, b) => a.price -b.price);
        });

        noPriceMap.bids.forEach((size, price) => {
            noOrderBook.bids.push({
                price: parseFloat(price),
                size: parseFloat(size),
            });

            // sort by price
            noOrderBook.bids.sort((a, b) => b.price - a.price);
        });

        return {
            yesOrderBook,
            noOrderBook,
        };
    }

    private getInvertedPriceMap(
        yesAssetId: string,
        precision: number = 4
    ): IPriceMap | null {
        const assetId = yesAssetId.toLowerCase();
        const yesPriceMap = this.priceMaps[assetId];

        if (!yesPriceMap) {
            return null;
        }

        const noPriceMap: IPriceMap = {
            bids: new Map(),  // 来自 YES asks
            asks: new Map()   // 来自 YES bids
        };

        const minPrice = Math.pow(10, -precision);  // 0.01 或 0.001

        // YES asks → NO bids
        // 如果有人以 0.60 卖 YES，意味着他愿意以 0.40 买 NO
        yesPriceMap.asks.forEach((size, yesPrice) => {
            const yesPriceNum = parseFloat(yesPrice);
            const noPriceNum = 1 - yesPriceNum;

            // 过滤无效价格
            if (noPriceNum < minPrice || noPriceNum > 1 - minPrice) {
                return;
            }

            const noPriceStr = noPriceNum.toFixed(precision);

            // 合并相同价格的 size
            const existingSize = noPriceMap.bids.get(noPriceStr);
            if (existingSize) {
                const newSize = parseFloat(existingSize) + parseFloat(size);
                noPriceMap.bids.set(noPriceStr, newSize.toString());
            } else {
                noPriceMap.bids.set(noPriceStr, size);
            }
        });

        // YES bids → NO asks
        // 如果有人愿意以 0.60 买 YES，意味着他愿意以 0.40 卖 NO
        yesPriceMap.bids.forEach((size, yesPrice) => {
            const yesPriceNum = parseFloat(yesPrice);
            const noPriceNum = 1 - yesPriceNum;

            // 过滤无效价格
            if (noPriceNum < minPrice || noPriceNum > 1 - minPrice) {
                return;
            }

            const noPriceStr = noPriceNum.toFixed(precision);

            // 合并相同价格的 size
            const existingSize = noPriceMap.asks.get(noPriceStr);
            if (existingSize) {
                const newSize = parseFloat(existingSize) + parseFloat(size);
                noPriceMap.asks.set(noPriceStr, newSize.toString());
            } else {
                noPriceMap.asks.set(noPriceStr, size);
            }
        });

        return noPriceMap;
    }
}