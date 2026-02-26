import { Injectable } from '@nestjs/common';
import { PolymarketApiService } from '../services/polymarket-api.service';
import { OrderBookManager } from '../libs/polymarket-order-book/order-book-manager';
import { PolymarketTrader } from './polymarket-trader';
import { IMarket } from '../libs/polymarket-order-book/interfaces';
import { OrderType, Side } from '@polymarket/clob-client';
import { calculateBuyMarketPrice } from '../libs/polymarket-order-book/utils';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Fs from 'fs';
import { WebSocketConnection } from '../libs/websocket-connection';
import { IS_DEVELOPMENT, POLYMARKET_LIVE_DATA_WS_URL } from '../common/common-types';
import Axios from 'axios';
import { formatUnits } from 'ethers';
import { BtcAggregatedPriceService } from '../libs/btc-aggregated-price';
import { BaseStrategy } from './strategys/base.strategy';
import { S27MeanReversionStrategy } from './strategys/s27-mean-reversion.strategy';
import { S31InvertStrategy } from './strategys/s31-invert.strategy';
import { S34InvertAggregatedStrategy } from './strategys/s34-invert-aggregated.strategy';
import { S35MeanReversionAggregatedStrategy } from './strategys/s35-mean-reversion-aggregated.strategy';
import { S36MeanReversionExtendedStrategy } from './strategys/s36-mean-reversion-extended.strategy';
import { S37MeanReversionTakeProfitStrategy } from './strategys/s37-mean-reversion-take-profit.strategy';

@Injectable()
export class BTC15MExecutor {
    public static supportTradeMode: boolean = true;
    public outcomes: string[] = [];
    public historyBTCPrices: { timestamp: number; price: number }[] = [];
    public historyBTCAggregatedPricesMap: Record<string, { timestamp: number; price: number }[]> = {};
    public latestMarketPrices: Record<string, number> = {};

    private canInterval = true;
    private canBidStartDate = new Date('2026-01-25T22:00:00.000Z');
    private canBidEndDate = new Date('2026-01-20T09:00:00.000Z');
    private canBid = !IS_DEVELOPMENT;
    private usdeStopLossLine: number = 3; // 3 USDE
    private market: IMarket = null;
    private tokenIds: string[] = [];
    private bidResults: { outcome: string; price: number; shares: number; timestamp: string; createOrderCost: number; postOrderCost: number; type: string }[] = [];
    private simulatedBidResults: { outcome: string; price: number; shares: number; timestamp: string; type: string }[] = [];
    private amountBid: number = 1;
    private baseBTCPriceToBeat: number = 0;
    private historyPriceRecords: { timestamp: number;[key: string]: any }[] = [];
    private isExecuting: boolean = false;  // 防止并发执行

    private orderBookManager: OrderBookManager = null;
    private marketLiveDataConnection: WebSocketConnection = null;
    private btcAggregatedPriceService: BtcAggregatedPriceService = null;
    private strategys: BaseStrategy[] = [];

    public constructor(
        private readonly polymarketApiService: PolymarketApiService,
        private readonly polymarketTrader: PolymarketTrader,
    ) {
        this.btcAggregatedPriceService = new BtcAggregatedPriceService({
            silent: true,  // 静默模式，避免干扰终端单行输出
            onPriceUpdate: this.onBTCAggregatedPriceUpdate.bind(this),
        });
    }

