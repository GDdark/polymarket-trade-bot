import { Injectable } from '@nestjs/common';
import Axios from 'axios';
import { NodeService } from './node.service';
import { EVM_CHAINS } from '../common/chains';
import { USDC_E_TOKEN_ADDRESS } from '../common/common-types';
import { Interface } from 'ethers';
import erc20Abi from '../common/abis/erc20.abi';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const CLOB_API_BASE = 'https://clob.polymarket.com';
const DATA_API_BASE = 'https://data-api.polymarket.com';

@Injectable()
export class PolymarketApiService {
    private interfERC20 = new Interface(erc20Abi);

    public constructor(private readonly nodeService: NodeService) { }

    public static supportTradeMode: boolean = true;

    public async getMarketByConditionIds(conditionIds: string[]) {
        return await this.requestGet(`${GAMMA_API_BASE}/markets`, {
            condition_ids: conditionIds
        });
    }

    public async getMarketByTokenIds(tokenIds: string[]) {
        return await this.requestGet(`${GAMMA_API_BASE}/markets`, {
            clob_token_ids: tokenIds
        });
    }

    public async getMarketBySlug(slug: string) {
        return await this.requestGet(`${GAMMA_API_BASE}/markets/slug/${slug}`);
    }

    public async getTickSize(tokenId: string) {
        return await this.requestGet(`${CLOB_API_BASE}/tick-size`, { token_id: tokenId });
    }

    public async getFeeRate(tokenId: string) {
        return await this.requestGet(`${CLOB_API_BASE}/fee-rate`, { token_id: tokenId });
    }

    public async getCurrentPositions(user: string, redeemable: boolean = false) {
        return await this.requestGet(`${DATA_API_BASE}/positions`, { user, redeemable: redeemable ? 'true' : 'false' });
    }

    public async getNegRisk(tokenId: string) {
        return await this.requestGet(`${CLOB_API_BASE}/neg-risk`, { token_id: tokenId });
    }

    public async getUSDEBalance(address: string) {
        const responseData = await this.nodeService.request(EVM_CHAINS.POLYGON_MAINNET, 'eth_call', [
            {
                to: USDC_E_TOKEN_ADDRESS,
                data: this.interfERC20.encodeFunctionData('balanceOf', [address]),
            },
            'latest',
        ]);

        return Number(responseData.result);
    }

    public async requestGet(url: string, params: Record<string, string | string[] | number> = {}, maxRetries: number = 3) {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await Axios.get(url, {
                    params,
                    timeout: 5000,
                    paramsSerializer: (params) => {
                        const parts: string[] = [];
                        for (const [key, value] of Object.entries(params)) {
                            if (Array.isArray(value)) {
                                for (const v of value) {
                                    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
                                }
                            } else if (value !== undefined && value !== null) {
                                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
                            }
                        }
                        return parts.join('&');
                    },
                });
                return response.data;
            } catch (error) {
                lastError = error;
                console.warn(`[PolymarketApiService] Request failed (attempt ${attempt}/${maxRetries}): ${url}`, params, error.message);

                if (attempt < maxRetries) {
                    // 等待后重试，每次等待时间递增 (1s, 2s, 3s...)
                    await this.sleep(attempt * 1000);
                }
            }
        }

        throw lastError;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
