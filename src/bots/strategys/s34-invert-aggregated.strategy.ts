import { BaseStrategy, StrategyType } from "./base.strategy";

// ========== 策略34: 基于聚合BTC价格的方向反转策略 ==========
// 与S31相同逻辑，但使用多交易所聚合的BTC价格而非Polymarket的BTC价格
export class S34InvertAggregatedStrategy extends BaseStrategy {
    public readonly type: StrategyType = StrategyType.S34_INVERT_AGGREGATED;
    
    private hasTriggered: boolean = false;
    private prevDeviation: number | null = null;
    private readonly CHANGE_THRESHOLD = 20;  // BTC偏移变化阈值 $20

    public checkSignal(): [boolean, number] {
        if (this.hasTriggered) {
            return [false, -1];
        }

        const aggregatedPrices = this.btc15mExecutor.getCurrentAggregatedPrices();
        if (!aggregatedPrices || aggregatedPrices.length < 2) {
            return [false, -1];
        }

        const prices = this.btc15mExecutor.latestMarketPrices;
        const outcome0 = this.btc15mExecutor.outcomes[0];
        const outcome0Price = prices[outcome0];
        const outcome1 = this.btc15mExecutor.outcomes[1];
        const outcome1Price = prices[outcome1];

        // 基准价格是最早的聚合BTC价格（周期开始时的价格）
        const baselinePrice = aggregatedPrices[aggregatedPrices.length - 1].price;
        const currentBtcPrice = aggregatedPrices[0].price;
        const currentDeviation = currentBtcPrice - baselinePrice;  // 正=涨，负=跌

        // 检查偏移变化和方向反转
        if (this.prevDeviation !== null) {
            const deviationChange = Math.abs(currentDeviation - this.prevDeviation);
            // 方向反转：正变负 或 负变正
            const directionChanged = (this.prevDeviation > 0 && currentDeviation < 0) ||
                (this.prevDeviation < 0 && currentDeviation > 0);

            if (deviationChange >= this.CHANGE_THRESHOLD && directionChanged) {
                this.hasTriggered = true;
                // 买反转后的方向：currentDeviation > 0 → UP, currentDeviation < 0 → DOWN
                const bidDirection = currentDeviation > 0 ? 'UP' : 'DOWN';
                const outcomeIndex = this.btc15mExecutor.outcomes.findIndex(
                    outcome => outcome.toLowerCase() === bidDirection.toLowerCase()
                );
                const bidPrice = bidDirection === 'UP' ? outcome0Price : outcome1Price;

                const logString = `\n[S34] 🔄 聚合价格方向反转触发\n` +
                    `偏移变化: $${this.prevDeviation.toFixed(2)} → $${currentDeviation.toFixed(2)} (变化$${deviationChange.toFixed(2)})\n` +
                    `买入方向: ${bidDirection} @ ${(bidPrice * 100).toFixed(2)}%\n`;
                console.log(logString);

                return [true, outcomeIndex];
            }
        }

        // 更新上一次偏移值
        this.prevDeviation = currentDeviation;

        return [false, -1];
    }
}
