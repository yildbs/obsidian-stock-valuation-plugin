import { requestUrl } from 'obsidian';

export interface LivePriceResult {
	ok: boolean;
	price: number | null;
	marketTimeSec: number | null;
	message: string;
	yahooSymbol: string | null;
}

interface CachedLivePrice {
	result: LivePriceResult;
	fetchedAt: number;
}

interface NormalizedSymbol {
	display: string;
	yahooCode: string | null;
	missing: string | null;
}

interface NormalizedMarket {
	display: string;
	yahooSuffix: string | null;
	missing: string | null;
}

const CACHE_TTL_MS = 60_000;
const YAHOO_RANGE = '1d';
const YAHOO_INTERVAL = '1m';
const priceCache = new Map<string, CachedLivePrice>();

export async function fetchLivePrice(
	frontmatter: unknown,
	forceRefresh: boolean,
): Promise<LivePriceResult> {
	const data = isRecord(frontmatter) ? frontmatter : {};
	const symbol = normalizeSymbol(data.symbol);
	const market = normalizeMarket(data.market);

	if (symbol.yahooCode === null || market.yahooSuffix === null) {
		const reasons = [symbol.missing, market.missing].filter(
			(reason): reason is string => reason !== null,
		);

		return {
			ok: false,
			price: null,
			marketTimeSec: null,
			message:
				reasons.length > 0
					? reasons.join(', ')
					: 'frontmatter에 symbol과 market을 입력해주세요.',
			yahooSymbol: null,
		};
	}

	const yahooSymbol = `${symbol.yahooCode}.${market.yahooSuffix}`;
	const cached = priceCache.get(yahooSymbol);
	if (
		cached !== undefined &&
		!forceRefresh &&
		Date.now() - cached.fetchedAt < CACHE_TTL_MS
	) {
		return cached.result;
	}

	const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${YAHOO_INTERVAL}&range=${YAHOO_RANGE}`;

	try {
		const response = await requestUrl({ url });
		const result = getYahooChartResult(response.json);
		const meta = getRecord(result.meta);
		const price = getNumber(meta.regularMarketPrice);
		const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
		const fallbackTime = getNumber(timestamps[timestamps.length - 1]);
		const marketTimeSec =
			getNumber(meta.regularMarketTime) ?? fallbackTime;

		if (price === null) {
			throw new Error('Yahoo 응답에 현재가가 없습니다.');
		}

		const livePrice: LivePriceResult = {
			ok: true,
			price,
			marketTimeSec,
			message: '',
			yahooSymbol,
		};
		priceCache.set(yahooSymbol, {
			result: livePrice,
			fetchedAt: Date.now(),
		});

		return livePrice;
	} catch (error) {
		const livePrice: LivePriceResult = {
			ok: false,
			price: null,
			marketTimeSec: null,
			message: `현재가 조회 실패: ${getErrorMessage(error)}`,
			yahooSymbol,
		};
		priceCache.set(yahooSymbol, {
			result: livePrice,
			fetchedAt: Date.now(),
		});

		return livePrice;
	}
}

export function formatLivePriceTime(timestampSec: number | null): string {
	if (timestampSec === null || !Number.isFinite(timestampSec)) {
		return '';
	}

	const parts = new Intl.DateTimeFormat('ko-KR', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
		.formatToParts(new Date(timestampSec * 1000))
		.reduce<Record<string, string>>((acc, part) => {
			acc[part.type] = part.value;
			return acc;
		}, {});

	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function normalizeSymbol(value: unknown): NormalizedSymbol {
	const raw = valueToString(value);
	if (raw.length === 0) {
		return {
			display: 'symbol 없음',
			yahooCode: null,
			missing: 'frontmatter에 symbol이 없습니다.',
		};
	}

	const digits = raw.replace(/[^\d]/g, '');
	if (digits.length > 0 && digits.length <= 6) {
		const code = digits.padStart(6, '0');
		return {
			display: code,
			yahooCode: code,
			missing: null,
		};
	}

	return {
		display: raw,
		yahooCode: null,
		missing: `symbol 형식을 확인해주세요: ${raw}`,
	};
}

function normalizeMarket(value: unknown): NormalizedMarket {
	const raw = valueToString(value);
	const upper = raw.toUpperCase();

	if (upper.length === 0) {
		return {
			display: 'market 없음',
			yahooSuffix: null,
			missing: 'frontmatter에 market이 없습니다.',
		};
	}

	if (upper === 'KOSPI' || upper === 'KS') {
		return {
			display: 'KOSPI',
			yahooSuffix: 'KS',
			missing: null,
		};
	}

	if (upper === 'KOSDAQ' || upper === 'KQ') {
		return {
			display: 'KOSDAQ',
			yahooSuffix: 'KQ',
			missing: null,
		};
	}

	return {
		display: raw,
		yahooSuffix: null,
		missing: `지원하지 않는 market입니다: ${raw}`,
	};
}

function valueToString(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (Array.isArray(value)) {
		return value.map(valueToString).filter(Boolean)[0] ?? '';
	}
	if (
		typeof value !== 'string' &&
		typeof value !== 'number' &&
		typeof value !== 'boolean'
	) {
		return '';
	}

	return String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (
		typeof error !== 'string' &&
		typeof error !== 'number' &&
		typeof error !== 'boolean'
	) {
		return '알 수 없는 오류';
	}

	return String(error);
}

function getYahooChartResult(json: unknown): Record<string, unknown> {
	const root = getRecord(json);
	const chart = getRecord(root.chart);
	const results: unknown[] = Array.isArray(chart.result)
		? (chart.result as unknown[])
		: [];
	const result = results[0];

	if (!isRecord(result)) {
		throw new Error('Yahoo 응답 형식이 올바르지 않습니다.');
	}

	return result;
}

function getRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function getNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
