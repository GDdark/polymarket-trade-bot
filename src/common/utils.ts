import { BigNumberish, toBeHex } from 'ethers';
import fnv from 'fnv-plus';
import Util from 'util';

export function dump(obj: any) {
    return Util.inspect(obj, { showHidden: false, depth: null, colors: true });
}

export function canRunCron() {
    if (!!process.env.EXECUTE_MODE) {
        return false;
    }

    return true;
}

export function toBeHexTrimZero(s: BigNumberish) {
    const result = toBeHex(s);
    if (result.startsWith('0x0')) {
        return `0x${result.slice(3)}`;
    }

    return result;
}

export function getCurrentYearMonth(date?: Date) {
    const currentDate = date || new Date();

    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    return `${currentYear}${currentMonth.toString().padStart(2, '0')}`;
}

export function hash64(s: string) {
    return fnv.hash(s.toLowerCase(), 64).dec();
}