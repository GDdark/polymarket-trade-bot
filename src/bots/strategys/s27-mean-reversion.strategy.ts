import { BaseStrategy, StrategyType } from "./base.strategy";

// ========== 策略27: BTC偏移$30后回落到$10以内，买反向（均值回归） ==========
// 使用Polymarket的BTC价格
export class S27MeanReversionStrategy extends BaseStrategy {
    public readonly type: StrategyType = StrategyType.S27_MEAN_REVERSION;
    
    private hasTriggered: boolean = false;
    private peakReached: boolean = false;
    private trendDir: 'UP' | 'DOWN' | null = null;
    
    private readonly PEAK_THRESHOLD = 30;      // BTC偏移达到$30
    private readonly REVERT_THRESHOLD = 10;    // 回落到$10以内

    public checkSignal(): [boolean, number] {
        if (this.hasTriggered) {
            return [false, -1];
        }

        const historyBTCPrices = this.btc15mExecutor.historyBTCPrices;
        if (historyBTCPrices.length < 2) {
            return [false, -1];
        }

        const prices = this.btc15mExecutor.latestMarketPrices;
        const outcome0 = this.btc15mExecutor.outcomes[0];
        const outcome0Price = prices[outcome0];
        const outcome1 = this.btc15mExecutor.outcomes[1];
        const outcome1Price = prices[outcome1];

        // 基准价格是最早的BTC价格（周期开始时的价格）
        const baselinePrice = historyBTCPrices[historyBTCPrices.length - 1].price;
        const currentBtcPrice = historyBTCPrices[0].price;
        const deviation = currentBtcPrice - baselinePrice;

        // 检查是否达到峰值
        if (!this.peakReached && Math.abs(deviation) >= this.PEAK_THRESHOLD) {
            this.peakReached = true;
            this.trendDir = deviation > 0 ? 'UP' : 'DOWN';
        }

        // 达到峰值后，检查是否回落到$10以内
        if (this.peakReached && this.trendDir !== null) {
            if (Math.abs(deviation) < this.REVERT_THRESHOLD) {
                this.hasTriggered = true;
                // 买反向（均值回归）
                const bidDirection = this.trendDir === 'UP' ? 'DOWN' : 'UP';
                const outcomeIndex = this.btc15mExecutor.outcomes.findIndex(
                    outcome => outcome.toLowerCase() === bidDirection.toLowerCase()
                );
                const bidPrice = bidDirection === 'UP' ? outcome0Price : outcome1Price;

                const logString = `\n[S27] 📉 均值回归触发 (PM价格)\n` +
                    `趋势方向: ${this.trendDir} → 回落到$${Math.abs(deviation).toFixed(2)}\n` +
                    `买入方向: ${bidDirection} @ ${(bidPrice * 100).toFixed(2)}%\n`;
                console.log(logString);

                return [true, outcomeIndex];
            }
        }

        return [false, -1];
    }
}
