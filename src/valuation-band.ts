export interface ValuationBandInput {
	operatingProfitMin: string;
	operatingProfitMax: string;
	operatingProfitMidPercent: number;
	perMin: string;
	perMax: string;
	perMidPercent: number;
	totalShares: string;
	currentPrice: string;
	useLivePrice: boolean;
	lockMidMarketCap: boolean;
	lockedMidMarketCap: number | null;
}

export interface ValuationBandValues {
	operatingProfitMin: number;
	operatingProfitMid: number;
	operatingProfitMax: number;
	perMin: number;
	perMid: number;
	perMax: number;
	marketCapMin: number;
	marketCapMid: number;
	marketCapMax: number;
	totalShares?: number;
	currentPrice?: number;
	priceMin?: number;
	priceMid?: number;
	priceMax?: number;
	downsidePotential?: number;
	basePotential?: number;
	upsidePotential?: number;
}

export type ValuationBandResult =
	| {
			ok: true;
			values: ValuationBandValues;
			text: string;
	  }
	| {
			ok: false;
			message: string;
	  };

const NUMBER_PATTERN = /^-?(?:\d+|\d*\.\d+)$/;

export const DEFAULT_VALUATION_INPUT: ValuationBandInput = {
	operatingProfitMin: '',
	operatingProfitMax: '',
	operatingProfitMidPercent: 50,
	perMin: '',
	perMax: '',
	perMidPercent: 50,
	totalShares: '',
	currentPrice: '',
	useLivePrice: false,
	lockMidMarketCap: false,
	lockedMidMarketCap: null,
};

export function createValuationBandText(
	input: ValuationBandInput,
): ValuationBandResult {
	const parsed = calculateValuationBand(input);
	if (!parsed.ok) {
		return parsed;
	}

	return {
		ok: true,
		values: parsed.values,
		text: createResultText(parsed.values),
	};
}

export function calculateValuationBand(
	input: ValuationBandInput,
): ValuationBandResult {
	const trimmed = {
		operatingProfitMin: input.operatingProfitMin.trim(),
		operatingProfitMax: input.operatingProfitMax.trim(),
		perMin: input.perMin.trim(),
		perMax: input.perMax.trim(),
		totalShares: input.totalShares.trim(),
		currentPrice: input.currentPrice.trim(),
	};
	const requiredValues = [
		trimmed.operatingProfitMin,
		trimmed.operatingProfitMax,
		trimmed.perMin,
		trimmed.perMax,
	];
	const providedValues = [
		...requiredValues,
		...(trimmed.totalShares.length > 0 ? [trimmed.totalShares] : []),
		...(trimmed.currentPrice.length > 0 ? [trimmed.currentPrice] : []),
	];

	if (requiredValues.some((value) => value.length === 0)) {
		return { ok: false, message: '필수 값을 모두 입력해주세요.' };
	}

	if (providedValues.some((value) => !NUMBER_PATTERN.test(value))) {
		return { ok: false, message: '숫자만 입력할 수 있습니다.' };
	}

	const operatingProfitMin = Number(trimmed.operatingProfitMin);
	const operatingProfitMax = Number(trimmed.operatingProfitMax);
	const perMin = Number(trimmed.perMin);
	const perMax = Number(trimmed.perMax);
	const totalShares =
		trimmed.totalShares.length > 0 ? Number(trimmed.totalShares) : undefined;
	const currentPrice =
		trimmed.currentPrice.length > 0 ? Number(trimmed.currentPrice) : undefined;
	const valuesToValidate = [
		operatingProfitMin,
		operatingProfitMax,
		perMin,
		perMax,
		...(totalShares !== undefined ? [totalShares] : []),
		...(currentPrice !== undefined ? [currentPrice] : []),
	];

	if (valuesToValidate.some((value) => value <= 0)) {
		return { ok: false, message: '0보다 큰 값을 입력해주세요.' };
	}

	if (operatingProfitMin > operatingProfitMax || perMin > perMax) {
		return { ok: false, message: '최소값은 최대값보다 클 수 없습니다.' };
	}

	const operatingProfitMid = interpolate(
		operatingProfitMin,
		operatingProfitMax,
		input.operatingProfitMidPercent,
	);
	const perMid = interpolate(perMin, perMax, input.perMidPercent);
	const marketCapMin = operatingProfitMin * perMin;
	const marketCapMid = operatingProfitMid * perMid;
	const marketCapMax = operatingProfitMax * perMax;
	const values: ValuationBandValues = {
		operatingProfitMin,
		operatingProfitMid,
		operatingProfitMax,
		perMin,
		perMid,
		perMax,
		marketCapMin,
		marketCapMid,
		marketCapMax,
		...(totalShares !== undefined ? { totalShares } : {}),
		...(currentPrice !== undefined ? { currentPrice } : {}),
	};

	if (totalShares !== undefined) {
		const priceMin = (marketCapMin * 100_000_000) / totalShares;
		const priceMid = (marketCapMid * 100_000_000) / totalShares;
		const priceMax = (marketCapMax * 100_000_000) / totalShares;
		values.priceMin = priceMin;
		values.priceMid = priceMid;
		values.priceMax = priceMax;

		if (currentPrice !== undefined) {
			values.downsidePotential = (priceMin / currentPrice - 1) * 100;
			values.basePotential = (priceMid / currentPrice - 1) * 100;
			values.upsidePotential = (priceMax / currentPrice - 1) * 100;
		}
	}

	return {
		ok: true,
		values,
		text: createResultText(values),
	};
}

