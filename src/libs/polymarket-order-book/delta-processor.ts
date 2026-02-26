import { IOrderLevel, IPriceMap } from "./interfaces";

/**
 * 增量更新处理器
 *
 * 功能：处理 WebSocket 的增量更新消息
 */
export class DeltaProcessor {
    /**
     * 处理增量更新
     * @param current - 当前价格 Map
     * @param delta - 增量数据
     */
    public static delta(
        current: IPriceMap,
        delta: { price_changes: Array<{ price: string; size: string; side?: string }> },
    ): { next: IPriceMap; changed: Set<string> } {
        const next = this._clone(current);
        const changed = new Set<string>();

        delta.price_changes.forEach((change) => {
            const isRemoval = parseFloat(change.size) === 0;
            const isBuy = change.side?.toUpperCase?.() === 'BUY';

            if (isBuy) {
                if (isRemoval) {
                    next.bids.delete(change.price);
                } else {
                    next.bids.set(change.price, change.size);
                }
            } else {
                if (isRemoval) {
                    next.asks.delete(change.price);
                } else {
                    next.asks.set(change.price, change.size);
                }
            }

            changed.add(change.price);
        });

        return { next, changed };
    }

    /**
     * 处理订单簿快照
     * @param snapshot - 快照数据
     */
    public static snapshot(snapshot: { bids?: IOrderLevel[]; asks?: IOrderLevel[] }): { next: IPriceMap; changed: Set<string> } {
        const next: IPriceMap = {
            bids: new Map(),
            asks: new Map(),
        };

        // 处理 bids
        for (let i = 0; i < (snapshot.bids?.length ?? 0); i++) {
            const level = snapshot.bids![i];
            next.bids.set(level.price, level.size);
        }

        // 处理 asks
        for (let i = 0; i < (snapshot.asks?.length ?? 0); i++) {
            const level = snapshot.asks![i];
            next.asks.set(level.price, level.size);
        }

        // 记录所有变化的价格
        const changed = new Set<string>();
        next.bids.forEach((_, price) => changed.add(price));
        next.asks.forEach((_, price) => changed.add(price));

        return { next, changed };
    }

    /**
     * 克隆价格 Map
     */
    private static _clone(priceMap: IPriceMap): IPriceMap {
        return {
            bids: priceMap?.bids ? new Map(priceMap.bids) : new Map(),
            asks: priceMap?.asks ? new Map(priceMap.asks) : new Map(),
        };
    }
}