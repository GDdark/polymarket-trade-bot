CREATE TABLE condition_pnl
(
    condition_id    String,
    address         FixedString(42),
    market_type     LowCardinality(String),

    -- PnL
    total_realized_pnl      Float64,
    total_buys              UInt32,
    total_sells             UInt32,

    -- token0 position (YES)
    t0_buys                 UInt32,
    t0_sells                UInt32,
    t0_volume_buy_token     Float64,
    t0_volume_sell_token    Float64,
    t0_volume_buy_usdc      Float64,
    t0_volume_sell_usdc     Float64,
    t0_avg_buy_price        Float64,
    t0_avg_sell_price       Float64,
    t0_realized_pnl         Float64,

    -- token1 position (NO)
    t1_buys                 UInt32,
    t1_sells                UInt32,
    t1_volume_buy_token     Float64,
    t1_volume_sell_token    Float64,
    t1_volume_buy_usdc      Float64,
    t1_volume_sell_usdc     Float64,
    t1_avg_buy_price        Float64,
    t1_avg_sell_price       Float64,
    t1_realized_pnl         Float64,

    -- first entry
    first_entry_ts          Nullable(UInt64),
    first_entry_side        Nullable(UInt8),
    first_entry_price       Nullable(Float64),
    first_entry_qty         Nullable(Float64),
    first_entry_pnl_to_resolution   Nullable(Float64),
    first_entry_win_to_resolution   Nullable(UInt8),

    -- behavior
    dci                     Nullable(Float64),
    net_qty_at_end          Float64,
    holds_to_end            UInt8,
    flip_count              UInt32,
    returned_to_zero_count  UInt32,
    max_abs_net_qty         Float64,
    coverage_ratio          Nullable(Float64),

    -- HFT features
    avg_trade_interval      Nullable(Float64),
    trade_size_std          Nullable(Float64),

    -- arbitrage
    has_dual_side_position  UInt8,

    -- trader type
    win_rate                Nullable(Float64),
    avg_pnl_per_trade       Nullable(Float64),
    event_outcome_alignment UInt8,

    -- metadata
    closed_at               DateTime64(3, 'UTC')
)
ENGINE = MergeTree()
ORDER BY (closed_at, address, condition_id);
