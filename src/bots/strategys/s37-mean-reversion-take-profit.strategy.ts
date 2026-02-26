import { BaseStrategy, StrategyType } from "./base.strategy";

// ========== 策略37: S36 + 1-10分钟时间窗口 + 止盈/止损 ==========
// 基于S36，但只在周期1-10分钟内触发
// 止盈: 价格涨0.1卖出
// 止损: BTC聚合价格跌破买入时价格卖出（需要在executor中额外实现）
export class S37MeanReversionTakeProfitStrategy extends BaseStrategy {
    public readonly type: StrategyType = StrategyType.S37_MEAN_REVERSION_TAKE_PROFIT;
    
    private hasTriggered: boolean = false;
    private peakReached: boolean = false;
    private trendDir: 'UP' | 'DOWN' | null = null;
    
    private readonly PEAK_THRESHOLD = 30;      // BTC偏移达到$30
    private readonly REVERT_THRESHOLD = 10;    // 回落阈值
    private readonly MIN_DELAY_MS = 1 * 60 * 1000;  // 1分钟后开始
    private readonly MAX_DELAY_MS = 10 * 60 * 1000; // 10分钟前截止
    public readonly TAKE_PROFIT = 0.1;         // 止盈阈值（公开给executor用）
    
    // 买入时的状态（供止损检查使用）
    public buyBtcPrice: number | null = null;  // 买入时的BTC聚合价格
    public buyDirection: 'UP' | 'DOWN' | null = null;  // 买入方向

    public checkSignal(): [boolean, number] {
        if (this.hasTriggered) {
            return [false, -1];
        }

        const aggregatedPrices = this.btc15mExecutor.getCurrentAggregatedPrices();
        if (!aggregatedPrices || aggregatedPrices.length < 2) {
            return [false, -1];
        }

        // 检查是否在1-10分钟时间窗口内
        const cycleStartTime = aggregatedPrices[aggregatedPrices.length - 1].timestamp;
        const currentTime = aggregatedPrices[0].timestamp;
        const timeFromStart = currentTime - cycleStartTime;
        
        if (timeFromStart < this.MIN_DELAY_MS || timeFromStart > this.MAX_DELAY_MS) {
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

        // 达到峰值后，检查是否回落
        if (this.peakReached && this.trendDir !== null) {
            let canTrigger = false;
            if (this.trendDir === 'UP' && deviation < this.REVERT_THRESHOLD) {
                canTrigger = true;
            } else if (this.trendDir === 'DOWN' && deviation > -this.REVERT_THRESHOLD) {
                canTrigger = true;
            }

            if (canTrigger) {
                this.hasTriggered = true;
                // 买反向（均值回归）
                const bidDirection = this.trendDir === 'UP' ? 'DOWN' : 'UP';
                const outcomeIndex = this.btc15mExecutor.outcomes.findIndex(
                    outcome => outcome.toLowerCase() === bidDirection.toLowerCase()
                );
                const bidPrice = bidDirection === 'UP' ? outcome0Price : outcome1Price;

                // 记录买入时的状态（供止损检查使用）
                this.buyBtcPrice = currentBtcPrice;
                this.buyDirection = bidDirection;

                const logString = `\n[S37] 📉 均值回归触发 (1-10分钟+止盈/止损)\n` +
                    `趋势方向: ${this.trendDir} → 回落到$${deviation.toFixed(2)}\n` +
                    `买入方向: ${bidDirection} @ ${(bidPrice * 100).toFixed(2)}%\n` +
                    `止盈目标: ${((bidPrice + this.TAKE_PROFIT) * 100).toFixed(2)}%\n` +
                    `止损条件: BTC ${bidDirection === 'UP' ? '跌破' : '涨破'} $${currentBtcPrice.toFixed(2)}\n`;
                console.log(logString);

                return [true, outcomeIndex];
            }
        }

        return [false, -1];
    }

    // 检查止损条件：BTC价格是否跌破买入时的价格
    public checkStopLoss(): boolean {
        if (this.buyBtcPrice === null || this.buyDirection === null) {
            return false;
        }

        const aggregatedPrices = this.btc15mExecutor.getCurrentAggregatedPrices();
        if (!aggregatedPrices || aggregatedPrices.length === 0) {
            return false;
        }

        const currentBtcPrice = aggregatedPrices[0].price;
        
        // 买DOWN时（原趋势UP），BTC涨回去了就止损
        // 买UP时（原趋势DOWN），BTC跌回去了就止损
        if (this.buyDirection === 'DOWN' && currentBtcPrice > this.buyBtcPrice) {
            console.log(`[S37] 🛑 止损触发: BTC价格 $${currentBtcPrice.toFixed(2)} > 买入时 $${this.buyBtcPrice.toFixed(2)}`);
            return true;
        } else if (this.buyDirection === 'UP' && currentBtcPrice < this.buyBtcPrice) {
            console.log(`[S37] 🛑 止损触发: BTC价格 $${currentBtcPrice.toFixed(2)} < 买入时 $${this.buyBtcPrice.toFixed(2)}`);
            return true;
        }

        return false;
    }
}
