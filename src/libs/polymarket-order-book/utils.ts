import { OrderSummary, OrderType } from "@polymarket/clob-client";

/**
 * 从价格字符串获取精度
 * @example getPrecisionFromPrice("0.55") => 2
 * @example getPrecisionFromPrice("0.551") => 3
 */
export function getPrecisionFromPrice(price: string): number {
    const decimalIndex = price.indexOf('.');
    if (decimalIndex === -1) return 0;
    return price.length - decimalIndex - 1;
}

/**
 * 从 tick size 获取精度（小数位数）
 * @example getPrecisionFromTickSize(0.01) => 2
 * @example getPrecisionFromTickSize(0.001) => 3
 */
export function getPrecisionFromTickSize(tickSize: number): number {
    if (tickSize >= 1) return 0;
    const str = tickSize.toString();
    const decimalIndex = str.indexOf('.');
    if (decimalIndex === -1) return 0;
    return str.length - decimalIndex - 1;
}

/**
 * 获取价格所属的桶（用于聚合）
 */
export function getBucketForPrice(price: string, side: 'bid' | 'ask', tickSize: number, _unused: number): string {
    const priceNum = parseFloat(price);
    const precision = getPrecisionFromTickSize(tickSize);

    if (side === 'bid') {
        // 买单向下取整
        const bucket = Math.floor(priceNum / tickSize) * tickSize;
        return bucket.toFixed(precision);
    } else {
        // 卖单向上取整
        const bucket = Math.ceil(priceNum / tickSize) * tickSize;
        return bucket.toFixed(precision);
    }
}

/**
 * calculateBuyMarketPrice calculates the market price to buy a $$ amount
 * @param positions
 * @param amountToMatch worth to buy
 * @returns
 */
export const calculateBuyMarketPrice = (
    positions: OrderSummary[],
    amountToMatch: number,
    orderType: OrderType,
) => {
    if (!positions.length) {
        throw new Error("no match");
    }
    let sum = 0;
    /*
    Asks:
    [
        { price: '0.6', size: '100' },
        { price: '0.55', size: '100' },
        { price: '0.5', size: '100' }
    ]
    So, if the amount to match is $150 that will be reached at first position so price will be 0.6
    */
    for (let i = positions.length - 1; i >= 0; i--) {
        const p = positions[i];
        sum += parseFloat(p.size) * parseFloat(p.price);
        if (sum >= amountToMatch) {
            return parseFloat(p.price);
        }
    }
    if (orderType === OrderType.FOK) {
        throw new Error("no match");
    }
    return parseFloat(positions[0].price);
};