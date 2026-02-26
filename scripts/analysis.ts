import * as fs from 'fs';
import * as path from 'path';

// BTC价格数据结构
interface BtcPrice {
    timestamp: number;
    price: number;
}

// Polymarket UP/DOWN 价格记录
interface PriceRecord {
    timestamp: number;
    Up: number;
    Down: number;
}

// 周期数据
interface CycleData {
    cycleId: string;
    btcPrices: BtcPrice[];
    btcAggregatedPrices: BtcPrice[];
    priceRecords: PriceRecord[];
}

const MIN_DURATION_MS = 14 * 60 * 1000;  // 最小周期时长（14分钟）

/**
 * 加载周期数据
 */
function loadCycleData(bidResultsDir: string): CycleData[] {
    const files = fs.readdirSync(bidResultsDir);
    const cycleIds = new Set<string>();

    files.forEach(file => {
        const match = file.match(/btc-updown-15m-(\d+)-(btc-prices|price-records)\.json/);
        if (match) {
            cycleIds.add(match[1]);
        }
    });

    const cycles: CycleData[] = [];

    for (const cycleId of cycleIds) {
        const btcPricesFile = path.join(bidResultsDir, `btc-updown-15m-${cycleId}-btc-prices.json`);
        const priceRecordsFile = path.join(bidResultsDir, `btc-updown-15m-${cycleId}-price-records.json`);

        if (!fs.existsSync(btcPricesFile) || !fs.existsSync(priceRecordsFile)) {
            continue;
        }

        let btcPrices: BtcPrice[] = [];
        let btcAggregatedPrices: BtcPrice[] = [];
        let priceRecords: PriceRecord[] = [];

        try {
            btcPrices = JSON.parse(fs.readFileSync(btcPricesFile, 'utf-8'));
            priceRecords = JSON.parse(fs.readFileSync(priceRecordsFile, 'utf-8'));
            
            const btcAggregatedPricesFile = path.join(bidResultsDir, `btc-updown-15m-${cycleId}-btc-aggregated-prices.json`);
            if (fs.existsSync(btcAggregatedPricesFile)) {
                btcAggregatedPrices = JSON.parse(fs.readFileSync(btcAggregatedPricesFile, 'utf-8'));
            }
        } catch (error) {
            continue;
        }

        // 过滤不完整的周期
        if (btcAggregatedPrices.length > 0) {
            const timestamps = btcAggregatedPrices.map(p => p.timestamp);
            const duration = Math.max(...timestamps) - Math.min(...timestamps);
            if (duration < MIN_DURATION_MS) {
                continue;
            }
        }

        cycles.push({ cycleId, btcPrices, btcAggregatedPrices, priceRecords });
    }

    return cycles;
}

/**
 * 清理老周期数据
 */
function cleanupOldCycles(bidResultsDir: string, maxCycles: number): void {
    const files = fs.readdirSync(bidResultsDir);
    const cycleIds = new Set<string>();

    files.forEach(file => {
        const match = file.match(/btc-updown-15m-(\d+)-/);
        if (match) {
            cycleIds.add(match[1]);
        }
    });

    const sortedCycleIds = Array.from(cycleIds).sort((a, b) => parseInt(a) - parseInt(b));
    
    if (sortedCycleIds.length <= maxCycles) {
        return;
    }

    const cyclesToDelete = sortedCycleIds.slice(0, sortedCycleIds.length - maxCycles);
    console.log(`清理老周期数据: 删除 ${cyclesToDelete.length} 个周期（保留最近 ${maxCycles} 个）`);
    
    let deletedFiles = 0;
    for (const cycleId of cyclesToDelete) {
        for (const file of files) {
            if (file.includes(`btc-updown-15m-${cycleId}-`)) {
                const filePath = path.join(bidResultsDir, file);
                try {
                    fs.unlinkSync(filePath);
                    deletedFiles++;
                } catch (error) {
                    // ignore
                }
            }
        }
    }
    console.log(`已删除 ${deletedFiles} 个文件\n`);
}

/**
 * 运行分析
 */
