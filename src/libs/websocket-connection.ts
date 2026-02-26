import { WebSocket } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { IS_DEVELOPMENT } from '../common/common-types';

export enum ConnectionState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    RECONNECTING = 'RECONNECTING',
    CLOSED = 'CLOSED', // 主动关闭，不再重连
}

export interface WebSocketConnectionOptions {
    url: string;
    onOpen?: () => void;
    onMessage?: (message: string) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (error: Error) => void;
    onReconnect?: (attempt: number) => void;
    onStateChange?: (state: ConnectionState) => void;
    /** 心跳间隔 (ms)，默认 5000 */
    pingIntervalMs?: number;
    /** 最大重连次数，默认 10，设为 0 表示无限重连 */
    maxReconnectAttempts?: number;
    /** 初始重连延迟 (ms)，默认 1000 */
    reconnectBaseDelayMs?: number;
    /** 最大重连延迟 (ms)，默认 30000 */
    reconnectMaxDelayMs?: number;
}

export class WebSocketConnection {
    private url: string;
    private wsClient: WebSocket | null = null;
    private state: ConnectionState = ConnectionState.DISCONNECTED;

    private intervalTimer: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private lastPingTs: number = 0;
    private lastPongTs: number = 0;

    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttempts: number;
    private readonly reconnectBaseDelayMs: number;
    private readonly reconnectMaxDelayMs: number;
    private readonly pingIntervalMs: number;

    // Callbacks
    private onOpen?: () => void;
    private onMessage?: (message: string) => void;
    private onClose?: (code: number, reason: string) => void;
    private onError?: (error: Error) => void;
    private onReconnect?: (attempt: number) => void;
    private onStateChange?: (state: ConnectionState) => void;

    constructor(options: WebSocketConnectionOptions) {
        this.url = options.url;
        this.onOpen = options.onOpen;
        this.onMessage = options.onMessage;
        this.onClose = options.onClose;
        this.onError = options.onError;
        this.onReconnect = options.onReconnect;
        this.onStateChange = options.onStateChange;

        this.pingIntervalMs = options.pingIntervalMs ?? 5000;
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
        this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000;
        this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30000;
    }

    public getState(): ConnectionState {
        return this.state;
    }

    public isConnected(): boolean {
        return this.state === ConnectionState.CONNECTED;
    }

    private setState(newState: ConnectionState) {
        if (this.state !== newState) {
            this.state = newState;
            this.onStateChange?.(newState);
        }
    }

    public connect() {
        // 已连接或正在连接中，忽略
        if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
            return;
        }

        // 正在重连中，忽略（等待重连完成）
        if (this.state === ConnectionState.RECONNECTING) {
            return;
        }

        // 已经 destroy，需要先调用 reset() 或创建新实例
        if (this.state === ConnectionState.CLOSED) {
            console.warn('[WebSocket] Cannot connect: already destroyed. Call reset() first or create a new instance.');
            return;
        }

