import { BaseStrategy, StrategyType } from "./base.strategy";

// ========== 策略31: BTC偏移变化$20以上且方向反转，买反转后方向（模拟下注） ==========
export class S31InvertStrategy extends BaseStrategy {
    public readonly type: StrategyType = StrategyType.S31_INVERT;
    
    private s31HasSimulatedBid: boolean = false;
    private s31PrevDeviation: number | null = null;
    private readonly S31_CHANGE_THRESHOLD = 20;

    public checkSignal(): [boolean, number] {
        if (this.s31HasSimulatedBid) {
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
        const currentDeviation = currentBtcPrice - baselinePrice;  // 正=涨，负=跌

        // 检查偏移变化和方向反转
        if (this.s31PrevDeviation !== null) {
            const deviationChange = Math.abs(currentDeviation - this.s31PrevDeviation);
            // 方向反转：正变负 或 负变正
            const directionChanged = (this.s31PrevDeviation > 0 && currentDeviation < 0) ||
                (this.s31PrevDeviation < 0 && currentDeviation > 0);

            if (deviationChange >= this.S31_CHANGE_THRESHOLD && directionChanged) {
                this.s31HasSimulatedBid = true;
                // 买反转后的方向：currentDeviation > 0 → UP, currentDeviation < 0 → DOWN
                const bidDirection = currentDeviation > 0 ? 'UP' : 'DOWN';
                const outcomeIndex = this.btc15mExecutor.outcomes.findIndex(outcome => outcome.toLowerCase() === bidDirection.toLowerCase());
                const bidPrice = bidDirection === 'UP' ? outcome0Price : outcome1Price;

                const logString = `\n[S31] 🔄 方向反转触发\n` +
                    `偏移变化: $${this.s31PrevDeviation.toFixed(2)} → $${currentDeviation.toFixed(2)} (变化$${deviationChange.toFixed(2)})\n` +
                    `买入方向: ${bidDirection} @ ${(bidPrice * 100).toFixed(2)}%\n`;
                console.log(logString);
                
                return [true, outcomeIndex];
            }
        }

        // 更新上一次偏移值
        this.s31PrevDeviation = currentDeviation;

        return [false, -1];
    }
}