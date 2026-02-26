import { BaseStrategy, StrategyType } from "./base.strategy";

// ========== 策略35: 基于聚合BTC价格的均值回归 ==========
// 与S27相同逻辑，但使用多交易所聚合的BTC价格
export class S35MeanReversionAggregatedStrategy extends BaseStrategy {
    public readonly type: StrategyType = StrategyType.S35_MEAN_REVERSION_AGGREGATED;
    
    private hasTriggered: boolean = false;
    private peakReached: boolean = false;
    private trendDir: 'UP' | 'DOWN' | null = null;
    
    private readonly PEAK_THRESHOLD = 30;      // BTC偏移达到$30
    private readonly REVERT_THRESHOLD = 10;    // 回落到$10以内
    private readonly MIN_DELAY_MS = 60 * 1000; // 周期开始1分钟后才触发

    public checkSignal(): [boolean, number] {
        if (this.hasTriggered) {
            return [false, -1];
        }

        const aggregatedPrices = this.btc15mExecutor.getCurrentAggregatedPrices();
        if (!aggregatedPrices || aggregatedPrices.length < 2) {
            return [false, -1];
        }

        // 检查是否已过周期开始1分钟
        const cycleStartTime = aggregatedPrices[aggregatedPrices.length - 1].timestamp;
        const currentTime = aggregatedPrices[0].timestamp;
        if (currentTime - cycleStartTime < this.MIN_DELAY_MS) {
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
        const deviation = currentBtcPrice - baselinePrice;

        // 检查是否达到峰值
        if (!this.peakReached && Math.abs(deviation) >= this.PEAK_THRESHOLD) {
            this.peakReached = true;
            this.trendDir = deviation > 0 ? 'UP' : 'DOWN';
        }

        // 达到峰值后，检查是否回落到$10以内（绝对值）
        if (this.peakReached && this.trendDir !== null) {
            if (Math.abs(deviation) < this.REVERT_THRESHOLD) {
                this.hasTriggered = true;
                // 买反向（均值回归）
                const bidDirection = this.trendDir === 'UP' ? 'DOWN' : 'UP';
                const outcomeIndex = this.btc15mExecutor.outcomes.findIndex(
                    outcome => outcome.toLowerCase() === bidDirection.toLowerCase()
                );
                const bidPrice = bidDirection === 'UP' ? outcome0Price : outcome1Price;

                const logString = `\n[S35] 📉 均值回归触发 (聚合价格)\n` +
                    `趋势方向: ${this.trendDir} → 回落到$${Math.abs(deviation).toFixed(2)}\n` +
                    `买入方向: ${bidDirection} @ ${(bidPrice * 100).toFixed(2)}%\n`;
                console.log(logString);

                return [true, outcomeIndex];
            }
        }

        return [false, -1];
    }
}
