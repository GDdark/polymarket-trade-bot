import { IClampResult, IFullOrderBook, IPriceMap, IProcessedLevel } from "./interfaces";
import { getPrecisionFromTickSize } from "./utils";

/**
 * 订单簿构建器
 *
 * 核心功能：
 * 1. 从原始 Map 数据构建完整订单簿
 * 2. 计算 YES 和 NO 双边的最优价格
 * 3. 计算价差和中间价
 */
export class BookBuilder {
    /**
     * 构建订单簿
     * @param priceMap - 原始价格 Map（bids, asks）
     * @param tickSize - tick size，默认 0.01
     */
    static build(priceMap: IPriceMap, tickSize: number = 0.01): IFullOrderBook {
        const precision = getPrecisionFromTickSize(tickSize);

        // 排序：bids 按价格降序，asks 按价格升序
        const sortedBids = Array.from(priceMap.bids.entries()).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
        const sortedAsks = Array.from(priceMap.asks.entries()).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

        // 解析为 ProcessedLevel 数组
        const yesBids = this._parseSide(sortedBids);
        const yesAsks = this._parseSide(sortedAsks);

        // ⭐ 反转生成 NO 订单
        // YES 的 asks (卖单) -> NO 的 bids (买单)
        // YES 的 bids (买单) -> NO 的 asks (卖单)
        const noBids = this._invertSide(yesAsks, 'bid', precision);
        const noAsks = this._invertSide(yesBids, 'ask', precision);

        // 计算 YES 最优价格
        const yesBestAsk = this._clamp(yesAsks.length ? parseFloat(yesAsks[0].price) : null, precision);
        const yesBestBid = this._clamp(yesBids.length ? parseFloat(yesBids[0].price) : null, precision);

        // 计算 NO 最优价格
        const noBestAsk = this._clamp(noAsks.length ? parseFloat(noAsks[0].price) : null, precision);
        const noBestBid = this._clamp(noBids.length ? parseFloat(noBids[0].price) : null, precision);

        // 计算价差 (spread = bestAsk - bestBid)
        const yesSpread = this._clamp(
            yesBestAsk.valid && yesBestBid.valid ? Math.max(yesBestAsk.number! - yesBestBid.number!, 0) : null,
            precision,
        );

        // 计算中间价 (midpoint = (bestAsk + bestBid) / 2)
        const yesMidpoint = this._clamp(yesBestAsk.valid && yesBestBid.valid ? (yesBestAsk.number! + yesBestBid.number!) / 2 : null, precision);

        const noMidpoint = this._clamp(noBestAsk.valid && noBestBid.valid ? (noBestAsk.number! + noBestBid.number!) / 2 : null, precision);

        return {
            zero: {
                askArray: yesAsks,
                bidArray: yesBids,
                bestAsk: yesBestAsk.number,
                bestBid: yesBestBid.number,
                spread: yesSpread.number,
                midpoint: yesMidpoint.number,
            },
            one: {
                askArray: noAsks,
                bidArray: noBids,
                bestAsk: noBestAsk.number,
                bestBid: noBestBid.number,
                spread: yesSpread.number, // spread 相同
                midpoint: noMidpoint.number,
            },
            activeTickSize: tickSize,
        };
    }

    /**
     * 解析单边订单为 ProcessedLevel 数组
     */
    private static _parseSide(entries: [string, string][]): IProcessedLevel[] {
        let cumulativeSize = 0;
        let cumulativeValue = 0;

        return entries.map(([price, size]) => {
            const sizeNum = parseFloat(size);
            const value = parseFloat(price) * sizeNum;

            cumulativeSize += sizeNum;
            cumulativeValue += value;

            return {
                price: price,
                size: `${sizeNum}`,
                value: value.toFixed(2),
                netSize: cumulativeSize.toFixed(2),
                netValue: cumulativeValue.toFixed(2),
                includedLevels: [],
            };
        });
    }

    /**
     * 反转订单边
     * @param levels - 原始订单级别
     * @param targetSide - 目标边（'bid' 或 'ask'）
     * @param precision - 精度
     */
    private static _invertSide(levels: IProcessedLevel[], targetSide: 'bid' | 'ask', precision: number): IProcessedLevel[] {
        // 第一步：反转价格
        const inverted: IProcessedLevel[] = [];

        for (const level of levels) {
            const invertedPrice = this._invertPrice(level.price, precision);
            if (invertedPrice.valid) {
                inverted.push({
                    price: invertedPrice.string!,
                    size: level.size,
                    value: level.value,
                    netValue: level.netValue,
                    netSize: level.netSize,
                    includedLevels: [],
                });
            }
        }

        // 第二步：排序
        inverted.sort((a, b) => (targetSide === 'ask' ? parseFloat(a.price) - parseFloat(b.price) : parseFloat(b.price) - parseFloat(a.price)));

        // 第三步：重新计算累计值
        let cumulativeValue = 0;
        let cumulativeSize = 0;

        const result: IProcessedLevel[] = [];
        for (const { price, size, includedLevels } of inverted) {
            const priceNum = parseFloat(price);
            const sizeNum = parseFloat(size);
            const value = priceNum * sizeNum;

            cumulativeValue += value;
            cumulativeSize += sizeNum;

            result.push({
                price,
                size,
                value: value.toFixed(2),
                includedLevels,
                netValue: cumulativeValue.toFixed(2),
                netSize: cumulativeSize.toFixed(2),
            });
        }

        return result;
    }

    /**
     * ⭐ 价格反转核心公式
     * NO_price = 1 - YES_price
     */
    private static _invertPrice(price: string | null, precision: number): IClampResult {
        if (price === null) {
            return { valid: false, number: null, string: null };
        }

        const priceNum = parseFloat(price);
        if (!Number.isFinite(priceNum)) {
            return { valid: false, number: null, string: null };
        }

        // 核心公式: NO = 1 - YES
        return this._clamp(Math.max(1 - priceNum, 0), precision);
    }

    /**
     * 限制数值范围并格式化
     */
    private static _clamp(value: number | null, precision: number): IClampResult {
        if (value === null || !Number.isFinite(value)) {
            return { valid: false, number: null, string: null };
        }

        const str = value.toFixed(precision);
        return {
            valid: true,
            number: parseFloat(str),
            string: str,
        };
    }
}