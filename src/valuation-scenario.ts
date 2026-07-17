export interface ValuationScenario {
	id: string;
	name: string;
	description: string;
	netIncome: number;
	per: number;
	marketCap: number;
	totalShares: number;
	fairPrice: number;
	currentPrice: number;
	potentialPercent: number;
	createdAt: string;
}

export interface ValuationScenarioSnapshotInput {
	name: string;
	description: string;
	netIncome: number;
	per: number;
	totalShares: number;
	currentPrice: number;
}

export function createValuationScenario(
	input: ValuationScenarioSnapshotInput,
): ValuationScenario {
	return createScenarioValues({
		id: createId(),
		createdAt: new Date().toISOString(),
		input,
	});
}

export function updateValuationScenario(
	scenario: ValuationScenario,
	input: ValuationScenarioSnapshotInput,
): ValuationScenario {
	return createScenarioValues({
		id: scenario.id,
		createdAt: scenario.createdAt,
		input,
	});
}

function createScenarioValues(options: {
	id: string;
	createdAt: string;
	input: ValuationScenarioSnapshotInput;
}): ValuationScenario {
	const { id, createdAt, input } = options;
	const marketCap = input.netIncome * input.per;
	const fairPrice = (marketCap * 100_000_000) / input.totalShares;

	return {
		id,
		name: input.name.trim(),
		description: input.description.trim(),
		netIncome: input.netIncome,
		per: input.per,
		marketCap,
		totalShares: input.totalShares,
		fairPrice,
		currentPrice: input.currentPrice,
		potentialPercent: (fairPrice / input.currentPrice - 1) * 100,
		createdAt,
	};
}

export function normalizeValuationScenarios(value: unknown): ValuationScenario[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(isValuationScenario).map((scenario) => ({ ...scenario }));
}

function isValuationScenario(value: unknown): value is ValuationScenario {
	if (value === null || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<ValuationScenario>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.description === 'string' &&
		isPositiveNumber(candidate.netIncome) &&
		isPositiveNumber(candidate.per) &&
		isPositiveNumber(candidate.marketCap) &&
		isPositiveNumber(candidate.totalShares) &&
		isPositiveNumber(candidate.fairPrice) &&
		isPositiveNumber(candidate.currentPrice) &&
		typeof candidate.potentialPercent === 'number' &&
		Number.isFinite(candidate.potentialPercent) &&
		typeof candidate.createdAt === 'string' &&
		!Number.isNaN(Date.parse(candidate.createdAt))
	);
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function createId(): string {
	if (typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return Math.random().toString(36).slice(2);
}
