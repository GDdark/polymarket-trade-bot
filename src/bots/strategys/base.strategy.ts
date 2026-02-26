import { BTC15MExecutor } from "../btc-15m-executor";

export enum StrategyType {
    S27_MEAN_REVERSION = 'S27_MEAN_REVERSION',
    S31_INVERT = 'S31_INVERT',
    S34_INVERT_AGGREGATED = 'S34_INVERT_AGGREGATED',
    S35_MEAN_REVERSION_AGGREGATED = 'S35_MEAN_REVERSION_AGGREGATED',
    S36_MEAN_REVERSION_EXTENDED = 'S36_MEAN_REVERSION_EXTENDED',
    S37_MEAN_REVERSION_TAKE_PROFIT = 'S37_MEAN_REVERSION_TAKE_PROFIT',
}

export abstract class BaseStrategy {
    public readonly type: StrategyType;
    public readonly canBid: boolean = false;

    public constructor(protected readonly btc15mExecutor: BTC15MExecutor) {}

    public abstract checkSignal(): [boolean, number];
}