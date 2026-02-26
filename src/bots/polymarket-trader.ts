import { Injectable } from '@nestjs/common';
import { Chain, ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { ConfigService } from '@nestjs/config';
import { SignatureType, SignedOrder } from "@polymarket/order-utils";
import { dump } from '../common/utils';
import { PolymarketApiService } from '../services/polymarket-api.service';
import polymarketConditionTokenAbi from '../common/abis/polymarket-condition-token.abi';
import { Interface, ZeroAddress, Wallet as EWallet, getBytes } from 'ethers';
import { NodeService } from '../services/node.service';
import { EVM_CHAINS } from '../common/chains';
import { POLYMARKET_CONDITIONAL_TOKEN_ADDRESS, USDC_E_TOKEN_ADDRESS } from '../common/common-types';
import gnosisSafeL2Abi from '../common/abis/gnosis-safe-l2.abi';

const POLYMARKET_CLOB_HOST = 'https://clob.polymarket.com';

@Injectable()
export class PolymarketTrader {
    public static supportTradeMode: boolean = true;
    public proxyAddress: string;

    private signer: EWallet;
    private clobClient: ClobClient;
    private interfConditionToken = new Interface(polymarketConditionTokenAbi);
    private interfGnosisSafeL2 = new Interface(gnosisSafeL2Abi);
    private listenConditionIds: Record<string, boolean> = {};
    private redeemedConditionIds: Record<string, boolean> = {};

    public constructor(private readonly configService: ConfigService, private readonly nodeService: NodeService, private readonly polymarketApiService: PolymarketApiService) {
        const privateKey = this.configService.get('POLYMAKRET_PRIVATE_KEY');
        if (!!privateKey) {
            this.signer = new EWallet(this.configService.get('POLYMAKRET_PRIVATE_KEY'));

            const creds = {
                key: this.configService.get('POLYMARKET_CRED_KEY'),
                secret: this.configService.get('POLYMARKET_CRED_SECRET'),
                passphrase: this.configService.get('POLYMARKET_CRED_PASSPHRASE')
            };

            this.clobClient = new ClobClient(POLYMARKET_CLOB_HOST, Chain.POLYGON, new Wallet(this.signer.privateKey), creds, SignatureType.POLY_GNOSIS_SAFE, this.proxyAddress);
        }
        this.proxyAddress = this.configService.get('POLYMAKRET_PROXY_ADDRESS');
    }

    public async initialize(market: any) {
        this.listenConditionIds[market.conditionId] = true;

        const clobTokenIds = JSON.parse(market.clobTokenIds);
        for (const tokenID of clobTokenIds) {
            if (!!this.clobClient.tickSizes[tokenID]) {
                continue;
            }

            const [tickSize, feeRate, negRisk] = await Promise.all([
                this.polymarketApiService.getTickSize(tokenID),
                this.polymarketApiService.getFeeRate(tokenID),
                this.polymarketApiService.getNegRisk(tokenID),
            ])
            if (!tickSize || !feeRate || !negRisk) {
                throw new Error(`Tick size or fee rate or neg risk not found: ${tokenID}`);
            }

            this.clobClient.feeRates[tokenID] = feeRate.base_fee;
            this.clobClient.tickSizes[tokenID] = tickSize.minimum_tick_size.toString();
            this.clobClient.negRisk[tokenID] = negRisk.neg_risk;
        }
    }

    public async execute(slug: string, outcome: string, side: Side, price?: number) {
        const market = await this.polymarketApiService.getMarketBySlug(slug);
        if (!market) {
            throw new Error(`Market not found: ${slug}`);
        }

        await this.initialize(market);

        const tokenID = this.getTokenIdByOutcome(market, outcome);

        let amount = 1;
        if (side === Side.SELL) {
            const data = this.interfConditionToken.encodeFunctionData('balanceOf', [this.proxyAddress, tokenID]);
            const r = await this.nodeService.request(EVM_CHAINS.POLYGON_MAINNET, 'eth_call', [
                {
                    to: POLYMARKET_CONDITIONAL_TOKEN_ADDRESS,
                    data,
                },
                'latest',
            ]);

            amount = Number(BigInt(r.result)) / 10 ** 6;
        }

        let start = Date.now();
        let r = await this.clobClient.createMarketOrder({
            tokenID: tokenID,
            amount,
            side,
            price: price ? price : undefined,
        });

        console.log('r', dump(r), `cost: ${Date.now() - start}ms`);

        start = Date.now();
        r = await this.clobClient.postOrder(r, OrderType.FAK);
        console.log('r', dump(r), `cost: ${Date.now() - start}ms`);
    }

    public getTokenIdByOutcome(market: any, outcome: string) {
        const outcomes: string[] = JSON.parse(market.outcomes);
        const outcomeIndex = outcomes.findIndex(o => o.toLowerCase().startsWith(outcome.toLowerCase()));
        if (outcomeIndex === -1) {
            throw new Error(`Invalid outcome: ${outcome} In ${market.outcomes}`);
        }

        const clobTokenIds = JSON.parse(market.clobTokenIds);
        return clobTokenIds[outcomeIndex];
    }

    public async buildMarketOrder(tokenId: string, price: number, amount: number, side: Side) {
        return await this.clobClient.createMarketOrder({
            tokenID: tokenId,
            price,
            amount,
            side,
        });
    }

    public async postOrder(order: SignedOrder, orderType: OrderType = OrderType.FAK) {
        return await this.clobClient.postOrder(order, orderType);
    }

    public async createMarketPrice(tokenId: string, side: Side, amount: number, orderType: OrderType = OrderType.FAK) {
        return await this.clobClient.calculateMarketPrice(
            tokenId,
            side,
            amount,
            orderType,
        );
    }

    public async cancelOrder(orderId: string) {
        return await this.clobClient.cancelOrder({ orderID: orderId });
    }

    public async cancelAllOrders() {
        return await this.clobClient.cancelAll();
    }

    // @Cron(CronExpression.EVERY_MINUTE)
    public async tryRedeemPositions() {
        const positions = await this.polymarketApiService.getCurrentPositions(this.proxyAddress, true);
        for (const position of positions) {
            if (this.listenConditionIds[position.conditionId]) {
                if (!!this.redeemedConditionIds[position.conditionId]) {
                    continue;
                }

                this.redeemedConditionIds[position.conditionId] = true;
                await this.createAndSendRedeemTransaction(position.conditionId);
            }
        }
    }

    public async createAndSendRedeemTransaction(conditionId: string) {
        try {
            const rProxyNonce = await this.nodeService.request(EVM_CHAINS.POLYGON_MAINNET, 'eth_call', [
                {
                    to: this.proxyAddress,
                    data: this.interfGnosisSafeL2.encodeFunctionData('nonce', []),
                },
                'latest',
            ]);

            const proxyNonce = BigInt(rProxyNonce.result);
            const redeemPositionsData = this.interfConditionToken.encodeFunctionData('redeemPositions', [
                USDC_E_TOKEN_ADDRESS,
                '0x0000000000000000000000000000000000000000000000000000000000000000',
                conditionId,
                [1, 2]
            ]);

            const rTransactionHash = await this.nodeService.request(EVM_CHAINS.POLYGON_MAINNET, 'eth_call', [
                {
                    to: this.proxyAddress,
                    data: this.interfGnosisSafeL2.encodeFunctionData('getTransactionHash', [
                        POLYMARKET_CONDITIONAL_TOKEN_ADDRESS,
                        0,
                        redeemPositionsData,
                        0,
                        0,
                        0,
                        0,
                        ZeroAddress,
                        ZeroAddress,
                        proxyNonce,
                    ]),
                },
                'latest',
            ]);

            const transactionHash = rTransactionHash.result;
            const signature = this.signer.signingKey.sign(getBytes(transactionHash)).serialized;

            const tx = {
                to: this.proxyAddress,
                data: this.interfGnosisSafeL2.encodeFunctionData('execTransaction', [
                    POLYMARKET_CONDITIONAL_TOKEN_ADDRESS,
                    0,
                    redeemPositionsData,
                    0,
                    0,
                    0,
                    0,
                    ZeroAddress,
                    ZeroAddress,
                    signature,
                ]),
            }

            const [nonce, gasPrice, gas] = await Promise.all([
                this.nodeService.getTransactionCount(EVM_CHAINS.POLYGON_MAINNET, this.signer.address, 'pending'),
                this.nodeService.getGasPrice(EVM_CHAINS.POLYGON_MAINNET),
                this.nodeService.estimateGas(EVM_CHAINS.POLYGON_MAINNET, tx),
            ]);

            const raw = await this.signer.signTransaction({
                ...tx,
                chainId: EVM_CHAINS.POLYGON_MAINNET,
                nonce,
                gasPrice,
                gasLimit: gas + 10000,
                value: '0x0',
            });

            const txHash = await this.nodeService.sendRawTransaction(EVM_CHAINS.POLYGON_MAINNET, raw);
            console.log(`\ntxHash`, txHash);
        } catch (error) {
            console.error(`[PolymarketTrader] createAndSendRedeemTransaction failed`, error);
        }
    }
}