function runAnalysis() {
    const bidResultsDir = path.join(__dirname, '..', 'bid-results');
    const MAX_CYCLES = 300;

    cleanupOldCycles(bidResultsDir, MAX_CYCLES);

    console.log('正在加载周期数据...');
    const cycles = loadCycleData(bidResultsDir);
    console.log(`共找到 ${cycles.length} 个有效周期\n`);

    if (cycles.length === 0) {
        console.log('没有数据可分析');
        return;
    }

    // 按周期ID排序
    const sortedCycles = [...cycles].sort((a, b) => parseInt(a.cycleId) - parseInt(b.cycleId));

    console.log('='.repeat(100));
    console.log('780秒策略分析：寻找接近100%胜率的条件');
    console.log('='.repeat(100));
    console.log('\n在周期第780秒（13分钟），还剩2分钟结束');
    console.log('分析此时什么条件能高概率预测最终结果\n');

    // 分析每个周期在780秒时的状态
    interface CycleAt780 {
        cycleId: string;
        actualOutcome: 'UP' | 'DOWN';
        btcDeviation: number;           // BTC相对基准的偏移（美元）
        btcDeviationPercent: number;    // BTC偏移百分比
        upPrice: number;                // UP价格
        downPrice: number;              // DOWN价格
        leadingDir: 'UP' | 'DOWN';      // 领先方向
        priceDiff: number;              // UP-DOWN价差
        priceSum: number;               // UP+DOWN价格和
        // 新增指标
        priceMomentum: number;          // 价格动量（领先价格60秒内变化）
        btcMomentum: number;            // BTC动量（60秒内变化）
        dirReversals: number;           // 方向反转次数（整个周期内）
        leadingDuration: number;        // 当前方向领先持续时间（秒）
        btcVolatility: number;          // BTC波动率（标准差）
        priceStability: number;         // 价差稳定性（最近60秒价差标准差）
        maxBtcDeviation: number;        // 周期内BTC最大偏移
        btcTrendStrength: number;       // BTC趋势强度（当前偏移/最大偏移）
        // S36相关
        s36TriggeredAfter780: boolean;  // 780秒后是否触发S36
        s36Direction: 'UP' | 'DOWN' | null;  // S36买入方向
        s36BuyPrice: number | null;     // S36买入价格
        s36TriggerTime: number | null;  // S36触发时间（秒）
    }

    const cyclesAt780: CycleAt780[] = [];

    for (const cycle of sortedCycles) {
        const sortedBtc = [...cycle.btcPrices].sort((a, b) => a.timestamp - b.timestamp);
        const sortedRecords = [...cycle.priceRecords].sort((a, b) => a.timestamp - b.timestamp);
        
        if (sortedBtc.length < 2 || sortedRecords.length < 2) continue;

        const cycleStartTs = sortedRecords[0].timestamp;
        const btcBaseline = sortedBtc[0].price;
        const btcEnd = sortedBtc[sortedBtc.length - 1].price;
        const actualOutcome: 'UP' | 'DOWN' = btcEnd > btcBaseline ? 'UP' : 'DOWN';

        // 找780秒时的数据
        const target780Ts = cycleStartTs + 780 * 1000;
        const recordAt780 = sortedRecords.find(r => r.timestamp >= target780Ts);
        const btcAt780 = sortedBtc.find(b => b.timestamp >= target780Ts);

        if (!recordAt780 || !btcAt780) continue;

        const btcDeviation = btcAt780.price - btcBaseline;
        const btcDeviationPercent = (btcDeviation / btcBaseline) * 100;
        const leadingDir: 'UP' | 'DOWN' = recordAt780.Up > recordAt780.Down ? 'UP' : 'DOWN';
        const priceDiff = recordAt780.Up - recordAt780.Down;

        // 计算价格动量（60秒前到现在的变化）
        const target720Ts = cycleStartTs + 720 * 1000;
        const recordAt720 = sortedRecords.find(r => r.timestamp >= target720Ts);
        const btcAt720 = sortedBtc.find(b => b.timestamp >= target720Ts);
        
        let priceMomentum = 0;
        let btcMomentum = 0;
        if (recordAt720 && btcAt720) {
            const leadingPrice780 = leadingDir === 'UP' ? recordAt780.Up : recordAt780.Down;
            const leadingPrice720 = leadingDir === 'UP' ? recordAt720.Up : recordAt720.Down;
            priceMomentum = leadingPrice780 - leadingPrice720;
            btcMomentum = btcAt780.price - btcAt720.price;
        }

        // 计算方向反转次数
        let dirReversals = 0;
        let prevLeading: 'UP' | 'DOWN' | null = null;
        for (const r of sortedRecords) {
            if (r.timestamp > target780Ts) break;
            const currentLeading: 'UP' | 'DOWN' = r.Up > r.Down ? 'UP' : 'DOWN';
            if (prevLeading && currentLeading !== prevLeading) {
                dirReversals++;
            }
            prevLeading = currentLeading;
        }

        // 计算当前方向领先持续时间
        let leadingDuration = 0;
        for (let i = sortedRecords.length - 1; i >= 0; i--) {
            const r = sortedRecords[i];
            if (r.timestamp > target780Ts) continue;
            const currentLeading: 'UP' | 'DOWN' = r.Up > r.Down ? 'UP' : 'DOWN';
            if (currentLeading === leadingDir) {
                leadingDuration = (target780Ts - r.timestamp) / 1000;
            } else {
                break;
            }
        }
        // 找最后一次反转的时间
        for (let i = sortedRecords.length - 1; i >= 0; i--) {
            const r = sortedRecords[i];
            if (r.timestamp > target780Ts) continue;
            const currentLeading: 'UP' | 'DOWN' = r.Up > r.Down ? 'UP' : 'DOWN';
            if (currentLeading !== leadingDir) {
                leadingDuration = (target780Ts - r.timestamp) / 1000;
                break;
            }
        }

        // 计算BTC波动率（到780秒为止的标准差）
        const btcPricesTo780 = sortedBtc.filter(b => b.timestamp <= target780Ts).map(b => b.price);
        const btcMean = btcPricesTo780.reduce((a, b) => a + b, 0) / btcPricesTo780.length;
        const btcVolatility = Math.sqrt(btcPricesTo780.reduce((sum, p) => sum + Math.pow(p - btcMean, 2), 0) / btcPricesTo780.length);

        // 计算价差稳定性（最近60秒价差的标准差）
        const recentRecords = sortedRecords.filter(r => r.timestamp >= target720Ts && r.timestamp <= target780Ts);
        const recentDiffs = recentRecords.map(r => r.Up - r.Down);
        let priceStability = 0;
        if (recentDiffs.length > 0) {
            const diffMean = recentDiffs.reduce((a, b) => a + b, 0) / recentDiffs.length;
            priceStability = Math.sqrt(recentDiffs.reduce((sum, d) => sum + Math.pow(d - diffMean, 2), 0) / recentDiffs.length);
        }

        // 计算周期内BTC最大偏移
        const btcDeviations = btcPricesTo780.map(p => Math.abs(p - btcBaseline));
        const maxBtcDeviation = Math.max(...btcDeviations);

        // BTC趋势强度（当前偏移/最大偏移，接近1说明趋势强劲未回撤）
        const btcTrendStrength = maxBtcDeviation > 0 ? Math.abs(btcDeviation) / maxBtcDeviation : 0;

        // ===== S36逻辑：780秒后是否触发 =====
        // S36: BTC先涨/跌$30以上，然后回落到$10以内，买反向
        const S36_PEAK_THRESHOLD = 30;
        const S36_REVERT_THRESHOLD = 10;
        
        let s36TriggeredAfter780 = false;
        let s36Direction: 'UP' | 'DOWN' | null = null;
        let s36BuyPrice: number | null = null;
        let s36TriggerTime: number | null = null;

        // 先找780秒前是否已经有$30的峰值
        let peakDirection: 'UP' | 'DOWN' | null = null;
        let peakReached = false;
        
        for (const btc of sortedBtc) {
            if (btc.timestamp > target780Ts) break;
            const dev = btc.price - btcBaseline;
            if (!peakReached) {
                if (dev >= S36_PEAK_THRESHOLD) {
                    peakDirection = 'UP';
                    peakReached = true;
                } else if (dev <= -S36_PEAK_THRESHOLD) {
                    peakDirection = 'DOWN';
                    peakReached = true;
                }
            }
        }

        // 如果780秒前已经有峰值，检查780秒后是否触发回归
        if (peakReached && peakDirection) {
            for (const btc of sortedBtc) {
                if (btc.timestamp <= target780Ts) continue;  // 只看780秒后
                const dev = btc.price - btcBaseline;
                
                // 检查是否触发S36
                let triggered = false;
                if (peakDirection === 'UP' && dev < S36_REVERT_THRESHOLD) {
                    triggered = true;
                } else if (peakDirection === 'DOWN' && dev > -S36_REVERT_THRESHOLD) {
                    triggered = true;
                }

                if (triggered) {
                    s36TriggeredAfter780 = true;
                    s36Direction = peakDirection === 'UP' ? 'DOWN' : 'UP';  // 买反向
                    s36TriggerTime = (btc.timestamp - cycleStartTs) / 1000;
                    
                    // 找触发时的价格
                    const recordAtTrigger = sortedRecords.find(r => r.timestamp >= btc.timestamp);
                    if (recordAtTrigger) {
                        s36BuyPrice = s36Direction === 'UP' ? recordAtTrigger.Up : recordAtTrigger.Down;
                    }
                    break;
                }
            }
        }

        // 如果780秒前没有峰值，检查780秒后是否先达到峰值再回归
        if (!peakReached) {
            let postPeakDirection: 'UP' | 'DOWN' | null = null;
            let postPeakReached = false;
            
            for (const btc of sortedBtc) {
                if (btc.timestamp <= target780Ts) continue;
                const dev = btc.price - btcBaseline;
                
                if (!postPeakReached) {
                    if (dev >= S36_PEAK_THRESHOLD) {
                        postPeakDirection = 'UP';
                        postPeakReached = true;
                    } else if (dev <= -S36_PEAK_THRESHOLD) {
                        postPeakDirection = 'DOWN';
                        postPeakReached = true;
                    }
                } else if (postPeakDirection) {
                    // 已经有峰值，检查回归
                    let triggered = false;
                    if (postPeakDirection === 'UP' && dev < S36_REVERT_THRESHOLD) {
                        triggered = true;
                    } else if (postPeakDirection === 'DOWN' && dev > -S36_REVERT_THRESHOLD) {
                        triggered = true;
                    }

                    if (triggered) {
                        s36TriggeredAfter780 = true;
                        s36Direction = postPeakDirection === 'UP' ? 'DOWN' : 'UP';
                        s36TriggerTime = (btc.timestamp - cycleStartTs) / 1000;
                        
                        const recordAtTrigger = sortedRecords.find(r => r.timestamp >= btc.timestamp);
                        if (recordAtTrigger) {
                            s36BuyPrice = s36Direction === 'UP' ? recordAtTrigger.Up : recordAtTrigger.Down;
                        }
                        break;
                    }
                }
            }
        }

        cyclesAt780.push({
            cycleId: cycle.cycleId,
            actualOutcome,
            btcDeviation,
            btcDeviationPercent,
            upPrice: recordAt780.Up,
            downPrice: recordAt780.Down,
            leadingDir,
            priceDiff,
            priceSum: recordAt780.Up + recordAt780.Down,
            priceMomentum,
            btcMomentum,
            dirReversals,
            leadingDuration,
            btcVolatility,
            priceStability,
            maxBtcDeviation,
            btcTrendStrength,
            s36TriggeredAfter780,
            s36Direction,
            s36BuyPrice,
            s36TriggerTime,
        });
    }

    console.log(`分析了 ${cyclesAt780.length} 个周期\n`);

    // 计算PNL的辅助函数
    function calcPnl(cycles: CycleAt780[], strategy: 'follow_trend' | 'follow_btc'): { wins: number, pnl: number, avgBuyPrice: number } {
        let wins = 0;
        let pnl = 0;
        let totalBuyPrice = 0;

        for (const c of cycles) {
            let buyDir: 'UP' | 'DOWN';
            let buyPrice: number;

            if (strategy === 'follow_trend') {
                // 买领先方向
                buyDir = c.leadingDir;
                buyPrice = buyDir === 'UP' ? c.upPrice : c.downPrice;
            } else {
                // 买BTC偏移方向
                buyDir = c.btcDeviation > 0 ? 'UP' : 'DOWN';
                buyPrice = buyDir === 'UP' ? c.upPrice : c.downPrice;
            }

            totalBuyPrice += buyPrice;
            if (buyDir === c.actualOutcome) {
                wins++;
                pnl += 1 - buyPrice;  // 赢了拿回$1
            } else {
                pnl -= buyPrice;  // 输了损失买入价
            }
        }

        return { wins, pnl, avgBuyPrice: totalBuyPrice / cycles.length };
    }

    // ========== 基础统计 ==========
    console.log('--- 基础统计：780秒时顺势买入 ---');
    const baseStats = calcPnl(cyclesAt780, 'follow_trend');
    console.log(`交易次数: ${cyclesAt780.length}`);
    console.log(`胜率: ${(baseStats.wins / cyclesAt780.length * 100).toFixed(2)}% (${baseStats.wins}/${cyclesAt780.length})`);
    console.log(`总PNL: $${baseStats.pnl.toFixed(4)}`);
    console.log(`ROI: ${(baseStats.pnl / (baseStats.avgBuyPrice * cyclesAt780.length) * 100).toFixed(2)}%`);
    console.log(`平均买入价: $${baseStats.avgBuyPrice.toFixed(4)}`);

    // ========== S36触发统计 ==========
    console.log('\n' + '='.repeat(120));
    console.log('S36策略分析：780秒后触发均值回归');
    console.log('='.repeat(120));
    console.log('\nS36逻辑: BTC先涨/跌$30以上，然后回落到$10以内，买反向');
    
    const s36TriggeredCycles = cyclesAt780.filter(c => c.s36TriggeredAfter780);
    console.log(`\n780秒后触发S36的周期: ${s36TriggeredCycles.length}/${cyclesAt780.length} (${(s36TriggeredCycles.length / cyclesAt780.length * 100).toFixed(1)}%)`);

    if (s36TriggeredCycles.length > 0) {
        // S36单独统计
        let s36Wins = 0;
        let s36Pnl = 0;
        let s36TotalBuyPrice = 0;
        
        for (const c of s36TriggeredCycles) {
            if (c.s36Direction && c.s36BuyPrice) {
                s36TotalBuyPrice += c.s36BuyPrice;
                if (c.s36Direction === c.actualOutcome) {
                    s36Wins++;
                    s36Pnl += 1 - c.s36BuyPrice;
                } else {
                    s36Pnl -= c.s36BuyPrice;
                }
            }
        }

        const s36AvgBuyPrice = s36TotalBuyPrice / s36TriggeredCycles.length;
        console.log(`\nS36单独统计:`);
        console.log(`  交易数: ${s36TriggeredCycles.length}`);
        console.log(`  胜率: ${(s36Wins / s36TriggeredCycles.length * 100).toFixed(2)}% (${s36Wins}/${s36TriggeredCycles.length})`);
        console.log(`  总PNL: $${s36Pnl.toFixed(4)}`);
        console.log(`  ROI: ${(s36Pnl / s36TotalBuyPrice * 100).toFixed(2)}%`);
        console.log(`  平均买入价: $${s36AvgBuyPrice.toFixed(4)}`);
        console.log(`  平均触发时间: ${(s36TriggeredCycles.reduce((sum, c) => sum + (c.s36TriggerTime || 0), 0) / s36TriggeredCycles.length).toFixed(0)}秒`);
    }

    // ========== 780秒 + S36 组合策略 ==========
    console.log('\n' + '='.repeat(120));
    console.log('780秒 + S36 组合策略分析');
    console.log('='.repeat(120));
    console.log('\n逻辑: 780秒顺势买入第一次，如果后续触发S36则再买入一次');

    // 计算组合策略的PNL
    function calcCombinedPnl(cycles: CycleAt780[], condition780: (c: CycleAt780) => boolean) {
        let totalTrades = 0;
        let wins780 = 0;
        let winsS36 = 0;
        let pnl780 = 0;
        let pnlS36 = 0;
        let cost780 = 0;
        let costS36 = 0;

        for (const c of cycles) {
            // 780秒买入
            if (condition780(c)) {
                totalTrades++;
                const buyPrice = c.leadingDir === 'UP' ? c.upPrice : c.downPrice;
                cost780 += buyPrice;
                if (c.leadingDir === c.actualOutcome) {
                    wins780++;
                    pnl780 += 1 - buyPrice;
                } else {
                    pnl780 -= buyPrice;
                }

                // S36追加买入
                if (c.s36TriggeredAfter780 && c.s36Direction && c.s36BuyPrice) {
                    totalTrades++;
                    costS36 += c.s36BuyPrice;
                    if (c.s36Direction === c.actualOutcome) {
                        winsS36++;
                        pnlS36 += 1 - c.s36BuyPrice;
                    } else {
                        pnlS36 -= c.s36BuyPrice;
                    }
                }
            }
        }

        return {
            cycles: cycles.filter(condition780).length,
            totalTrades,
            wins780,
            winsS36,
            pnl780,
            pnlS36,
            totalPnl: pnl780 + pnlS36,
            cost780,
            costS36,
            totalCost: cost780 + costS36,
        };
    }

    // 无条件组合
    const combined = calcCombinedPnl(cyclesAt780, () => true);
    console.log('\n--- 无条件组合 ---');
    console.log(`  参与周期: ${combined.cycles}`);
    console.log(`  总交易数: ${combined.totalTrades} (780秒: ${combined.wins780 + (combined.cycles - combined.wins780)}, S36: ${combined.winsS36 + (combined.totalTrades - combined.cycles - combined.winsS36)})`);
    console.log(`  780秒胜率: ${(combined.wins780 / combined.cycles * 100).toFixed(2)}%`);
    console.log(`  S36胜率: ${combined.totalTrades > combined.cycles ? ((combined.winsS36 / (combined.totalTrades - combined.cycles)) * 100).toFixed(2) : 'N/A'}%`);
    console.log(`  总PNL: $${combined.totalPnl.toFixed(4)} (780秒: $${combined.pnl780.toFixed(4)}, S36: $${combined.pnlS36.toFixed(4)})`);
    console.log(`  总ROI: ${(combined.totalPnl / combined.totalCost * 100).toFixed(2)}%`);

    // 方向一致条件组合
    console.log('\n--- 方向一致条件组合 ---');
    console.log('  条件                     | 周期 | 总交易 | 780胜率  | S36胜率  | 总PNL      | ROI');
    console.log('  ' + '-'.repeat(95));

    for (const btcThreshold of [0, 20, 30, 40, 50]) {
        const condition = (c: CycleAt780) => 
            Math.abs(c.btcDeviation) >= btcThreshold &&
            ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
             (c.leadingDir === 'DOWN' && c.btcDeviation < 0));
        
        const result = calcCombinedPnl(cyclesAt780, condition);
        if (result.cycles === 0) continue;
        
        const winRate780 = (result.wins780 / result.cycles * 100).toFixed(2);
        const s36Trades = result.totalTrades - result.cycles;
        const winRateS36 = s36Trades > 0 ? ((result.winsS36 / s36Trades) * 100).toFixed(2) : 'N/A';
        const roi = result.totalCost > 0 ? (result.totalPnl / result.totalCost * 100).toFixed(2) : '0';
        
        console.log(`  方向一致 & BTC>=$${btcThreshold.toString().padEnd(5)} | ${result.cycles.toString().padEnd(4)} | ${result.totalTrades.toString().padEnd(6)} | ${winRate780.padEnd(8)}% | ${winRateS36.toString().padEnd(8)}% | $${result.totalPnl.toFixed(4).padEnd(9)} | ${roi}%`);
    }

    // ========== 分析不同条件的胜率和PNL ==========
    console.log('\n' + '='.repeat(120));
    console.log('条件筛选分析：综合胜率和PNL');
    console.log('='.repeat(120));

    // 条件1：价差阈值
    console.log('\n--- 条件1: UP-DOWN价差阈值（顺势买入）---');
    console.log('  价差阈值  | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const threshold of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]) {
        const filtered = cyclesAt780.filter(c => Math.abs(c.priceDiff) >= threshold);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= ${threshold.toFixed(2)}     | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件2：BTC偏移阈值（买BTC方向）
    console.log('\n--- 条件2: BTC偏移阈值（买BTC偏移方向）---');
    console.log('  BTC偏移   | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const threshold of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
        const filtered = cyclesAt780.filter(c => Math.abs(c.btcDeviation) >= threshold);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_btc');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= $${threshold.toString().padEnd(5)} | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件3：领先价格阈值
    console.log('\n--- 条件3: 领先方向价格阈值（顺势买入）---');
    console.log('  领先价格  | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const threshold of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
        const filtered = cyclesAt780.filter(c => Math.max(c.upPrice, c.downPrice) >= threshold);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= ${threshold.toFixed(2)}     | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件4：方向一致（价格领先 = BTC偏移方向）
    console.log('\n--- 条件4: 方向一致（价格领先 = BTC偏移方向）+ BTC偏移阈值 ---');
    console.log('  BTC偏移   | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const btcThreshold of [0, 10, 20, 30, 40, 50, 60, 70, 80]) {
        const filtered = cyclesAt780.filter(c => 
            Math.abs(c.btcDeviation) >= btcThreshold &&
            ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
             (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
        );
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= $${btcThreshold.toString().padEnd(5)} | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件5：方向反转次数（反转少 = 趋势稳定）
    console.log('\n--- 条件5: 方向反转次数（反转越少趋势越稳定）---');
    console.log('  反转次数  | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const maxReversals of [10, 8, 6, 5, 4, 3, 2, 1, 0]) {
        const filtered = cyclesAt780.filter(c => c.dirReversals <= maxReversals);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  <= ${maxReversals.toString().padEnd(7)} | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件6：领先持续时间
    console.log('\n--- 条件6: 当前方向领先持续时间（秒）---');
    console.log('  持续时间  | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const minDuration of [0, 60, 120, 180, 240, 300, 400, 500, 600]) {
        const filtered = cyclesAt780.filter(c => c.leadingDuration >= minDuration);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= ${minDuration.toString().padEnd(6)}s | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件7：BTC趋势强度（接近1说明没有回撤）
    console.log('\n--- 条件7: BTC趋势强度（当前偏移/最大偏移，接近1=无回撤）---');
    console.log('  趋势强度  | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const minStrength of [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
        const filtered = cyclesAt780.filter(c => c.btcTrendStrength >= minStrength);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= ${minStrength.toFixed(2)}    | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件8：价格动量（正向动量=趋势加速）
    console.log('\n--- 条件8: 价格动量（领先方向60秒内价格变化，正=加速）---');
    console.log('  动量阈值  | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const minMomentum of [-0.05, 0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1]) {
        const filtered = cyclesAt780.filter(c => c.priceMomentum >= minMomentum);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= ${minMomentum.toFixed(2).padEnd(6)} | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件9：BTC动量方向一致
    console.log('\n--- 条件9: BTC动量方向一致（60秒BTC变化方向=领先方向）---');
    const btcMomentumAligned = cyclesAt780.filter(c => 
        (c.leadingDir === 'UP' && c.btcMomentum > 0) ||
        (c.leadingDir === 'DOWN' && c.btcMomentum < 0)
    );
    if (btcMomentumAligned.length > 0) {
        const stats = calcPnl(btcMomentumAligned, 'follow_trend');
        const winRate = (stats.wins / btcMomentumAligned.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * btcMomentumAligned.length) * 100).toFixed(2);
        console.log(`  BTC动量一致: ${btcMomentumAligned.length} 周期, 胜率 ${winRate}%, PNL $${stats.pnl.toFixed(4)}, ROI ${roi}%`);
    }

    // BTC动量一致 + 不同强度阈值
    console.log('  BTC动量阈值 | 交易数 | 胜率     | 总PNL      | ROI');
    console.log('  ' + '-'.repeat(60));
    for (const btcMomThreshold of [0, 5, 10, 15, 20, 30]) {
        const filtered = cyclesAt780.filter(c => 
            Math.abs(c.btcMomentum) >= btcMomThreshold &&
            ((c.leadingDir === 'UP' && c.btcMomentum > 0) ||
             (c.leadingDir === 'DOWN' && c.btcMomentum < 0))
        );
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  >= $${btcMomThreshold.toString().padEnd(9)} | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi}%`);
    }

    // 条件10：价差稳定性（低波动=确定性高）
    console.log('\n--- 条件10: 价差稳定性（最近60秒价差标准差，低=稳定）---');
    console.log('  稳定性    | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(75));
    
    for (const maxStability of [0.5, 0.3, 0.2, 0.15, 0.1, 0.08, 0.05, 0.03]) {
        const filtered = cyclesAt780.filter(c => c.priceStability <= maxStability);
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        console.log(`  <= ${maxStability.toFixed(2)}    | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // 条件11：组合条件（价差 + BTC偏移 + 方向一致）
    console.log('\n--- 条件11: 组合条件（方向一致 + 价差阈值 + BTC偏移阈值）---');
    console.log('  条件组合              | 交易数 | 胜率     | 总PNL      | ROI       | 平均买价');
    console.log('  ' + '-'.repeat(85));
    
    const combinations = [
        { priceDiff: 0, btcDev: 0 },
        { priceDiff: 0.1, btcDev: 20 },
        { priceDiff: 0.1, btcDev: 30 },
        { priceDiff: 0.15, btcDev: 30 },
        { priceDiff: 0.15, btcDev: 40 },
        { priceDiff: 0.2, btcDev: 40 },
        { priceDiff: 0.2, btcDev: 50 },
        { priceDiff: 0.25, btcDev: 50 },
        { priceDiff: 0.3, btcDev: 60 },
    ];
    
    for (const combo of combinations) {
        const filtered = cyclesAt780.filter(c => 
            Math.abs(c.priceDiff) >= combo.priceDiff && 
            Math.abs(c.btcDeviation) >= combo.btcDev &&
            ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
             (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
        );
        if (filtered.length === 0) continue;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = (stats.wins / filtered.length * 100).toFixed(2);
        const roi = (stats.pnl / (stats.avgBuyPrice * filtered.length) * 100).toFixed(2);
        const desc = `差>=${combo.priceDiff.toFixed(2)} BTC>=$${combo.btcDev}`;
        console.log(`  ${desc.padEnd(21)} | ${filtered.length.toString().padEnd(6)} | ${winRate.padEnd(8)}% | $${stats.pnl.toFixed(4).padEnd(9)} | ${roi.padEnd(8)}% | $${stats.avgBuyPrice.toFixed(4)}`);
    }

    // ========== 搜索最优条件 ==========
    console.log('\n' + '='.repeat(120));
    console.log('⭐ 最优条件搜索（综合评分 = ROI × sqrt(交易数) × (胜率/50)）');
    console.log('='.repeat(120));

    interface ConditionResult {
        desc: string;
        trades: number;
        wins: number;
        winRate: number;
        pnl: number;
        roi: number;
        avgBuyPrice: number;
        score: number;
    }

    const allResults: ConditionResult[] = [];

    // 辅助函数：添加结果
    function addResult(desc: string, filtered: CycleAt780[]) {
        if (filtered.length < 5) return;
        const stats = calcPnl(filtered, 'follow_trend');
        const winRate = stats.wins / filtered.length * 100;
        const roi = stats.pnl / (stats.avgBuyPrice * filtered.length) * 100;
        const score = roi * Math.sqrt(filtered.length) * (winRate / 50);
        allResults.push({
            desc,
            trades: filtered.length,
            wins: stats.wins,
            winRate,
            pnl: stats.pnl,
            roi,
            avgBuyPrice: stats.avgBuyPrice,
            score
        });
    }

    // 搜索1：方向一致 + 价差阈值 + BTC偏移阈值
    for (const priceDiffThreshold of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
        for (const btcThreshold of [0, 10, 20, 30, 40, 50, 60, 70]) {
            const filtered = cyclesAt780.filter(c => 
                Math.abs(c.priceDiff) >= priceDiffThreshold && 
                Math.abs(c.btcDeviation) >= btcThreshold &&
                ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
                 (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
            );
            addResult(`方向一致 & 差>=${priceDiffThreshold.toFixed(2)} & BTC>=$${btcThreshold}`, filtered);
        }
    }

    // 搜索2：方向一致 + BTC趋势强度
    for (const btcThreshold of [0, 20, 30, 40, 50]) {
        for (const trendStrength of [0.7, 0.8, 0.85, 0.9, 0.95]) {
            const filtered = cyclesAt780.filter(c => 
                Math.abs(c.btcDeviation) >= btcThreshold &&
                c.btcTrendStrength >= trendStrength &&
                ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
                 (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
            );
            addResult(`方向一致 & BTC>=$${btcThreshold} & 趋势强度>=${trendStrength}`, filtered);
        }
    }

    // 搜索3：方向一致 + 反转次数限制
    for (const btcThreshold of [0, 20, 30, 40, 50]) {
        for (const maxReversals of [5, 4, 3, 2, 1, 0]) {
            const filtered = cyclesAt780.filter(c => 
                Math.abs(c.btcDeviation) >= btcThreshold &&
                c.dirReversals <= maxReversals &&
                ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
                 (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
            );
            addResult(`方向一致 & BTC>=$${btcThreshold} & 反转<=${maxReversals}`, filtered);
        }
    }

    // 搜索4：方向一致 + BTC动量一致
    for (const btcThreshold of [0, 20, 30, 40, 50]) {
        for (const btcMomThreshold of [0, 5, 10, 15, 20]) {
            const filtered = cyclesAt780.filter(c => 
                Math.abs(c.btcDeviation) >= btcThreshold &&
                Math.abs(c.btcMomentum) >= btcMomThreshold &&
                ((c.leadingDir === 'UP' && c.btcDeviation > 0 && c.btcMomentum > 0) ||
                 (c.leadingDir === 'DOWN' && c.btcDeviation < 0 && c.btcMomentum < 0))
            );
            addResult(`方向一致 & BTC>=$${btcThreshold} & BTC动量>=$${btcMomThreshold}`, filtered);
        }
    }

    // 搜索5：方向一致 + 领先持续时间
    for (const btcThreshold of [0, 20, 30, 40]) {
        for (const minDuration of [60, 120, 180, 300, 400, 500]) {
            const filtered = cyclesAt780.filter(c => 
                Math.abs(c.btcDeviation) >= btcThreshold &&
                c.leadingDuration >= minDuration &&
                ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
                 (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
            );
            addResult(`方向一致 & BTC>=$${btcThreshold} & 持续>=${minDuration}s`, filtered);
        }
    }

    // 搜索6：方向一致 + 价差稳定性
    for (const btcThreshold of [0, 20, 30, 40]) {
        for (const maxStability of [0.2, 0.15, 0.1, 0.08, 0.05]) {
            const filtered = cyclesAt780.filter(c => 
                Math.abs(c.btcDeviation) >= btcThreshold &&
                c.priceStability <= maxStability &&
                ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
                 (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
            );
            addResult(`方向一致 & BTC>=$${btcThreshold} & 稳定性<=${maxStability}`, filtered);
        }
    }

    // 搜索7：组合多个新指标
    for (const btcThreshold of [20, 30, 40]) {
        for (const trendStrength of [0.8, 0.9]) {
            for (const maxReversals of [3, 2, 1]) {
                const filtered = cyclesAt780.filter(c => 
                    Math.abs(c.btcDeviation) >= btcThreshold &&
                    c.btcTrendStrength >= trendStrength &&
                    c.dirReversals <= maxReversals &&
                    ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
                     (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
                );
                addResult(`方向一致 & BTC>=$${btcThreshold} & 趋势>=${trendStrength} & 反转<=${maxReversals}`, filtered);
            }
        }
    }

    // 按评分排序
    allResults.sort((a, b) => b.score - a.score);

    console.log('\n前10最优条件:');
    console.log('  排名 | 条件                                   | 交易 | 胜率     | PNL       | ROI      | 评分');
    console.log('  ' + '-'.repeat(105));
    
    for (let i = 0; i < Math.min(10, allResults.length); i++) {
        const r = allResults[i];
        console.log(`  ${(i + 1).toString().padEnd(4)} | ${r.desc.padEnd(38)} | ${r.trades.toString().padEnd(4)} | ${r.winRate.toFixed(2).padEnd(8)}% | $${r.pnl.toFixed(4).padEnd(8)} | ${r.roi.toFixed(2).padEnd(7)}% | ${r.score.toFixed(2)}`);
    }

    // 按胜率排序（交易数>=10）
    const highWinRateResults = allResults.filter(r => r.trades >= 10).sort((a, b) => b.winRate - a.winRate);
    console.log('\n胜率最高的条件（交易数>=10）:');
    console.log('  排名 | 条件                                   | 交易 | 胜率     | PNL       | ROI');
    console.log('  ' + '-'.repeat(95));
    
    for (let i = 0; i < Math.min(5, highWinRateResults.length); i++) {
        const r = highWinRateResults[i];
        console.log(`  ${(i + 1).toString().padEnd(4)} | ${r.desc.padEnd(38)} | ${r.trades.toString().padEnd(4)} | ${r.winRate.toFixed(2).padEnd(8)}% | $${r.pnl.toFixed(4).padEnd(8)} | ${r.roi.toFixed(2)}%`);
    }

    // 按PNL排序
    const highPnlResults = [...allResults].sort((a, b) => b.pnl - a.pnl);
    console.log('\nPNL最高的条件:');
    console.log('  排名 | 条件                                   | 交易 | 胜率     | PNL       | ROI');
    console.log('  ' + '-'.repeat(95));
    
    for (let i = 0; i < Math.min(5, highPnlResults.length); i++) {
        const r = highPnlResults[i];
        console.log(`  ${(i + 1).toString().padEnd(4)} | ${r.desc.padEnd(38)} | ${r.trades.toString().padEnd(4)} | ${r.winRate.toFixed(2).padEnd(8)}% | $${r.pnl.toFixed(4).padEnd(8)} | ${r.roi.toFixed(2)}%`);
    }

    // ========== 780秒 + S36 组合最优搜索 ==========
    console.log('\n' + '='.repeat(120));
    console.log('⭐ 780秒 + S36 组合策略最优搜索');
    console.log('='.repeat(120));

    interface CombinedResult {
        desc: string;
        cycles: number;
        totalTrades: number;
        wins780: number;
        winsS36: number;
        totalWins: number;
        pnl780: number;
        pnlS36: number;
        totalPnl: number;
        totalCost: number;
        winRate780: number;
        winRateS36: number;
        totalWinRate: number;
        roi: number;
        score: number;
    }

    const combinedResults: CombinedResult[] = [];

    // 搜索不同条件组合
    for (const btcThreshold of [0, 20, 30, 40, 50, 60]) {
        for (const priceDiffThreshold of [0, 0.1, 0.15, 0.2]) {
            const condition = (c: CycleAt780) => 
                Math.abs(c.btcDeviation) >= btcThreshold &&
                Math.abs(c.priceDiff) >= priceDiffThreshold &&
                ((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
                 (c.leadingDir === 'DOWN' && c.btcDeviation < 0));
            
            const filteredCycles = cyclesAt780.filter(condition);
            if (filteredCycles.length < 5) continue;

            let totalTrades = 0;
            let wins780 = 0;
            let winsS36 = 0;
            let pnl780 = 0;
            let pnlS36 = 0;
            let cost780 = 0;
            let costS36 = 0;

            for (const c of filteredCycles) {
                // 780秒买入
                totalTrades++;
                const buyPrice = c.leadingDir === 'UP' ? c.upPrice : c.downPrice;
                cost780 += buyPrice;
                if (c.leadingDir === c.actualOutcome) {
                    wins780++;
                    pnl780 += 1 - buyPrice;
                } else {
                    pnl780 -= buyPrice;
                }

                // S36追加买入
                if (c.s36TriggeredAfter780 && c.s36Direction && c.s36BuyPrice) {
                    totalTrades++;
                    costS36 += c.s36BuyPrice;
                    if (c.s36Direction === c.actualOutcome) {
                        winsS36++;
                        pnlS36 += 1 - c.s36BuyPrice;
                    } else {
                        pnlS36 -= c.s36BuyPrice;
                    }
                }
            }

            const totalPnl = pnl780 + pnlS36;
            const totalCost = cost780 + costS36;
            const totalWins = wins780 + winsS36;
            const winRate780 = wins780 / filteredCycles.length * 100;
            const s36Trades = totalTrades - filteredCycles.length;
            const winRateS36 = s36Trades > 0 ? winsS36 / s36Trades * 100 : 0;
            const totalWinRate = totalWins / totalTrades * 100;
            const roi = totalCost > 0 ? totalPnl / totalCost * 100 : 0;
            const score = roi * Math.sqrt(totalTrades) * (totalWinRate / 50);

            combinedResults.push({
                desc: `方向一致 & BTC>=$${btcThreshold} & 差>=${priceDiffThreshold.toFixed(2)}`,
                cycles: filteredCycles.length,
                totalTrades,
                wins780,
                winsS36,
                totalWins,
                pnl780,
                pnlS36,
                totalPnl,
                totalCost,
                winRate780,
                winRateS36,
                totalWinRate,
                roi,
                score
            });
        }
    }

    // 按总PNL排序
    combinedResults.sort((a, b) => b.totalPnl - a.totalPnl);

    console.log('\n组合策略排行（按总PNL）:');
    console.log('  条件                                | 周期 | 总交易 | 780胜率 | S36胜率 | 总胜率  | 总PNL      | ROI');
    console.log('  ' + '-'.repeat(110));

    for (let i = 0; i < Math.min(10, combinedResults.length); i++) {
        const r = combinedResults[i];
        const winRateS36Str = r.totalTrades > r.cycles ? r.winRateS36.toFixed(1) + '%' : 'N/A';
        console.log(`  ${r.desc.padEnd(37)} | ${r.cycles.toString().padEnd(4)} | ${r.totalTrades.toString().padEnd(6)} | ${r.winRate780.toFixed(1).padEnd(7)}% | ${winRateS36Str.padEnd(7)} | ${r.totalWinRate.toFixed(1).padEnd(6)}% | $${r.totalPnl.toFixed(4).padEnd(9)} | ${r.roi.toFixed(2)}%`);
    }

    // 按综合评分排序
    const byScore = [...combinedResults].sort((a, b) => b.score - a.score);
    console.log('\n组合策略排行（按综合评分）:');
    console.log('  条件                                | 周期 | 总交易 | 780胜率 | S36胜率 | 总PNL      | 评分');
    console.log('  ' + '-'.repeat(105));

    for (let i = 0; i < Math.min(5, byScore.length); i++) {
        const r = byScore[i];
        const winRateS36Str = r.totalTrades > r.cycles ? r.winRateS36.toFixed(1) + '%' : 'N/A';
        console.log(`  ${r.desc.padEnd(37)} | ${r.cycles.toString().padEnd(4)} | ${r.totalTrades.toString().padEnd(6)} | ${r.winRate780.toFixed(1).padEnd(7)}% | ${winRateS36Str.padEnd(7)} | $${r.totalPnl.toFixed(4).padEnd(9)} | ${r.score.toFixed(2)}`);
    }

    // ========== 输局分析 ==========
    console.log('\n' + '='.repeat(120));
    console.log('输局分析：780秒顺势买入但最终输了的周期');
    console.log('='.repeat(120));

    const lossCycles = cyclesAt780.filter(c => c.leadingDir !== c.actualOutcome);
    console.log(`\n输局数: ${lossCycles.length}/${cyclesAt780.length} (${(lossCycles.length / cyclesAt780.length * 100).toFixed(2)}%)`);

    if (lossCycles.length > 0) {
        console.log('\n输局详情（前20个）:');
        console.log('  CycleID      | 780秒领先 | 最终结果 | BTC偏移    | UP价格 | DOWN价格 | 价差     | 方向一致');
        console.log('  ' + '-'.repeat(100));

        for (const c of lossCycles.slice(0, 20)) {
            const btcDevStr = (c.btcDeviation >= 0 ? '+' : '') + c.btcDeviation.toFixed(2);
            const aligned = (c.leadingDir === 'UP' && c.btcDeviation > 0) || (c.leadingDir === 'DOWN' && c.btcDeviation < 0);
            console.log(`  ${c.cycleId} | ${c.leadingDir.padEnd(9)} | ${c.actualOutcome.padEnd(8)} | $${btcDevStr.padEnd(9)} | ${c.upPrice.toFixed(4)} | ${c.downPrice.toFixed(4)} | ${c.priceDiff.toFixed(4).padEnd(8)} | ${aligned ? '是' : '否'}`);
        }

        // 分析输局特征
        console.log('\n输局特征分析:');
        const avgLossPriceDiff = lossCycles.reduce((sum, c) => sum + Math.abs(c.priceDiff), 0) / lossCycles.length;
        const avgLossBtcDev = lossCycles.reduce((sum, c) => sum + Math.abs(c.btcDeviation), 0) / lossCycles.length;
        const winCycles = cyclesAt780.filter(c => c.leadingDir === c.actualOutcome);
        const avgWinPriceDiff = winCycles.reduce((sum, c) => sum + Math.abs(c.priceDiff), 0) / winCycles.length;
        const avgWinBtcDev = winCycles.reduce((sum, c) => sum + Math.abs(c.btcDeviation), 0) / winCycles.length;

        console.log(`  输局平均价差: ${avgLossPriceDiff.toFixed(4)} vs 赢局平均: ${avgWinPriceDiff.toFixed(4)}`);
        console.log(`  输局平均BTC偏移: $${avgLossBtcDev.toFixed(2)} vs 赢局平均: $${avgWinBtcDev.toFixed(2)}`);

        // 输局中方向不一致的比例
        const lossNotAligned = lossCycles.filter(c => 
            !((c.leadingDir === 'UP' && c.btcDeviation > 0) ||
              (c.leadingDir === 'DOWN' && c.btcDeviation < 0))
        );
        console.log(`  输局中"价格领先方向≠BTC偏移方向"的比例: ${(lossNotAligned.length / lossCycles.length * 100).toFixed(1)}%`);
        console.log(`  → 如果只在方向一致时交易，可以过滤掉 ${lossNotAligned.length} 个输局`);
    }

    // ========== 最终策略总结 ==========
    console.log('\n' + '='.repeat(120));
    console.log('💡 最终策略总结');
    console.log('='.repeat(120));
    
    if (allResults.length > 0) {
        const best = allResults[0];
        const bestWinRate = highWinRateResults.length > 0 ? highWinRateResults[0] : null;
        const bestPnl = highPnlResults[0];

        console.log('\n综合最优策略（平衡胜率、PNL、交易量）:');
        console.log(`  条件: ${best.desc}`);
        console.log(`  胜率: ${best.winRate.toFixed(2)}%`);
        console.log(`  交易数: ${best.trades}`);
        console.log(`  总PNL: $${best.pnl.toFixed(4)}`);
        console.log(`  ROI: ${best.roi.toFixed(2)}%`);

        if (bestWinRate && bestWinRate.winRate > best.winRate) {
            console.log('\n最高胜率策略（保守）:');
            console.log(`  条件: ${bestWinRate.desc}`);
            console.log(`  胜率: ${bestWinRate.winRate.toFixed(2)}%`);
            console.log(`  交易数: ${bestWinRate.trades}`);
            console.log(`  总PNL: $${bestWinRate.pnl.toFixed(4)}`);
        }

        if (bestPnl.pnl > best.pnl) {
            console.log('\n最高PNL策略（激进）:');
            console.log(`  条件: ${bestPnl.desc}`);
            console.log(`  胜率: ${bestPnl.winRate.toFixed(2)}%`);
            console.log(`  交易数: ${bestPnl.trades}`);
            console.log(`  总PNL: $${bestPnl.pnl.toFixed(4)}`);
        }
    }

    // 组合策略推荐
    if (combinedResults.length > 0) {
        const bestCombined = combinedResults[0];
        console.log('\n780秒 + S36 组合策略（推荐）:');
        console.log(`  条件: ${bestCombined.desc}`);
        console.log(`  参与周期: ${bestCombined.cycles}`);
        console.log(`  总交易数: ${bestCombined.totalTrades}`);
        console.log(`  780秒胜率: ${bestCombined.winRate780.toFixed(2)}%`);
        console.log(`  S36胜率: ${bestCombined.totalTrades > bestCombined.cycles ? bestCombined.winRateS36.toFixed(2) + '%' : 'N/A'}`);
        console.log(`  总PNL: $${bestCombined.totalPnl.toFixed(4)} (780秒: $${bestCombined.pnl780.toFixed(4)}, S36: $${bestCombined.pnlS36.toFixed(4)})`);
        console.log(`  总ROI: ${bestCombined.roi.toFixed(2)}%`);
    }

    console.log('\n要接近100%胜率的核心原则:');
    console.log('1. 只在"价格领先方向 = BTC偏移方向"时交易（方向一致）');
    console.log('2. 要求BTC偏移足够大（过滤噪音）');
    console.log('3. 要求价差足够大（市场共识明确）');
    console.log('4. 780秒后如果触发S36，可以追加买入增加收益');
    console.log('5. 代价是交易次数减少，但每次交易确定性更高');
}

runAnalysis();
