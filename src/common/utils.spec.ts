import { canRunCron, toBeHexTrimZero, getCurrentYearMonth } from './utils';

describe('utils', () => {
    describe('canRunCron', () => {
        const originalEnv = process.env.EXECUTE_MODE;

        afterEach(() => {
            if (originalEnv === undefined) {
                delete process.env.EXECUTE_MODE;
            } else {
                process.env.EXECUTE_MODE = originalEnv;
            }
        });

        it('EXECUTE_MODE 未设置时返回 true', () => {
            delete process.env.EXECUTE_MODE;
            expect(canRunCron()).toBe(true);
        });

        it('EXECUTE_MODE 已设置时返回 false', () => {
            process.env.EXECUTE_MODE = 'console';
            expect(canRunCron()).toBe(false);
        });
    });

    describe('toBeHexTrimZero', () => {
        it('去除前导零', () => {
            expect(toBeHexTrimZero(1)).toBe('0x1');
        });

        it('保留非零前缀', () => {
            expect(toBeHexTrimZero(256)).toBe('0x100');
        });
    });

    describe('getCurrentYearMonth', () => {
        it('返回正确的年月格式', () => {
            const date = new Date('2026-02-27');
            expect(getCurrentYearMonth(date)).toBe('202602');
        });

        it('月份补零', () => {
            const date = new Date('2026-01-15');
            expect(getCurrentYearMonth(date)).toBe('202601');
        });

        it('不传参时使用当前时间', () => {
            const result = getCurrentYearMonth();
            expect(result).toMatch(/^\d{6}$/);
        });
    });
});
