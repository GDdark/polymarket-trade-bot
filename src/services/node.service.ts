import { Injectable } from '@nestjs/common';
import Axios from 'axios';
import { CHAINS_RPCS } from '../common/chains';

@Injectable()
export class NodeService {
    public static supportTradeMode: boolean = true;

    public async getLatestBlockNumber(chainId: number) {
        const responseData = await this.request(chainId, 'eth_blockNumber');
        return Number(responseData.result);
    }

    public async getTransactionCount(chainId: number, address: string, block: string = 'latest') {
        const responseData = await this.request(chainId, 'eth_getTransactionCount', [address, block]);
        return Number(responseData.result);
    }

    public async getGasPrice(chainId: number) {
        const responseData = await this.request(chainId, 'eth_gasPrice');
        return Number(responseData.result);
    }

    public async estimateGas(chainId: number, tx: any) {
        const responseData = await this.request(chainId, 'eth_estimateGas', [tx]);
        return Number(responseData.result);
    }

    public async sendRawTransaction(chainId: number, raw: string) {
        const responseData = await this.request(chainId, 'eth_sendRawTransaction', [raw]);
        return responseData.result;
    }

    public async request(chainId: number, method: string, params: any[] = []) {
        const response = await Axios.post(CHAINS_RPCS[chainId], {
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
        }, { timeout: 60000 });

        return response.data;
    }
}
