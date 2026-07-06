import { MarkdownRenderChild, Notice, setIcon } from 'obsidian';
import { formatLivePriceTime, LivePriceResult } from './live-price';
import {
	calculateValuationBand,
	createValuationBandText,
	formatNumber,
	formatPercent,
	formatPrice,
	ValuationBandInput,
} from './valuation-band';

type TextValuationInputKey =
	| 'operatingProfitMin'
	| 'operatingProfitMax'
	| 'perMin'
	| 'perMax'
	| 'totalShares'
	| 'currentPrice';
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
	getLivePrice(
		sourcePath: string,
		initialFrontmatter: unknown,
		forceRefresh: boolean,
	): Promise<LivePriceResult>;
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
	private livePriceCheckboxEl: HTMLInputElement | null = null;
	private livePriceRefreshButtonEl: HTMLButtonElement | null = null;
	private livePriceStatusEl: HTMLElement | null = null;
	private currentPriceInputEl: HTMLInputElement | null = null;
	private livePriceRequestId = 0;
	private inputEls = new Map<keyof ValuationBandInput, HTMLInputElement>();

	constructor(
		containerEl: HTMLElement,
		private readonly guid: string,
		private readonly sourcePath: string,
		private readonly initialFrontmatter: unknown,
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
			label: '예상 연간 순이익 (억)',
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
		this.currentPriceInputEl = this.addCurrentPriceField(
			optionalEl,
			'현재 주가 (원)',
			input,
		);
		this.addLivePriceColumn(optionalEl);

		const actionsEl = this.containerEl.createDiv({
			cls: 'stock-valuation-actions',
		});
		this.copyButtonEl = actionsEl.createEl('button', {
			cls: 'stock-valuation-copy-button clickable-icon',
			attr: {
				type: 'button',
				'aria-label': '결과 복사',
				title: '결과 복사',
			},
		});
		setIcon(this.copyButtonEl, 'copy');
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
	): HTMLInputElement {
		const fieldEl = containerEl.createDiv({
			cls: 'stock-valuation-field',
		});
		const labelRowEl = fieldEl.createDiv({
			cls: 'stock-valuation-field-label-row',
		});
		labelRowEl.createEl('label', { text: label });
		const inputRowEl = fieldEl.createDiv({
			cls: 'stock-valuation-input-row',
		});

		return this.addNumberInput(inputRowEl, key, input);
	}

	private addCurrentPriceField(
		containerEl: HTMLElement,
		label: string,
		input: ValuationBandInput,
	): HTMLInputElement {
		const fieldEl = containerEl.createDiv({
			cls: 'stock-valuation-field',
		});
		const labelRowEl = fieldEl.createDiv({
			cls: 'stock-valuation-field-label-row',
		});
		labelRowEl.createEl('label', { text: label });
		const inputRowEl = fieldEl.createDiv({
			cls: 'stock-valuation-current-price-row',
		});
		const inputEl = this.addNumberInput(inputRowEl, 'currentPrice', input);

		return inputEl;
	}

	private addNumberInput(
		containerEl: HTMLElement,
		key: TextValuationInputKey,
		input: ValuationBandInput,
	): HTMLInputElement {
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

		return inputEl;
	}

	private addLivePriceColumn(containerEl: HTMLElement): void {
		const columnEl = containerEl.createDiv({
			cls: 'stock-valuation-live-price-column',
		});
		this.addLivePriceControls(columnEl);
		this.livePriceStatusEl = columnEl.createDiv({
			cls: 'stock-valuation-live-price-status',
		});
	}

	private addLivePriceControls(containerEl: HTMLElement): void {
		const livePriceEl = containerEl.createDiv({
			cls: 'stock-valuation-live-price',
		});
		const labelEl = livePriceEl.createEl('label', {
			cls: 'stock-valuation-live-price-toggle',
			attr: {
				title: 'Yahoo finance 현재가를 사용합니다. 약 20분 지연될 수 있습니다.',
			},
		});
		this.livePriceCheckboxEl = labelEl.createEl('input', {
			attr: {
				type: 'checkbox',
			},
		});
		this.livePriceCheckboxEl.checked =
			this.host.getValuationInput(this.guid).useLivePrice;
		labelEl.createSpan({ text: '실시간 사용' });
		this.livePriceCheckboxEl.addEventListener('change', () => {
			const useLivePrice = this.livePriceCheckboxEl?.checked ?? false;
			this.host.updateValuationInput(
				this.guid,
				{ useLivePrice },
				this.instanceId,
			);
			this.updateCalculatedView(useLivePrice);
		});

		this.livePriceRefreshButtonEl = livePriceEl.createEl('button', {
			cls: 'stock-valuation-refresh-button clickable-icon',
			attr: {
				type: 'button',
				'aria-label': '현재가 새로고침',
				title: '현재가 새로고침',
			},
		});
		setIcon(this.livePriceRefreshButtonEl, 'refresh-cw');
		this.livePriceRefreshButtonEl.addEventListener('click', () => {
			this.updateCalculatedView(true);
		});
	}

	private syncControls(): void {
		const input = this.host.getValuationInput(this.guid);

		for (const [key, inputEl] of this.inputEls) {
			inputEl.value = String(input[key]);
		}
		this.syncLivePriceControls(input);
	}

	private updateCalculatedView(forceRefresh = false): void {
		this.updateMidpointLabels();
		const requestId = ++this.livePriceRequestId;

		void this.updateCalculatedViewAsync(requestId, forceRefresh);
	}

	private async updateCalculatedViewAsync(
		requestId: number,
		forceRefresh: boolean,
	): Promise<void> {
		const input = this.host.getValuationInput(this.guid);
		const calculationInput = { ...input };
		this.syncLivePriceControls(input);

		if (input.useLivePrice) {
			this.setLivePriceStatus('조회 중...');
			const livePrice = await this.host.getLivePrice(
				this.sourcePath,
				this.initialFrontmatter,
				forceRefresh,
			);
			if (requestId !== this.livePriceRequestId) {
				return;
			}
			this.applyLivePrice(calculationInput, livePrice);
		} else {
			this.setLivePriceStatus('');
		}

		if (this.resultEl === null || this.copyButtonEl === null) {
			return;
		}

		const result = calculateValuationBand(calculationInput);
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
		this.addResultRow(tbodyEl, '예상 연간 순이익', [
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
			this.addResultRow(tbodyEl, '현재 주가', [
				values.currentPrice !== undefined
					? `${formatPrice(values.currentPrice)}원`
					: '-',
				values.currentPrice !== undefined
					? `${formatPrice(values.currentPrice)}원`
					: '-',
				values.currentPrice !== undefined
					? `${formatPrice(values.currentPrice)}원`
					: '-',
			]);
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
		const calculationInput = await this.getCalculationInput(false);
		const result = createValuationBandText(calculationInput);
		if (!result.ok) {
			new Notice(result.message);
			return;
		}

		await navigator.clipboard.writeText(result.text);
		new Notice(COPY_SUCCESS_MESSAGE);
	}

	private async getCalculationInput(
		forceRefresh: boolean,
	): Promise<ValuationBandInput> {
		const input = this.host.getValuationInput(this.guid);
		const calculationInput = { ...input };
		if (!input.useLivePrice) {
			return calculationInput;
		}

		const livePrice = await this.host.getLivePrice(
			this.sourcePath,
			this.initialFrontmatter,
			forceRefresh,
		);
		this.applyLivePrice(calculationInput, livePrice);

		return calculationInput;
	}

	private applyLivePrice(
		input: ValuationBandInput,
		livePrice: LivePriceResult,
	): void {
		if (!livePrice.ok || livePrice.price === null) {
			this.setLivePriceStatus(livePrice.message);
			return;
		}

		input.currentPrice = String(livePrice.price);
		if (this.currentPriceInputEl !== null) {
			this.currentPriceInputEl.value = String(livePrice.price);
		}
		const timeText = formatLivePriceTime(livePrice.marketTimeSec);
		this.setLivePriceStatus(
			`${livePrice.yahooSymbol ?? ''}${
				timeText.length > 0 ? ` ${timeText}` : ''
			}`,
		);
	}

	private syncLivePriceControls(input: ValuationBandInput): void {
		if (this.livePriceCheckboxEl !== null) {
			this.livePriceCheckboxEl.checked = input.useLivePrice;
		}
		if (this.currentPriceInputEl !== null) {
			this.currentPriceInputEl.disabled = input.useLivePrice;
		}
		if (this.livePriceRefreshButtonEl !== null) {
			this.livePriceRefreshButtonEl.disabled = !input.useLivePrice;
		}
	}

	private setLivePriceStatus(message: string): void {
		if (this.livePriceStatusEl === null) {
			return;
		}

		this.livePriceStatusEl.setText(message);
		this.livePriceStatusEl.toggleClass(
			'stock-valuation-live-price-status-empty',
			message.length === 0,
		);
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
