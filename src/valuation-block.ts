import { MarkdownRenderChild, Notice } from 'obsidian';
import {
	calculateValuationBand,
	createValuationBandText,
	formatNumber,
	formatPercent,
	formatPrice,
	ValuationBandInput,
} from './valuation-band';

type TextValuationInputKey = Exclude<
	keyof ValuationBandInput,
	'operatingProfitMidPercent' | 'perMidPercent'
>;
type PercentValuationInputKey =
	| 'operatingProfitMidPercent'
	| 'perMidPercent';

export interface ValuationBlockHost {
	getValuationInput(guid: string): ValuationBandInput;
	updateValuationInput(
		guid: string,
		patch: Partial<ValuationBandInput>,
		sourceId?: string,
	): void;
	subscribeValuation(
		guid: string,
		listener: (sourceId?: string) => void,
	): () => void;
}

const COPY_SUCCESS_MESSAGE = '계산 결과를 클립보드에 복사했습니다.';
const NUMBER_PATTERN = /^-?(?:\d+|\d*\.\d+)$/;

export class ValuationBlockRenderer extends MarkdownRenderChild {
	private readonly instanceId = createInstanceId();
	private unsubscribe: (() => void) | null = null;
	private resultEl: HTMLElement | null = null;
	private copyButtonEl: HTMLButtonElement | null = null;
	private operatingProfitMidEl: HTMLElement | null = null;
	private perMidEl: HTMLElement | null = null;
	private inputEls = new Map<keyof ValuationBandInput, HTMLInputElement>();

	constructor(
		containerEl: HTMLElement,
		private readonly guid: string,
		private readonly host: ValuationBlockHost,
	) {
		super(containerEl);
	}

	onload(): void {
		this.unsubscribe = this.host.subscribeValuation(this.guid, (sourceId) => {
			if (sourceId === this.instanceId) {
				return;
			}

			this.syncControls();
			this.updateCalculatedView();
		});
		this.render();
	}

