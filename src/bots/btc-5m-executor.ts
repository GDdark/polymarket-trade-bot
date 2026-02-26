import { Injectable } from '@nestjs/common';
import { PolymarketApiService } from '../services/polymarket-api.service';
import { BinanceMarketStream } from '../libs/binance-market-stream';

@Injectable()
export class BTC5MExecutor {
    private binanceMarketStream: BinanceMarketStream = null;

    public constructor(
        private readonly polymarketApiService: PolymarketApiService,
    ) {
        this.binanceMarketStream = new BinanceMarketStream();
    }

    public async start() {
        this.binanceMarketStream.start();
    }
}