    @Cron(CronExpression.EVERY_SECOND)
    public async onInterval() {
        if (process.env.COMMAND !== 'btc-15m-executor') {
            return;
        }

        this.checkUSDEStopLoss();

        if (this.baseBTCPriceToBeat === 0) {
            this.initializeThisMarketBaseBTCPriceToBeat();
        }

        if (!this.canInterval) {
            return;
        }

        if (this.isExecuting) {
            return;
        }

        if (!this.market) {
            return;
        }

        const currentSlug = this.getCurrentSlug();
        const originSlug = this.market.slug;
        const originSlugTimestamp = Number(originSlug.split('-')[3]);
        if (currentSlug === originSlug) {
            return;
        }

        // 重置
        this.isExecuting = true;

        try {
            if (this.orderBookManager) {
                this.orderBookManager.destroy();
            }

            if (this.marketLiveDataConnection) {
                this.marketLiveDataConnection.destroy();
            }

            console.log();
            console.log(`[BTC15MExecutor] 🔥 Result - ${originSlug}`, this.bidResults);
            console.log(`[BTC15MExecutor] 🤔 Simulated - ${originSlug}`, this.simulatedBidResults);
            console.log(`[BTC15MExecutor] 🔥 Reset - ${currentSlug}`);
            let start = Date.now();
            Fs.writeFileSync(`./bid-results/${this.market.slug}-price-records.json`, JSON.stringify(this.historyPriceRecords));
            Fs.writeFileSync(`./bid-results/${this.market.slug}-btc-prices.json`, JSON.stringify(this.historyBTCPrices));
            Fs.writeFileSync(`./bid-results/${this.market.slug}-btc-aggregated-prices.json`, JSON.stringify(this.historyBTCAggregatedPricesMap[originSlugTimestamp]));
            Fs.writeFileSync(`./bid-results/${this.market.slug}-bid-results.json`, JSON.stringify(this.bidResults));
            Fs.writeFileSync(`./bid-results/${this.market.slug}-simulated-bid-results.json`, JSON.stringify(this.simulatedBidResults));
            console.log(`[BTC15MExecutor] 🔥 Save price records cost: ${Date.now() - start}ms`);

            delete this.historyBTCAggregatedPricesMap[originSlugTimestamp];

            await this.execute();
        } finally {
            this.isExecuting = false;
        }
    }

    public async initialize(slug: string) {
        const market = await this.polymarketApiService.getMarketBySlug(slug);
        if (!market) {
            throw new Error(`Market not found: ${slug}`);
        }

        this.market = market;
        this.tokenIds = JSON.parse(this.market.clobTokenIds);
        this.outcomes = JSON.parse(this.market.outcomes);

        this.bidResults = [];
        this.simulatedBidResults = [];
        this.historyPriceRecords = [];
        this.historyBTCPrices = [];
        this.baseBTCPriceToBeat = 0;

        this.strategys = [
            new S27MeanReversionStrategy(this),
            new S31InvertStrategy(this),
            new S34InvertAggregatedStrategy(this),
            new S35MeanReversionAggregatedStrategy(this),
            new S36MeanReversionExtendedStrategy(this),
            new S37MeanReversionTakeProfitStrategy(this),
        ];

        await this.polymarketTrader.initialize(this.market);
        
        // 先执行一次buildOrder，可能涉及到一些缓存
        this.polymarketTrader.buildMarketOrder(this.tokenIds[0], 0.1, this.amountBid, Side.BUY);

        this.marketLiveDataConnection = new WebSocketConnection({
            url: POLYMARKET_LIVE_DATA_WS_URL,
            onOpen: this.handleMarketLiveDataOpen.bind(this),
            onMessage: this.handleMarketLiveDataMessage.bind(this),
        });
        this.marketLiveDataConnection.connect();

        this.orderBookManager = new OrderBookManager(this.market);
        this.orderBookManager.initialize(this.onOrderBookEventUpdate.bind(this));
    }

    public async execute(slug?: string) {
        if (!!slug) {
            this.canInterval = false;
        }

        slug = slug || this.getCurrentSlug();

        this.btcAggregatedPriceService.start();
        await this.initialize(slug);
    }

