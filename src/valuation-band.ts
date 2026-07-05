export interface ValuationBandInput {
	operatingProfitMin: string;
	operatingProfitMax: string;
	perMin: string;
	perMax: string;
	totalShares: string;
}

export type ValuationBandResult =
	| {
			ok: true;
			text: string;
	  }
	| {
			ok: false;
			message: string;
	  };

interface ParsedValuationBandInput {
	operatingProfitMin: number;
	operatingProfitMax: number;
	perMin: number;
	perMax: number;
	totalShares?: number;
}

const NUMBER_PATTERN = /^-?(?:\d+|\d*\.\d+)$/;

export function createValuationBandText(
	input: ValuationBandInput,
): ValuationBandResult {
	const parsed = parseInput(input);
	if (!parsed.ok) {
		return parsed;
	}

	const { operatingProfitMin, operatingProfitMax, perMin, perMax } =
		parsed.value;
	const marketCapMin = operatingProfitMin * perMin;
	const marketCapMax = operatingProfitMax * perMax;
	const lines = [
		`예상 영업이익: ${formatNumber(operatingProfitMin)}억 ~ ${formatNumber(operatingProfitMax)}억`,
		`예상 PER: ${input.perMin.trim()} ~ ${input.perMax.trim()}`,
		`예상 기업 가치: ${formatNumber(marketCapMin)}억 ~ ${formatNumber(marketCapMax)}억`,
	];

	if (parsed.value.totalShares !== undefined) {
		const priceMin = (marketCapMin * 100_000_000) / parsed.value.totalShares;
		const priceMax = (marketCapMax * 100_000_000) / parsed.value.totalShares;
		lines.push(`총 주식 수: ${formatNumber(parsed.value.totalShares)}주`);
		lines.push(
			`예상 주가: ${formatPrice(priceMin)}원 ~ ${formatPrice(priceMax)}원`,
		);
	}

	return {
		ok: true,
		text: lines.join('\n'),
	};
}

function parseInput(input: ValuationBandInput):
	| {
			ok: true;
			value: ParsedValuationBandInput;
	  }
	| {
			ok: false;
			message: string;
	  } {
	const trimmed = {
		operatingProfitMin: input.operatingProfitMin.trim(),
		operatingProfitMax: input.operatingProfitMax.trim(),
		perMin: input.perMin.trim(),
		perMax: input.perMax.trim(),
		totalShares: input.totalShares.trim(),
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
	];

	if (requiredValues.some((value) => value.length === 0)) {
		return { ok: false, message: '모든 값을 입력해주세요.' };
	}

	if (providedValues.some((value) => !NUMBER_PATTERN.test(value))) {
		return { ok: false, message: '숫자만 입력할 수 있습니다.' };
	}

	const parsed: ParsedValuationBandInput = {
		operatingProfitMin: Number(trimmed.operatingProfitMin),
		operatingProfitMax: Number(trimmed.operatingProfitMax),
		perMin: Number(trimmed.perMin),
		perMax: Number(trimmed.perMax),
		...(trimmed.totalShares.length > 0
			? { totalShares: Number(trimmed.totalShares) }
			: {}),
	};

	if (Object.values(parsed).some((value) => value <= 0)) {
		return { ok: false, message: '0보다 큰 값을 입력해주세요.' };
	}

	if (
		parsed.operatingProfitMin > parsed.operatingProfitMax ||
		parsed.perMin > parsed.perMax
	) {
		return { ok: false, message: '최소값은 최대값보다 클 수 없습니다.' };
	}

	return { ok: true, value: parsed };
}

function formatNumber(value: number): string {
	return value.toLocaleString('en-US', {
		maximumFractionDigits: 10,
	});
}

function formatPrice(value: number): string {
	return Math.round(value).toLocaleString('en-US');
}
