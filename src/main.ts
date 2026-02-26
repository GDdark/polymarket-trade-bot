import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import Axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpAgent, HttpsAgent } from 'agentkeepalive';
import { IS_DEVELOPMENT } from './common/common-types';

const httpAgent = new HttpAgent({
    keepAlive: true,
    freeSocketTimeout: 30000,
    socketActiveTTL: 110000,
});

const httpsAgent = new HttpsAgent({
    keepAlive: true,
    freeSocketTimeout: 30000,
    socketActiveTTL: 110000,
});

if (IS_DEVELOPMENT) {
    const proxy = 'http://127.0.0.1:7890';
    const agent = new HttpsProxyAgent(proxy);
    Axios.defaults.httpsAgent = agent;
    Axios.defaults.httpAgent = agent;
} else {
    Axios.defaults.httpAgent = httpAgent;
    Axios.defaults.httpsAgent = httpsAgent;
}

// 全局硬超时：给每个请求自动挂 AbortController
const DEFAULT_HARD_TIMEOUT = 30000;
Axios.interceptors.request.use((config) => {
    const hardTimeout = config.timeout || DEFAULT_HARD_TIMEOUT;
    if (!config.signal) {
        const controller = new AbortController();
        config.signal = controller.signal;
        // 挂到 config 上，方便 response interceptor 清理
        (config as any).__abortTimer = setTimeout(() => controller.abort(), hardTimeout);
    }
    return config;
});
Axios.interceptors.response.use(
    (response) => {
        clearTimeout((response.config as any).__abortTimer);
        return response;
    },
    (error) => {
        clearTimeout((error.config as any)?.__abortTimer);
        return Promise.reject(error);
    },
);

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
}

bootstrap();