export function formatNumber(value: number): string {
	return value.toLocaleString('en-US', {
		maximumFractionDigits: 1,
	});
}

export function formatPrice(value: number): string {
	return Math.round(value).toLocaleString('en-US');
}

export function formatPercent(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-US', {
		maximumFractionDigits: 1,
	})}%`;
}

function interpolate(min: number, max: number, percent: number): number {
	const clampedPercent = Math.min(Math.max(percent, 0), 100);

	return min + (max - min) * (clampedPercent / 100);
}

function createResultText(values: ValuationBandValues): string {
	const lines = [
		`예상 연간 순이익: ${formatNumber(values.operatingProfitMin)}억 ~ ${formatNumber(values.operatingProfitMid)}억 ~ ${formatNumber(values.operatingProfitMax)}억`,
		`예상 PER: ${formatNumber(values.perMin)} ~ ${formatNumber(values.perMid)} ~ ${formatNumber(values.perMax)}`,
		`예상 시가총액: ${formatNumber(values.marketCapMin)}억 ~ ${formatNumber(values.marketCapMid)}억 ~ ${formatNumber(values.marketCapMax)}억`,
	];

	if (
		values.totalShares !== undefined &&
		values.priceMin !== undefined &&
		values.priceMid !== undefined &&
		values.priceMax !== undefined
	) {
		lines.push(`총 주식 수: ${formatNumber(values.totalShares)}주`);
		lines.push(
			`예상 주가: ${formatPrice(values.priceMin)}원 ~ ${formatPrice(values.priceMid)}원 ~ ${formatPrice(values.priceMax)}원`,
		);

		if (
			values.currentPrice !== undefined &&
			values.downsidePotential !== undefined &&
			values.basePotential !== undefined &&
			values.upsidePotential !== undefined
		) {
			lines.push(`현재 주가: ${formatPrice(values.currentPrice)}원`);
			lines.push(
				`현재가 대비 예상 여력: ${formatPercent(values.downsidePotential)} ~ ${formatPercent(values.basePotential)} ~ ${formatPercent(values.upsidePotential)}`,
			);
		}
	} else if (values.currentPrice !== undefined) {
		lines.push('총 주식 수를 입력해야 현재가 대비 예상 여력을 계산할 수 있습니다.');
	}

	return lines.join('\n');
}
