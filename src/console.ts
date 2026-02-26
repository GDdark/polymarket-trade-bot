import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PolymarketApiService } from './services/polymarket-api.service';
import { BTC15MExecutor } from './bots/btc-15m-executor';
import { PolymarketTrader } from './bots/polymarket-trader';
import { Side } from '@polymarket/clob-client';
import { BTC5MExecutor } from './bots/btc-5m-executor';

process.env.EXECUTE_MODE = 'console';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    await app.init(); // 触发 onModuleInit 生命周期钩子

    const command = process.argv[2];

    process.env.COMMAND = command;

    if (command === 'get-market-by-slug') {
        const slug = process.argv[3];
        console.log('slug: ', slug);
        const market = await app.get(PolymarketApiService).getMarketBySlug(slug.trim());
        console.log('market: ', market);
    } else if (command === 'get-market-by-condition-id') {
        const conditionId = process.argv[3];
        console.log('conditionId: ', conditionId);
        const market = await app.get(PolymarketApiService).getMarketByConditionIds([conditionId.trim()]);
        console.log('market: ', market);
    } else if (command === 'get-market-by-token-id') {
        let tokenId = process.argv[3];
        if (tokenId.startsWith('0x')) {
            tokenId = BigInt(tokenId).toString();
        }

        console.log('tokenId: ', tokenId);
        const market = await app.get(PolymarketApiService).getMarketByTokenIds([tokenId.trim()]);
        console.log('market: ', market);
    } else if (command === 'btc-15m-executor') {
        const slug = process.argv[3];

        const btc15mExecutor = app.get(BTC15MExecutor);
        await btc15mExecutor.execute(slug);
    } else if (command === 'btc-5m-executor') {
        const btc5mExecutor = app.get(BTC5MExecutor);
        await btc5mExecutor.start();
    } else if (command === 'polymarket-trader') {
        const slug = process.argv[3];
        const choice = process.argv[4];
        const side = process.argv[5].toUpperCase();
        const price = Number(process.argv[6]);

        const polymarketTrader = app.get(PolymarketTrader);
        await polymarketTrader.execute(slug, choice, side as Side, price);
    }
}

bootstrap();
