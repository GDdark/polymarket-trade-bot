import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configServiceConfig } from './common/config.config';
import { ScheduleModule } from '@nestjs/schedule';
import { PolymarketApiService } from './services/polymarket-api.service';
import { NodeService } from './services/node.service';
import { PolymarketTrader } from './bots/polymarket-trader';
import { BTC5MExecutor } from './bots/btc-5m-executor';

@Module({
    imports: [
        ConfigModule.forRoot(configServiceConfig),
        ScheduleModule.forRoot(),
    ],
    providers: [
        PolymarketApiService,
        NodeService,
        PolymarketTrader,
        BTC5MExecutor,
    ],
})
export class AppModule { }
