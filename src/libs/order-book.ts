import { AggTradePayload, DepthLevel } from '../common/interfaces';

export class OrderBook {
    private bids: Map<string, string> = new Map();
    private asks: Map<string, string> = new Map();

    /** depth 批量更新：qty=0 删除，否则覆盖 */
    public applyDepthUpdate(newBids: DepthLevel[], newAsks: DepthLevel[]): void {
        this.mergeSide(this.bids, newBids);
        this.mergeSide(this.asks, newAsks);
    }

    /** aggTrade 实时扣减：m=true 扣 bid，m=false 扣 ask */
    public applyAggTrade(trade: AggTradePayload): void {
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

    /** 获取排序后的快照：bids 降序，asks 升序 */
    public getSnapshot(): { bids: DepthLevel[]; asks: DepthLevel[] } {
        const bids = this.toSortedArray(this.bids, 'desc');
        const asks = this.toSortedArray(this.asks, 'asc');
        return { bids, asks };
    }

    public getBestBid(): DepthLevel | null {
        let bestPrice = -Infinity;
        let best: DepthLevel | null = null;
        for (const [price, qty] of this.bids) {
            const p = parseFloat(price);
            if (p > bestPrice) {
                bestPrice = p;
                best = [price, qty];
            }
        }
        return best;
    }

    public getBestAsk(): DepthLevel | null {
        let bestPrice = Infinity;
        let best: DepthLevel | null = null;
        for (const [price, qty] of this.asks) {
            const p = parseFloat(price);
            if (p < bestPrice) {
                bestPrice = p;
                best = [price, qty];
            }
        }
        return best;
    }

    public getSpread(): number | null {
        const bestBid = this.getBestBid();
        const bestAsk = this.getBestAsk();
        if (!bestBid || !bestAsk) return null;
        return parseFloat(bestAsk[0]) - parseFloat(bestBid[0]);
    }

    public getMidPrice(): number | null {
        const bestBid = this.getBestBid();
        const bestAsk = this.getBestAsk();
        if (!bestBid || !bestAsk) return null;
        return (parseFloat(bestBid[0]) + parseFloat(bestAsk[0])) / 2;
    }

    public get bidCount(): number {
        return this.bids.size;
    }

    public get askCount(): number {
        return this.asks.size;
    }

    public clear(): void {
        this.bids.clear();
        this.asks.clear();
    }

    private mergeSide(side: Map<string, string>, updates: DepthLevel[]): void {
        for (const [price, qty] of updates) {
            if (parseFloat(qty) === 0) {
                side.delete(price);
            } else {
                side.set(price, qty);
            }
        }
    }

    private toSortedArray(side: Map<string, string>, order: 'asc' | 'desc'): DepthLevel[] {
        const result: DepthLevel[] = Array.from(side, ([p, q]) => [p, q]);
        result.sort((a, b) =>
            order === 'desc'
                ? parseFloat(b[0]) - parseFloat(a[0])
                : parseFloat(a[0]) - parseFloat(b[0]),
        );
        return result;
    }
}