	onunload(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private render(): void {
		const input = this.host.getValuationInput(this.guid);
		this.containerEl.empty();
		this.inputEls.clear();
		this.containerEl.addClass('stock-valuation-block');

		const headerEl = this.containerEl.createDiv({
			cls: 'stock-valuation-block-header',
		});
		headerEl.createEl('h4', { text: '주식 가치 밴드 계산기' });
		headerEl.createEl('span', {
			text: this.guid,
			cls: 'stock-valuation-guid',
		});

		const tableEl = this.containerEl.createEl('table', {
			cls: 'stock-valuation-input-table',
		});
		const theadEl = tableEl.createEl('thead');
		const headerRowEl = theadEl.createEl('tr');
		headerRowEl.createEl('th');
		headerRowEl.createEl('th', { text: '최소' });
		headerRowEl.createEl('th', { text: '중간' });
		headerRowEl.createEl('th', { text: '최대' });

		const tbodyEl = tableEl.createEl('tbody');
		this.addRangeRow(tbodyEl, {
			label: '당기순이익 (억)',
			minKey: 'operatingProfitMin',
			percentKey: 'operatingProfitMidPercent',
			maxKey: 'operatingProfitMax',
			midLabel: (element) => {
				this.operatingProfitMidEl = element;
			},
			input,
		});
		this.addRangeRow(tbodyEl, {
			label: 'PER',
			minKey: 'perMin',
			percentKey: 'perMidPercent',
			maxKey: 'perMax',
			midLabel: (element) => {
				this.perMidEl = element;
			},
			input,
		});

		const optionalEl = this.containerEl.createDiv({
			cls: 'stock-valuation-optional-grid',
		});
		this.addNumberField(optionalEl, '총 주식 수', 'totalShares', input);
		this.addNumberField(optionalEl, '현재 주가 (원)', 'currentPrice', input);

		const actionsEl = this.containerEl.createDiv({
			cls: 'stock-valuation-actions',
		});
		this.copyButtonEl = actionsEl.createEl('button', {
			text: '결과 복사',
			cls: 'mod-cta',
		});
		this.copyButtonEl.addEventListener('click', () => {
			void this.copyResult();
		});

		this.resultEl = this.containerEl.createDiv({
			cls: 'stock-valuation-result',
		});
		this.updateCalculatedView();
	}

	private addRangeRow(
		tbodyEl: HTMLTableSectionElement,
		options: {
			label: string;
			minKey: TextValuationInputKey;
			percentKey: PercentValuationInputKey;
			maxKey: TextValuationInputKey;
			midLabel: (element: HTMLElement) => void;
			input: ValuationBandInput;
		},
	): void {
		const rowEl = tbodyEl.createEl('tr');
		rowEl.createEl('th', { text: options.label });

		const minCellEl = rowEl.createEl('td');
		this.addNumberInput(minCellEl, options.minKey, options.input);

		const midCellEl = rowEl.createEl('td');
		const sliderWrapEl = midCellEl.createDiv({
			cls: 'stock-valuation-slider-cell',
		});
		const sliderEl = sliderWrapEl.createEl('input', {
			attr: {
				type: 'range',
				min: '0',
				max: '100',
				step: '1',
			},
		});
		sliderEl.value = String(options.input[options.percentKey]);
		this.inputEls.set(options.percentKey, sliderEl);
		sliderEl.addEventListener('input', () => {
			const percent = Number(sliderEl.value);
			const patch: Partial<ValuationBandInput> = {};
			patch[options.percentKey] = percent;
			this.host.updateValuationInput(
				this.guid,
				patch,
				this.instanceId,
			);
			this.updateCalculatedView();
		});
		const valueEl = sliderWrapEl.createDiv({
			cls: 'stock-valuation-mid-value',
		});
		options.midLabel(valueEl);

		const maxCellEl = rowEl.createEl('td');
		this.addNumberInput(maxCellEl, options.maxKey, options.input);
	}

	private addNumberField(
		containerEl: HTMLElement,
		label: string,
		key: TextValuationInputKey,
		input: ValuationBandInput,
	): void {
		const fieldEl = containerEl.createDiv({
			cls: 'stock-valuation-field',
		});
		fieldEl.createEl('label', { text: label });
		this.addNumberInput(fieldEl, key, input);
	}

	private addNumberInput(
		containerEl: HTMLElement,
		key: TextValuationInputKey,
		input: ValuationBandInput,
	): void {
		const inputEl = containerEl.createEl('input', {
			attr: {
				type: 'number',
				min: '0',
				step: 'any',
			},
		});
		inputEl.value = String(input[key]);
		this.inputEls.set(key, inputEl);
		inputEl.addEventListener('input', () => {
			const patch: Partial<ValuationBandInput> = {};
			patch[key] = inputEl.value;
			this.host.updateValuationInput(
				this.guid,
				patch,
				this.instanceId,
			);
			this.updateCalculatedView();
		});
	}

	private syncControls(): void {
		const input = this.host.getValuationInput(this.guid);

		for (const [key, inputEl] of this.inputEls) {
			inputEl.value = String(input[key]);
		}
	}

	private updateCalculatedView(): void {
		this.updateMidpointLabels();

		if (this.resultEl === null || this.copyButtonEl === null) {
			return;
		}

		const result = calculateValuationBand(this.host.getValuationInput(this.guid));
		this.resultEl.empty();

		if (!result.ok) {
			this.copyButtonEl.disabled = true;
			this.resultEl.createDiv({
				text: result.message,
				cls: 'stock-valuation-message',
			});
			return;
		}

		this.copyButtonEl.disabled = false;
		const values = result.values;
		const tableEl = this.resultEl.createEl('table', {
			cls: 'stock-valuation-result-table',
		});
		const tbodyEl = tableEl.createEl('tbody');
		this.addResultRow(tbodyEl, '당기순이익', [
			`${formatNumber(values.operatingProfitMin)}억`,
			`${formatNumber(values.operatingProfitMid)}억`,
			`${formatNumber(values.operatingProfitMax)}억`,
		]);
		this.addResultRow(tbodyEl, 'PER', [
			formatNumber(values.perMin),
			formatNumber(values.perMid),
			formatNumber(values.perMax),
		]);
		this.addResultRow(tbodyEl, '시가총액', [
			`${formatNumber(values.marketCapMin)}억`,
			`${formatNumber(values.marketCapMid)}억`,
			`${formatNumber(values.marketCapMax)}억`,
		]);

		if (
			values.priceMin !== undefined &&
			values.priceMid !== undefined &&
			values.priceMax !== undefined
		) {
			this.addResultRow(tbodyEl, '예상 주가', [
				`${formatPrice(values.priceMin)}원`,
				`${formatPrice(values.priceMid)}원`,
				`${formatPrice(values.priceMax)}원`,
			]);
		}

		if (
			values.downsidePotential !== undefined &&
			values.basePotential !== undefined &&
			values.upsidePotential !== undefined
		) {
			this.addResultRow(tbodyEl, '예상 여력', [
				formatPercent(values.downsidePotential),
				formatPercent(values.basePotential),
				formatPercent(values.upsidePotential),
			]);
		}
	}

	private updateMidpointLabels(): void {
		const input = this.host.getValuationInput(this.guid);
		this.setMidpointLabel(
			this.operatingProfitMidEl,
			input.operatingProfitMin,
			input.operatingProfitMax,
			input.operatingProfitMidPercent,
			'억',
		);
		this.setMidpointLabel(
			this.perMidEl,
			input.perMin,
			input.perMax,
			input.perMidPercent,
			'',
		);
	}

	private setMidpointLabel(
		element: HTMLElement | null,
		minValue: string,
		maxValue: string,
		percent: number,
		unit: string,
	): void {
		if (element === null) {
			return;
		}

		const min = parsePositiveNumber(minValue);
		const max = parsePositiveNumber(maxValue);
		if (min === null || max === null || min > max) {
			element.setText(`중간: ${percent}%`);
			return;
		}

		const value = min + (max - min) * (percent / 100);
		element.setText(
			`중간: ${formatNumber(value)}${unit.length > 0 ? unit : ''}`,
		);
	}

	private addResultRow(
		tbodyEl: HTMLTableSectionElement,
		label: string,
		values: [string, string, string],
	): void {
		const rowEl = tbodyEl.createEl('tr');
		rowEl.createEl('th', { text: label });
		for (const value of values) {
			rowEl.createEl('td', { text: value });
		}
	}

	private async copyResult(): Promise<void> {
		const result = createValuationBandText(this.host.getValuationInput(this.guid));
		if (!result.ok) {
			new Notice(result.message);
			return;
		}

		await navigator.clipboard.writeText(result.text);
		new Notice(COPY_SUCCESS_MESSAGE);
	}
}

function parsePositiveNumber(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	if (!NUMBER_PATTERN.test(trimmed)) {
		return null;
	}

	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
}

function createInstanceId(): string {
	if (typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return Math.random().toString(36).slice(2);
}
