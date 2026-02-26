import { IFullOrderBook, IProcessedLevel } from "./interfaces";
import { getPrecisionFromTickSize, getBucketForPrice } from "./utils";

/**
 * 订单簿聚合器
 *
 * 功能：
 * 1. 按用户选择的 tick size 聚合订单
 * 2. 将 YES 订单反转为 NO 订单
 */
export class Aggregator {
    /**
     * 聚合订单簿
     * @param book - 已构建的订单簿
     * @param targetTickSize - 目标 tick size（用户选择）
     * @param marketTickSize - 市场原始 tick size
     */
    public static aggregate(book: IFullOrderBook, targetTickSize: number, marketTickSize: number): IFullOrderBook {
        const targetPrecision = getPrecisionFromTickSize(marketTickSize);
        const sourcePrecision = getPrecisionFromTickSize(targetTickSize);

        // 复制原始数据
        const yesBids = [...(book.zero.bidArray || [])];
        const yesAsks = [...(book.zero.askArray || [])];

        // 聚合 YES 订单
        const aggregatedYesBids = this._aggregateSide(yesBids, 'desc', targetTickSize, 'bid');
        const aggregatedYesAsks = this._aggregateSide(yesAsks, 'asc', targetTickSize, 'ask');

        // 反转生成 NO 订单
        const noBids = this._invertSide(aggregatedYesBids, 'asc', sourcePrecision, targetPrecision);
        const noAsks = this._invertSide(aggregatedYesAsks, 'desc', sourcePrecision, targetPrecision);

        return {
            zero: {
                askArray: aggregatedYesAsks,
                bidArray: aggregatedYesBids,
                bestAsk: book.zero.bestAsk,
                bestBid: book.zero.bestBid,
                spread: book.zero.spread,
                midpoint: book.zero.midpoint,
            },
            one: {
                askArray: noBids,
                bidArray: noAsks,
                bestAsk: book.one.bestAsk,
                bestBid: book.one.bestBid,
                spread: book.one.spread,
                midpoint: book.one.midpoint,
            },
            activeTickSize: targetTickSize,
        };
    }

    /**
     * 聚合单边订单
     * @param levels - 订单级别数组
     * @param sortOrder - 排序方向
     * @param tickSize - tick size
     * @param side - 买/卖方向
     */
    private static _aggregateSide(levels: IProcessedLevel[], sortOrder: 'asc' | 'desc', tickSize: number, side: 'bid' | 'ask'): IProcessedLevel[] {
        const buckets = new Map<
            string,
            {
                price: string;
                size: number;
                value: number;
                includedLevels: string[];
            }
        >();

        // 按桶聚合
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const bucket = getBucketForPrice(level.price, side === 'bid' ? 'bid' : 'ask', tickSize, tickSize);

            const existing = buckets.get(bucket) || {
                price: bucket,
                size: 0,
                value: 0,
                includedLevels: [],
            };

            existing.size += parseFloat(level.size);
            existing.value += parseFloat(level.value);
            existing.includedLevels.push(level.price);
            buckets.set(bucket, existing);
        }

        // 转换为数组并排序
        let result = Array.from(buckets.values()).map((b) => ({
            price: b.price,
            size: `${b.size}`,
            value: b.value.toFixed(2),
            netSize: '0',
            netValue: '0',
            includedLevels: b.includedLevels,
        }));

        result.sort((a, b) => (sortOrder === 'asc' ? parseFloat(a.price) - parseFloat(b.price) : parseFloat(b.price) - parseFloat(a.price)));

        // 计算累计值
        let cumulativeSize = 0;
        let cumulativeValue = 0;

        for (let i = 0; i < result.length; i++) {
            const size = parseFloat(result[i].size);
            const value = parseFloat(result[i].value);
            cumulativeSize += size;
            cumulativeValue += value;
            result[i].netSize = cumulativeSize.toFixed(2);
            result[i].netValue = cumulativeValue.toFixed(2);
        }

        return result;
    }

    /**
     * 反转订单边（YES -> NO）
     *
     * 核心逻辑：
     * - YES 的 Bid (买单) 反转为 NO 的 Ask (卖单)
     * - YES 的 Ask (卖单) 反转为 NO 的 Bid (买单)
     * - 价格反转: NO_price = 1 - YES_price
     */
    private static _invertSide(
        levels: IProcessedLevel[],
        sortOrder: 'asc' | 'desc',
        sourcePrecision: number,
        targetPrecision: number,
    ): IProcessedLevel[] {
        const minPrice = 10 ** -sourcePrecision;
        const buckets = new Map<
            string,
            {
                price: string;
                size: number;
                value: number;
                includedLevels: string[];
            }
        >();

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const { _price: invertedPriceNum, price: invertedPrice } = this._invertPrice(level.price, sourcePrecision, minPrice);

            const existing = buckets.get(invertedPrice) || {
                price: invertedPrice,
                size: 0,
                value: 0,
                includedLevels: [],
            };

            existing.size += parseFloat(level.size);
            existing.value += invertedPriceNum * parseFloat(level.size);
            existing.includedLevels.push(...level.includedLevels.map((p) => this._invertPrice(p, targetPrecision).price));
            buckets.set(invertedPrice, existing);
        }

        // 转换为数组并排序
        let result = Array.from(buckets.values())
            .map((b) => ({
                price: b.price,
                size: `${b.size}`,
                value: b.value.toFixed(2),
                netSize: '0',
                netValue: '0',
                includedLevels: b.includedLevels,
            }))
            .sort((a, b) => (sortOrder === 'asc' ? parseFloat(a.price) - parseFloat(b.price) : parseFloat(b.price) - parseFloat(a.price)));

        // 计算累计值
        let cumulativeSize = 0;
        let cumulativeValue = 0;

        for (let i = 0; i < result.length; i++) {
            const size = parseFloat(result[i].size);
            const value = parseFloat(result[i].value);
            cumulativeSize += size;
            cumulativeValue += value;
            result[i].netSize = cumulativeSize.toFixed(2);
            result[i].netValue = cumulativeValue.toFixed(2);
        }

        return result;
    }

    /**
     * ⭐ 价格反转核心公式
     * NO_price = 1 - YES_price
     *
     * @param price - 原始价格字符串
     * @param precision - 精度
     * @param minPrice - 最小价格（可选）
     */
    private static _invertPrice(price: string, precision: number, minPrice?: number): { _price: number; price: string } {
        const inverted = 1 - parseFloat(price || '0');
        const min = minPrice ?? 10 ** -precision;

        // 限制在 [min, 1-min] 范围内
        const clamped = Math.min(1 - min, Math.max(min, inverted));

        return {
            _price: clamped,
            price: clamped.toFixed(precision),
        };
    }
}