    private onOrderBookEventUpdate(event: any) {
        if (!event || !event.event_type) {
            return;
        }

        if (event.event_type !== 'price_change') {
            return;
        }

        let prices = {};
        for (const price_change of event.price_changes) {
            const tokenId = price_change.asset_id;
            const tokenIndex = this.tokenIds.findIndex(id => id.toLowerCase() === tokenId.toLowerCase());
            prices[this.outcomes[tokenIndex]] = Number(price_change.best_ask);
        }

        const historyPriceRecord = {
            timestamp: Number(event.timestamp),
            ...prices,
        };

        this.historyPriceRecords.unshift(historyPriceRecord);
        this.latestMarketPrices = prices;  // 更新最新市场价格供策略使用

        this.checkStrategysAndBid();

        const outcome0Price = prices[this.outcomes[0]];
        const outcome1Price = prices[this.outcomes[1]];

        const fixedOutcome0Price = (outcome0Price * 100).toFixed(2);
        const fixedOutcome1Price = (outcome1Price * 100).toFixed(2);

        const currentMarketSlugTimestamp = this.getCurrentMarketSlugTimestamp();
        const btcFromPolymarketBase = this.historyBTCPrices.length > 0 ? this.historyBTCPrices[this.historyBTCPrices.length - 1].price : 0;
        const btcFromPolymarketLatest = this.historyBTCPrices.length > 0 ? this.historyBTCPrices[0].price : 0;
        const btcFromPolymarketOffset = btcFromPolymarketLatest - btcFromPolymarketBase;
        const aggregatedPrices = this.historyBTCAggregatedPricesMap[currentMarketSlugTimestamp];
        const btcFromAggregatedPriceBase = aggregatedPrices?.length > 0 ? aggregatedPrices[aggregatedPrices.length - 1].price : 0;
        const btcFromAggregatedPriceLatest = aggregatedPrices?.length > 0 ? aggregatedPrices[0].price : 0;
        const btcFromAggregatedPriceOffset = btcFromAggregatedPriceLatest - btcFromAggregatedPriceBase;
        const btcDiff = btcFromPolymarketOffset - btcFromAggregatedPriceOffset;

        process.stdout.write(
            `\r\x1B[KUp ${fixedOutcome0Price} | Dn ${fixedOutcome1Price} | ${Date.now() - event.timestamp}ms | PM: ${btcFromPolymarketOffset.toFixed(1)} | AGG: ${btcFromAggregatedPriceOffset.toFixed(1)} | DIFF: ${btcDiff.toFixed(1)}`
        );
    }

    private async simulateBid(outcomeIndex: number, strategyType: string) {
        const orderBook = this.orderBookManager.getOrderBookSnapshotByTokenId(this.tokenIds[outcomeIndex], Side.BUY);
        const price = calculateBuyMarketPrice(orderBook, this.amountBid, OrderType.FAK);
        const shares = Math.ceil((1 / price + Number.EPSILON) * 100) / 100;

        this.simulatedBidResults.push({
            outcome: this.outcomes[outcomeIndex],
            price,
            shares,
            timestamp: new Date().toISOString(),
            type: strategyType,
        });

        console.log(`\n[BTC15MExecutor] 🤔 Simulate Bid [${strategyType}]: ${this.outcomes[outcomeIndex]} @ ${price} | Shares: ${shares}`);
    }

    private async bid(outcomeIndex: number, strategyType: string) {
        try {
            // 必须成交 中心化订单簿会自动匹配最优价格
            const price = 0.99;

            let start = Date.now();
            const order = await this.polymarketTrader.buildMarketOrder(this.tokenIds[outcomeIndex], price, this.amountBid, Side.BUY);
            const createOrderCost = Date.now() - start;

            start = Date.now();
            const orderResult = await this.polymarketTrader.postOrder(order, OrderType.FAK);
            if (!!orderResult.error) {
                console.error(`[BTC15MExecutor] bid failed`, orderResult.error);
                return;
            }

            const realPrice = 1 / Number(orderResult.takingAmount);
            const realShares = Number(orderResult.takingAmount);
            const postOrderCost = Date.now() - start;

            this.bidResults.push({
                type: strategyType,
                outcome: this.outcomes[outcomeIndex],
                price: realPrice,
                shares: realShares,
                timestamp: new Date().toISOString(),
                createOrderCost,
                postOrderCost,
            });

            const logString = `\n[BTC15MExecutor] ✅ Bid | Type: ${strategyType} | Outcome: ${this.outcomes[outcomeIndex]} | Price: ${realPrice} | Shares: ${realShares} | ${new Date().toISOString()} | CreateCost: ${createOrderCost}ms | PostCost: ${postOrderCost}ms`;
            console.log(logString);
        } catch (error) {
            console.error(`[BTC15MExecutor] bid failed`, error);
        }
    }

