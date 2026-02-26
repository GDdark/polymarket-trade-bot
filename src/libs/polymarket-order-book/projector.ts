import { IFullOrderBook, IProjectedOrderBook, IProjectedSide, IProcessedLevel, IProjectedSideData } from "./interfaces";
import { getPrecisionFromTickSize } from "./utils";

/**
 * 订单簿投影器
 *
 * 功能：将内部订单簿数据转换为 UI 显示格式
 */
export class Projector {
    /**
     * 投影订单簿
     * @param book - 完整订单簿
     * @param options - 选项
     */
    public static project(
        book: IFullOrderBook,
        options: {
            tickSize?: number;
            minified?: boolean;
            ts?: number;
        } = {},
    ): IProjectedOrderBook {
        const tickSize = options.tickSize ?? book.activeTickSize ?? 0.01;

        // 处理 YES 订单
        const yesAsks = this._processSide(
            book.zero.askArray,
            options.minified ? (rows) => rows.slice(0, Math.max(5, 10 - book.zero.bidArray.length)) : undefined,
        );
        const yesBids = this._processSide(
            book.zero.bidArray,
            options.minified ? (rows) => rows.slice(0, Math.max(5, 10 - yesAsks.rows.length)) : undefined,
        );

        // 处理 NO 订单
        const noAsks = this._processSide(
            book.one.askArray,
            options.minified ? (rows) => rows.slice(0, Math.max(5, 10 - book.one.bidArray.length)) : undefined,
        );
        const noBids = this._processSide(
            book.one.bidArray,
            options.minified ? (rows) => rows.slice(0, Math.max(5, 10 - noAsks.rows.length)) : undefined,
        );

        const yesSide: IProjectedSide = {
            asks: yesAsks,
            bids: yesBids,
            spread: book.zero.spread,
            midpoint: book.zero.midpoint,
            totalBidCount: book.zero.bidArray.length,
            totalAskCount: book.zero.askArray.length,
        };

        const noSide: IProjectedSide = {
            asks: noAsks,
            bids: noBids,
            spread: book.one.spread,
            midpoint: book.one.midpoint,
            totalBidCount: book.one.bidArray.length,
            totalAskCount: book.one.askArray.length,
        };

        const precision = getPrecisionFromTickSize(tickSize);

        return {
            tickSize,
            zero: yesSide,
            one: noSide,
            bestPrices: {
                '~zero': {
                    buy: book.zero.bestAsk !== null ? book.zero.bestAsk.toFixed(precision) : null,
                    sell: book.zero.bestBid !== null ? book.zero.bestBid.toFixed(precision) : null,
                },
                '~one': {
                    buy: book.one.bestAsk !== null ? book.one.bestAsk.toFixed(precision) : null,
                    sell: book.one.bestBid !== null ? book.one.bestBid.toFixed(precision) : null,
                },
            },
            ts: options.ts ?? Date.now(),
        };
    }

    /**
     * 处理单边订单数据
     */
    private static _processSide(levels: IProcessedLevel[], filter: (rows: IProcessedLevel[]) => IProcessedLevel[] = (rows) => rows): IProjectedSideData {
        const rows: any[] = [];
        let cumulativeSize = 0;
        let cumulativeValue = 0;

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const size = this._parseNumber(level.size);
            const value = this._parseNumber(level.value);

            cumulativeSize += size;
            cumulativeValue += value;

            rows.push({
                price: level.price,
                size,
                value,
                netSize: cumulativeSize,
                netValue: cumulativeValue,
                includedLevels: level.includedLevels,
            });
        }

        const bestPrice = levels[0]?.price;
        const totalSize = rows.length ? rows[rows.length - 1].netSize : 0;
        const totalValue = rows.length ? rows[rows.length - 1].netValue : 0;

        return {
            rows: filter(rows),
            bestPrice,
            hasLiquidity: rows.length > 0,
            totalSize,
            totalValue,
        };
    }

    /**
     * 安全解析数字
     */
    private static _parseNumber(value: string | number): number {
        const num = parseFloat((value as string) || '0');
        return Number.isFinite(num) ? num : 0;
    }
}