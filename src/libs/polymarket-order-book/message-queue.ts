import { DeltaProcessor } from "./delta-processor";
import { IPriceMap, IProjectedOrderBook, IOrderLevel, IWsEvent, IWsLastTradePriceEvent, IWsTickSizeChangeEvent, IWsPriceChangeEvent, IWsBookEvent } from "./interfaces";
import { getPrecisionFromPrice } from "./utils";

/**
 * WebSocket 消息队列
 *
 * 功能：批量处理 WebSocket 消息
 */
export class MessageQueue {
    private queue: IWsEvent[] = [];

    /**
     * 入队
     */
    public push(events: IWsEvent | IWsEvent[]): void {
        if (Array.isArray(events)) {
            if (events.length) {
                this.queue.push(...events);
            }
            return;
        }
        if (events) {
            this.queue.push(events);
        }
    }

    /**
     * 检查是否为空
     */
    public isEmpty(): boolean {
        return this.queue.length === 0;
    }

    /**
     * 获取队列大小
     */
    public size(): number {
        return this.queue.length;
    }

    /**
     * 取出所有消息
     */
    public drain(): IWsEvent[] {
        if (!this.queue.length) return [];
        const events = this.queue;
        this.queue = [];
        return events;
    }

    /**
     * 按资产 ID 取出消息
     */
    public drainBy(filter: { type: 'asset'; ids: string[] }): IWsEvent[] {
        if (!this.queue.length) return [];

        const ids: string[] = [];
        if (filter.type === 'asset') {
            ids.push(...filter.ids);
        }

        const idSet = new Set(ids);
        const removing: IWsEvent[] = [];
        const remaining: IWsEvent[] = [];

        this.queue.forEach((event) => {
            if (idSet.has(event.assetId)) {
                removing.push(event);
            } else {
                remaining.push(event);
            }
        });

        this.queue = remaining;
        return removing;
    }

    /**
     * 处理队列中的所有消息
     */
    public process(context: {
        priceMaps: Record<string, IPriceMap>;
        assetLastBookTs: Map<string, number>;
        snapshotRequired: Set<string>;
        marketTickSizeByAsset: Map<string, number>;
        project: (
            assetId: string,
            type: 'book' | 'minified',
        ) => {
            status: string;
            data?: IProjectedOrderBook;
        };
    }): IWsEvent[] {
        const events = this.drain();
        if (!events.length) return [];

        // 按资产 ID 分组
        const grouped: Record<
            string,
            {
                snapshots: IWsEvent[];
                deltas: IWsPriceChangeEvent[];
                last: IWsLastTradePriceEvent[];
                ticks: IWsTickSizeChangeEvent[];
                minified: IWsBookEvent[];
            }
        > = {};

        events.forEach((event) => {
            if (!grouped[event.assetId]) {
                grouped[event.assetId] = {  
                    snapshots: [],
                    deltas: [],
                    last: [],
                    ticks: [],
                    minified: [],
                };
            }

            if (event.type === 'book') {
                // 检测 tick size
                const assetId = event.assetId;
                const currentTickSize = context.marketTickSizeByAsset.get(assetId) ?? 0.01;

                if (currentTickSize === 0.01) {
                    const hasSmallTick =
                        event.data.asks?.some((l: IOrderLevel) => getPrecisionFromPrice(l.price) === 3) ||
                        event.data.bids?.some((l: IOrderLevel) => getPrecisionFromPrice(l.price) === 3);

                    if (hasSmallTick) {
                        context.marketTickSizeByAsset.set(assetId, 0.001);
                    }
                }

                grouped[event.assetId].snapshots.push(event);
            } else if (event.type === 'price_change') {
                grouped[event.assetId].deltas.push(event);
            } else if (event.type === 'last-trade-price') {
                grouped[event.assetId].last.push(event);
            } else if (event.type === 'tick-size-change') {
                grouped[event.assetId].ticks.push(event);
            }
        });

        const results: any[] = [];

        // 处理每个资产
        Object.entries(grouped).forEach(([assetId, group]) => {
            let lastTs = context.assetLastBookTs.get(assetId) ?? 0;
            let hasUpdate = false;

            // 处理快照
            if (group.snapshots.length) {
                hasUpdate = true;
                group.snapshots.forEach((event) => {
                    context.priceMaps[assetId] = DeltaProcessor.snapshot(event.data).next;
                    context.snapshotRequired.add(assetId);
                    lastTs = Math.max(lastTs, event.ts);
                });
            }

            // 处理增量更新
            if (group.deltas.length) {
                hasUpdate = true;
                group.deltas.forEach((event) => {
                    if (event.ts <= lastTs) return;

                    const result = DeltaProcessor.delta(context.priceMaps[assetId], (event as IWsPriceChangeEvent).data);
                    context.priceMaps[assetId] = result.next;
                });
            }

            // 如果有更新，重新投影
            if (hasUpdate) {
                context.assetLastBookTs.set(assetId, lastTs);
                const projected = context.project(assetId, 'book');

                if (projected.status === 'success' && projected.data) {
                    results.push({
                        type: 'snapshot',
                        assetId,
                        data: projected.data,
                    });
                }
            }

            // 处理最后成交价
            group.last.forEach((event) => {
                const data = (event as IWsLastTradePriceEvent).data;
                results.push({
                    type: 'last-trade-price',
                    assetId,
                    price: data.price,
                    side: data.side,
                    ts: event.ts,
                });
            });

            // 处理 tick size 变化
            group.ticks.forEach((event) => {
                const data = (event as IWsTickSizeChangeEvent).data;
                results.push({
                    type: 'tick-size-change',
                    assetId,
                    origin: 'market',
                    newTickSize: parseFloat(data.new_tick_size),
                    ts: event.ts,
                });
            });

            // 处理 minified
            if (group.minified.length) {
                group.minified.forEach((event) => {
                    context.priceMaps[assetId] = DeltaProcessor.snapshot(event.data).next;
                });

                const projected = context.project(assetId, 'minified');
                if (projected.status === 'success' && projected.data) {
                    results.push({
                        type: 'minified',
                        assetId,
                        data: projected.data,
                    });
                }
            }
        });

        return results;
    }
}