        this.setState(ConnectionState.CONNECTING);
        this.createWebSocket();
    }

    private createWebSocket() {
        // 如果已经 destroy，不再创建连接
        if (this.state === ConnectionState.CLOSED) {
            return;
        }

        // 清理旧连接
        this.cleanupWebSocket();

        let agent: HttpsProxyAgent<string> | undefined;
        if (IS_DEVELOPMENT) {
            const proxy = "http://127.0.0.1:7890";
            agent = new HttpsProxyAgent(proxy);
        }

        this.wsClient = new WebSocket(this.url, { agent });

        this.wsClient.on('open', this.handleOpen.bind(this));
        this.wsClient.on('message', this.handleMessage.bind(this));
        this.wsClient.on('close', this.handleClose.bind(this));
        this.wsClient.on('error', this.handleError.bind(this));
        this.wsClient.on('pong', () => {
            this.lastPongTs = Date.now();
        });
    }

    private handleOpen() {
        console.log(`[WebSocket] Connected to ${this.url}`);
        this.setState(ConnectionState.CONNECTED);
        this.reconnectAttempts = 0;

        // 重置心跳时间戳，确保重连后干净启动
        // lastPingTs = 0: 第一次心跳不检查超时
        // lastPongTs = now: 防止重连后因旧值误判超时
        this.lastPingTs = 0;
        this.lastPongTs = Date.now();

        // 启动心跳
        this.startHeartbeat();

        this.onOpen?.();
    }

    private handleMessage(data: Buffer | string) {
        const msgString = data.toString();
        if (!msgString) {
            return;
        }

        if (msgString === 'PONG') {
            this.lastPongTs = Date.now();
            return;
        }

        this.onMessage?.(msgString);
    }

    private handleClose(code: number, reason: Buffer) {
        const reasonStr = reason.toString() || 'unknown';
        console.warn(`[WebSocket] Closed: code=${code}, reason=${reasonStr}`);

        this.stopHeartbeat();

        // 回调通知（用 try-catch 保护，避免影响重连流程）
        try {
            this.onClose?.(code, reasonStr);
        } catch (err) {
            console.error('[WebSocket] onClose callback error:', err);
        }

        // 只有在非主动关闭状态下才自动重连
        // CLOSED: 调用了 destroy()
        // DISCONNECTED: 调用了 disconnect()
        if (this.state !== ConnectionState.CLOSED && this.state !== ConnectionState.DISCONNECTED) {
            this.scheduleReconnect();
        }
    }

    private handleError(error: Error) {
        console.error(`[WebSocket] Error:`, error.message);
        this.onError?.(error);
    }

    private startHeartbeat() {
        this.stopHeartbeat();

        this.intervalTimer = setInterval(() => {
            if (!this.wsClient || this.state !== ConnectionState.CONNECTED) {
                return;
            }

            // 检查 pong 超时（超过 2 个心跳周期未收到 pong）
            const pongTimeout = this.pingIntervalMs * 2.5;
            if (this.lastPingTs > 0 && Date.now() - this.lastPongTs > pongTimeout) {
                console.warn('[WebSocket] Pong timeout, reconnecting...');
                this.wsClient.terminate(); // 强制关闭，触发 close 事件
                return;
            }

            // 发送 ping
            try {
                if (this.url.includes('polymarket')) {
                    this.wsClient.send('PING');
                }

                this.wsClient.ping();
                this.lastPingTs = Date.now();
            } catch (err) {
                console.error('[WebSocket] Failed to send PING:', err);
            }
        }, this.pingIntervalMs);
    }

    private stopHeartbeat() {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
    }

    private scheduleReconnect() {
        // 检查是否超过最大重连次数
        if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`[WebSocket] Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up.`);
            this.setState(ConnectionState.DISCONNECTED);
            return;
        }

        this.setState(ConnectionState.RECONNECTING);

        // 指数退避：delay = baseDelay * 2^attempts，加随机抖动
        const exponentialDelay = this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts);
        const jitter = Math.random() * 1000; // 0-1s 随机抖动
        const delay = Math.min(exponentialDelay + jitter, this.reconnectMaxDelayMs);

        this.reconnectAttempts++;
        console.log(`[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts || '∞'})...`);

        // 先设置 timer，确保即使回调异常也能重连
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.createWebSocket();
        }, delay);

        // 回调通知（用 try-catch 保护，避免影响重连流程）
        try {
            this.onReconnect?.(this.reconnectAttempts);
        } catch (err) {
            console.error('[WebSocket] onReconnect callback error:', err);
        }
    }

    private cleanupWebSocket() {
        if (this.wsClient) {
            // 移除所有监听器，避免重复触发
            this.wsClient.removeAllListeners();

            if (this.wsClient.readyState === WebSocket.OPEN ||
                this.wsClient.readyState === WebSocket.CONNECTING) {
                this.wsClient.terminate();
            }
            this.wsClient = null;
        }
    }

    public sendMessage(message: any): boolean {
        if (this.state !== ConnectionState.CONNECTED || !this.wsClient) {
            console.warn('[WebSocket] Cannot send message: not connected');
            return false;
        }

        try {
            const payload = typeof message === 'string' ? message : JSON.stringify(message);
            this.wsClient.send(payload);
            return true;
        } catch (err) {
            console.error('[WebSocket] Failed to send message:', err);
            return false;
        }
    }

    /** 手动重连（重置重连计数） */
    public reconnect() {
        this.reconnectAttempts = 0;
        this.disconnect();
        this.connect();
    }

    /** 断开连接但允许后续重连 */
    public disconnect() {
        this.cancelReconnect();
        this.stopHeartbeat();
        this.cleanupWebSocket();
        this.setState(ConnectionState.DISCONNECTED);
    }

    /** 彻底关闭，不再重连 */
    public destroy() {
        this.setState(ConnectionState.CLOSED);
        this.cancelReconnect();
        this.stopHeartbeat();
        this.cleanupWebSocket();
    }

    /** 重置状态（从 CLOSED 恢复为 DISCONNECTED），允许重新 connect */
    public reset() {
        if (this.state === ConnectionState.CLOSED) {
            this.reconnectAttempts = 0;
            this.lastPingTs = 0;
            this.lastPongTs = 0;
            this.setState(ConnectionState.DISCONNECTED);
        }
    }

    private cancelReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}