    private handleMarketLiveDataOpen() {
        console.log('MarketLiveDataConnection opened');
        const a = {
            action: 'subscribe',
            subscriptions:
                [
                    { topic: 'activity', type: 'orders_matched', filters: `{\"event_slug\":\"${this.market.slug}\"}` },
                    { topic: 'crypto_prices_chainlink', type: 'update', filters: `{\"symbol\":\"btc/usd\"}` }
                ],
        }
        this.marketLiveDataConnection.sendMessage(a);
    }

    private handleMarketLiveDataMessage(message: string) {
        const parsed = JSON.parse(message);
        if (!parsed) {
            return;
        }

        if (parsed.type === 'orders_matched') {

        }

        if (parsed.topic === 'crypto_prices_chainlink') {
            this.historyBTCPrices.unshift({
                timestamp: parsed.payload.timestamp,
                price: parsed.payload.value,
            });
        }

        return;
    }

    private getCurrentSlug(): string {
        const startTimestamp = this.getCurrentMarketSlugTimestamp();

        return `btc-updown-15m-${startTimestamp}`;
    }

    // 如果找不到 就用historyBTCPrices的最早的一个price作为BaseBTCPriceToBeat
    private async initializeThisMarketBaseBTCPriceToBeat() {
        try {
            const startTimestamp = this.getCurrentMarketSlugTimestamp();
            const startDate = new Date(startTimestamp * 1000).toISOString().slice(0, 19);

            const response = await Axios.get('https://data.chain.link/api/historical-timescale-stream-data?feedId=0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8&timeRange=1D');
            for (const node of response.data.data.mercuryHistory15MinMarkers.nodes) {
                if (node.timeBucket.startsWith(startDate)) {
                    this.baseBTCPriceToBeat = Number(formatUnits(node.open, 18));
                    this.historyBTCPrices.push({
                        timestamp: startTimestamp * 1000,
                        price: this.baseBTCPriceToBeat,
                    });

                    break;
                }
            }
        } catch (error) {
            console.error(`[BTC15MExecutor] initializeThisMarketBaseBTCPriceToBeat failed: ${error.message}`);
        }
    }

    private onBTCAggregatedPriceUpdate(data: { timestamp: number; price: number }) {
        const startTimestamp = this.getCurrentMarketSlugTimestamp();
        if (!this.historyBTCAggregatedPricesMap[startTimestamp]) {
            this.historyBTCAggregatedPricesMap[startTimestamp] = [];
        }

        this.historyBTCAggregatedPricesMap[startTimestamp].unshift(data);

        this.checkStrategysAndBid();
    }

    private async checkUSDEStopLoss() {
        try {
            if (!this.canBid) {
                return;
            }

            const usdeBalance = await this.polymarketApiService.getUSDEBalance(this.polymarketTrader.proxyAddress);
            if ((usdeBalance / 10 ** 6) < this.usdeStopLossLine) {
                this.canBid = false;
            }
        } catch (error) {
            console.error(`[BTC15MExecutor] checkUSDEStopLoss failed: ${error.message}`);
        }
    }

    private getCurrentMarketSlugTimestamp(): number {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const nextDiff = currentTimestamp % (15 * 60);
        return currentTimestamp - nextDiff;
    }

    /**
     * 获取当前周期的聚合BTC价格数组
     */
    public getCurrentAggregatedPrices(): { timestamp: number; price: number }[] | null {
        const startTimestamp = this.getCurrentMarketSlugTimestamp();
        return this.historyBTCAggregatedPricesMap[startTimestamp] || null;
    }

    private checkStrategysAndBid() {
        for (const strategy of this.strategys) {
            const [isTrigger, outcomeIndex] = strategy.checkSignal();
            if (isTrigger) {
                this.simulateBid(outcomeIndex, strategy.type);

                if (strategy.canBid && this.canBid && Date.now() > this.canBidStartDate.getTime()) {
                    this.bid(outcomeIndex, strategy.type);
                }
            }
        }
    }
}
