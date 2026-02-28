import * as fs from 'fs';
import * as path from 'path';
import { OrderBook } from '../../src/libs/order-book';
import { AggTradePayload, BinanceStreamMessage, DepthUpdatePayload } from '../../src/common/interfaces';

const MESSAGES_PATH = path.join(__dirname, 'binance-market-stream-messages.json');

function loadMessages(): string[] {
    const raw = fs.readFileSync(MESSAGES_PATH, 'utf-8');
    return JSON.parse(raw);
}

describe('OrderBook', () => {
    let messages: string[];

    beforeAll(() => {
        messages = loadMessages();
    });

    it('replay 全部消息后 bids 和 asks 不为空', () => {
        const ob = new OrderBook();

        for (const raw of messages) {
            const parsed: BinanceStreamMessage = JSON.parse(raw);
            if (!parsed.stream) continue;

            if (parsed.stream.includes('aggTrade')) {
                ob.applyAggTrade(parsed.data as AggTradePayload);
            } else if (parsed.stream.includes('depth')) {
                const depth = parsed.data as DepthUpdatePayload;
                ob.applyDepthUpdate(depth.b, depth.a);
            }
        }

        expect(ob.bidCount).toBeGreaterThan(0);
        expect(ob.askCount).toBeGreaterThan(0);
    });

    it('bids 降序排列，asks 升序排列', () => {
        const ob = new OrderBook();

        for (const raw of messages) {
            const parsed: BinanceStreamMessage = JSON.parse(raw);
            if (!parsed.stream) continue;

            if (parsed.stream.includes('aggTrade')) {
                ob.applyAggTrade(parsed.data as AggTradePayload);
            } else if (parsed.stream.includes('depth')) {
                const depth = parsed.data as DepthUpdatePayload;
                ob.applyDepthUpdate(depth.b, depth.a);
            }
        }

        const { bids, asks } = ob.getSnapshot();

        for (let i = 1; i < bids.length; i++) {
            expect(parseFloat(bids[i - 1][0])).toBeGreaterThanOrEqual(parseFloat(bids[i][0]));
        }
        for (let i = 1; i < asks.length; i++) {
            expect(parseFloat(asks[i - 1][0])).toBeLessThanOrEqual(parseFloat(asks[i][0]));
        }
    });

    it('best bid < best ask（无交叉）', () => {
        const ob = new OrderBook();

        for (const raw of messages) {
            const parsed: BinanceStreamMessage = JSON.parse(raw);
            if (!parsed.stream) continue;

            if (parsed.stream.includes('aggTrade')) {
                ob.applyAggTrade(parsed.data as AggTradePayload);
            } else if (parsed.stream.includes('depth')) {
                const depth = parsed.data as DepthUpdatePayload;
                ob.applyDepthUpdate(depth.b, depth.a);
            }
        }

        const bestBid = ob.getBestBid();
        const bestAsk = ob.getBestAsk();
        expect(bestBid).not.toBeNull();
        expect(bestAsk).not.toBeNull();
        expect(parseFloat(bestBid![0])).toBeLessThan(parseFloat(bestAsk![0]));
    });

    it('spread 和 midPrice 合理', () => {
        const ob = new OrderBook();

        for (const raw of messages) {
            const parsed: BinanceStreamMessage = JSON.parse(raw);
            if (!parsed.stream) continue;

            if (parsed.stream.includes('aggTrade')) {
                ob.applyAggTrade(parsed.data as AggTradePayload);
            } else if (parsed.stream.includes('depth')) {
                const depth = parsed.data as DepthUpdatePayload;
                ob.applyDepthUpdate(depth.b, depth.a);
            }
        }

        const spread = ob.getSpread();
        const midPrice = ob.getMidPrice();
        const bestBid = ob.getBestBid();
        const bestAsk = ob.getBestAsk();

        expect(spread).not.toBeNull();
        expect(spread!).toBeGreaterThan(0);

        expect(midPrice).not.toBeNull();
        expect(midPrice!).toBeGreaterThan(parseFloat(bestBid![0]));
        expect(midPrice!).toBeLessThan(parseFloat(bestAsk![0]));
    });

    it('qty=0 的价位会被移除', () => {
        const ob = new OrderBook();

        ob.applyDepthUpdate(
            [['100.00', '1.00'], ['200.00', '2.00']],
            [['300.00', '3.00']],
        );
        expect(ob.bidCount).toBe(2);

        ob.applyDepthUpdate(
            [['100.00', '0']],
            [],
        );
        expect(ob.bidCount).toBe(1);
        expect(ob.getBestBid()![0]).toBe('200.00');
    });

    it('aggTrade 扣减数量：m=true 扣 bid，m=false 扣 ask', () => {
        const ob = new OrderBook();

        ob.applyDepthUpdate(
            [['100.00', '5.00000000']],
            [['200.00', '3.00000000']],
        );

        ob.applyAggTrade({
            e: 'aggTrade', E: 0, s: 'BTCUSDT', a: 0,
            p: '100.00', q: '2.00000000',
            f: 0, l: 0, T: 0, m: true,
        });
        expect(ob.getBestBid()![1]).toBe('3.00000000');

        ob.applyAggTrade({
            e: 'aggTrade', E: 0, s: 'BTCUSDT', a: 0,
            p: '200.00', q: '1.50000000',
            f: 0, l: 0, T: 0, m: false,
        });
        expect(ob.getBestAsk()![1]).toBe('1.50000000');
    });

    it('aggTrade 扣减至 0 时移除价位', () => {
        const ob = new OrderBook();

        ob.applyDepthUpdate(
            [['100.00', '1.00000000']],
            [],
        );

        ob.applyAggTrade({
            e: 'aggTrade', E: 0, s: 'BTCUSDT', a: 0,
            p: '100.00', q: '1.00000000',
            f: 0, l: 0, T: 0, m: true,
        });
        expect(ob.bidCount).toBe(0);
        expect(ob.getBestBid()).toBeNull();
    });

    it('clear 清空订单簿', () => {
        const ob = new OrderBook();

        ob.applyDepthUpdate(
            [['100.00', '1.00']],
            [['200.00', '2.00']],
        );
        expect(ob.bidCount).toBe(1);
        expect(ob.askCount).toBe(1);

        ob.clear();
        expect(ob.bidCount).toBe(0);
        expect(ob.askCount).toBe(0);
    });
});
