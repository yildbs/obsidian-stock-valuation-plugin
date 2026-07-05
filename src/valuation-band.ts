export interface ValuationBandInput {
	operatingProfitMin: string;
	operatingProfitMid: string;
	operatingProfitMax: string;
	perMin: string;
	perMid: string;
	perMax: string;
	totalShares: string;
	currentPrice: string;
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
	operatingProfitMid: number;
	operatingProfitMax: number;
	perMin: number;
	perMid: number;
	perMax: number;
	totalShares?: number;
	currentPrice?: number;
}

const NUMBER_PATTERN = /^-?(?:\d+|\d*\.\d+)$/;

export function createValuationBandText(
	input: ValuationBandInput,
): ValuationBandResult {
	const parsed = parseInput(input);
	if (!parsed.ok) {
		return parsed;
	}

	const {
		operatingProfitMin,
		operatingProfitMid,
		operatingProfitMax,
		perMin,
		perMid,
		perMax,
	} = parsed.value;
	const marketCapMin = operatingProfitMin * perMin;
	const marketCapMid = operatingProfitMid * perMid;
	const marketCapMax = operatingProfitMax * perMax;
	const lines = [
		`예상 영업이익: ${formatNumber(operatingProfitMin)}억 ~ ${formatNumber(operatingProfitMid)}억 ~ ${formatNumber(operatingProfitMax)}억`,
		`예상 PER: ${formatNumber(perMin)} ~ ${formatNumber(perMid)} ~ ${formatNumber(perMax)}`,
		`예상 기업 가치: ${formatNumber(marketCapMin)}억 ~ ${formatNumber(marketCapMid)}억 ~ ${formatNumber(marketCapMax)}억`,
	];

	if (parsed.value.totalShares !== undefined) {
		const priceMin = (marketCapMin * 100_000_000) / parsed.value.totalShares;
		const priceMid = (marketCapMid * 100_000_000) / parsed.value.totalShares;
		const priceMax = (marketCapMax * 100_000_000) / parsed.value.totalShares;
		lines.push(`총 주식 수: ${formatNumber(parsed.value.totalShares)}주`);
		lines.push(
			`예상 주가: ${formatPrice(priceMin)}원 ~ ${formatPrice(priceMid)}원 ~ ${formatPrice(priceMax)}원`,
		);

		if (parsed.value.currentPrice !== undefined) {
			const downsidePotential = (priceMin / parsed.value.currentPrice - 1) * 100;
			const basePotential = (priceMid / parsed.value.currentPrice - 1) * 100;
			const upsidePotential = (priceMax / parsed.value.currentPrice - 1) * 100;
			lines.push(`현재 주가: ${formatPrice(parsed.value.currentPrice)}원`);
			lines.push(
				`현재가 대비 예상 여력: ${formatPercent(downsidePotential)} ~ ${formatPercent(basePotential)} ~ ${formatPercent(upsidePotential)}`,
			);
		}
	} else if (parsed.value.currentPrice !== undefined) {
		lines.push('주식의 총수를 입력해야 여력 밴드를 계산할수 있습니다');
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
		operatingProfitMid: input.operatingProfitMid.trim(),
		operatingProfitMax: input.operatingProfitMax.trim(),
		perMin: input.perMin.trim(),
		perMid: input.perMid.trim(),
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
		...(trimmed.operatingProfitMid.length > 0
			? [trimmed.operatingProfitMid]
			: []),
		...(trimmed.perMid.length > 0 ? [trimmed.perMid] : []),
		...(trimmed.totalShares.length > 0 ? [trimmed.totalShares] : []),
		...(trimmed.currentPrice.length > 0 ? [trimmed.currentPrice] : []),
	];

	if (requiredValues.some((value) => value.length === 0)) {
		return { ok: false, message: '모든 값을 입력해주세요.' };
	}

	if (providedValues.some((value) => !NUMBER_PATTERN.test(value))) {
		return { ok: false, message: '숫자만 입력할 수 있습니다.' };
	}

	const operatingProfitMin = Number(trimmed.operatingProfitMin);
	const operatingProfitMax = Number(trimmed.operatingProfitMax);
	const perMin = Number(trimmed.perMin);
	const perMax = Number(trimmed.perMax);
	const parsed: ParsedValuationBandInput = {
		operatingProfitMin,
		operatingProfitMid:
			trimmed.operatingProfitMid.length > 0
				? Number(trimmed.operatingProfitMid)
				: average(operatingProfitMin, operatingProfitMax),
		operatingProfitMax,
		perMin,
		perMid:
			trimmed.perMid.length > 0 ? Number(trimmed.perMid) : average(perMin, perMax),
		perMax,
		...(trimmed.totalShares.length > 0
			? { totalShares: Number(trimmed.totalShares) }
			: {}),
		...(trimmed.currentPrice.length > 0
			? { currentPrice: Number(trimmed.currentPrice) }
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

	if (
		parsed.operatingProfitMid < parsed.operatingProfitMin ||
		parsed.operatingProfitMid > parsed.operatingProfitMax ||
		parsed.perMid < parsed.perMin ||
		parsed.perMid > parsed.perMax
	) {
		return { ok: false, message: '중간값은 최소값과 최대값 사이여야 합니다.' };
	}

	return { ok: true, value: parsed };
}

function average(a: number, b: number): number {
	return (a + b) / 2;
}

function formatNumber(value: number): string {
	return value.toLocaleString('en-US', {
		maximumFractionDigits: 10,
	});
}

function formatPrice(value: number): string {
	return Math.round(value).toLocaleString('en-US');
}

function formatPercent(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-US', {
		maximumFractionDigits: 1,
	})}%`;
}
