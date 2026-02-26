/** Binance WebSocket stream envelope */
export interface BinanceStreamMessage<T = unknown> {
    stream: string;
    data: T;
}

/** btcusdt@aggTrade payload */
export interface AggTradePayload {
    e: 'aggTrade';  // Event type
    E: number;      // Event time
    s: string;      // Symbol
    a: number;      // Aggregate trade ID
    p: string;      // Price
    q: string;      // Quantity
    nq?: string;    // Normal quantity (without RPI orders)
    f: number;      // First trade ID
    l: number;      // Last trade ID
    T: number;      // Trade time
    m: boolean;     // Is the buyer the market maker?
    M?: boolean;
}

/** [price, quantity] */
export type DepthLevel = [string, string];

/** btcusdt@depth payload */
export interface DepthUpdatePayload {
    e: 'depthUpdate'; // Event type
    E: number;        // Event time
    s: string;        // Symbol
    U: number;        // First update ID in event
    u: number;        // Final update ID in event
    b: DepthLevel[];  // Bids
    a: DepthLevel[];  // Asks
}
