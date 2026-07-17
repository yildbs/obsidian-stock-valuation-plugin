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
import {
	createValuationScenario,
	normalizeScenarioWeight,
	updateValuationScenario,
	ValuationScenario,
} from './valuation-scenario';

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
export type ScenarioSortKey =
	| 'name'
	| 'assumption'
	| 'weight'
	| 'fairPrice'
	| 'potentialPercent'
	| 'createdAt';
export type SortDirection = 'ascending' | 'descending';

export interface ValuationScenarioSort {
	key: ScenarioSortKey;
	direction: SortDirection;
}

export interface ValuationBlockHost {
	getValuationInput(guid: string): ValuationBandInput;
	updateValuationInput(
		guid: string,
		patch: Partial<ValuationBandInput>,
		sourceId?: string,
	): void;
	getValuationScenarios(guid: string): ValuationScenario[];
	getValuationScenarioSort(guid: string): ValuationScenarioSort;
	updateValuationScenarioSort(
		guid: string,
		sort: ValuationScenarioSort,
		sourceId?: string,
	): void;
	addValuationScenario(
		guid: string,
		scenario: ValuationScenario,
		sourceId?: string,
	): void;
	updateValuationScenario(
		guid: string,
		scenario: ValuationScenario,
		sourceId?: string,
	): void;
	deleteValuationScenario(
		guid: string,
		scenarioId: string,
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
	getDocumentFrontmatter(
		sourcePath: string,
		initialFrontmatter: unknown,
	): Promise<unknown>;
	getScenarioQuestionTemplate(): string;
	openScenarioQuestionTemplateModal(): void;
	cloneValuationBlock(
		guid: string,
		sourcePath: string,
		insertAfterLine: number | null,
	): Promise<void>;
}

const COPY_SUCCESS_MESSAGE = '계산 결과를 클립보드에 복사했습니다.';
const SCENARIO_JSON_COPY_SUCCESS_MESSAGE =
	'시나리오 JSON을 클립보드에 복사했습니다.';
const NUMBER_PATTERN = /^-?(?:\d+|\d*\.\d+)$/;

export class ValuationBlockRenderer extends MarkdownRenderChild {
	private readonly instanceId = createInstanceId();
	private unsubscribe: (() => void) | null = null;
	private resultEl: HTMLElement | null = null;
	private copyButtonEl: HTMLButtonElement | null = null;
	private operatingProfitMidEl: HTMLElement | null = null;
	private perMidEl: HTMLElement | null = null;
	private lockMidMarketCapCheckboxEl: HTMLInputElement | null = null;
	private livePriceCheckboxEl: HTMLInputElement | null = null;
	private livePriceRefreshButtonEl: HTMLButtonElement | null = null;
	private livePriceStatusEl: HTMLElement | null = null;
	private currentPriceInputEl: HTMLInputElement | null = null;
	private scenarioFormEl: HTMLElement | null = null;
	private scenarioListEl: HTMLElement | null = null;
	private scenarioFormRefresh: (() => void) | null = null;
	private displayedCurrentPrice: number | null = null;
	private livePriceLoading = false;
	private includeQuestionInScenarioCopy = false;
	private scenarioSortKey: ScenarioSortKey;
	private scenarioSortDirection: SortDirection;
	private livePriceRequestId = 0;
	private inputEls = new Map<keyof ValuationBandInput, HTMLInputElement>();

		constructor(
			containerEl: HTMLElement,
			private readonly guid: string,
			private readonly sourcePath: string,
			private readonly initialFrontmatter: unknown,
			private readonly host: ValuationBlockHost,
			private readonly getSourceLineEnd: () => number | null,
		) {
		super(containerEl);
		const sort = this.host.getValuationScenarioSort(guid);
		this.scenarioSortKey = sort.key;
		this.scenarioSortDirection = sort.direction;
	}

	onload(): void {
		this.unsubscribe = this.host.subscribeValuation(this.guid, (sourceId) => {
			if (sourceId === this.instanceId) {
				return;
			}

			this.syncScenarioSort();
			this.syncControls();
			this.updateCalculatedView();
			this.renderScenarioList();
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
		const titleEl = headerEl.createDiv({
			cls: 'stock-valuation-block-title',
		});
		titleEl.createEl('h4', { text: '주식 가치 밴드 계산기' });
		const cloneButtonEl = titleEl.createEl('button', {
			cls: 'stock-valuation-clone-button',
			text: 'Clone',
			attr: {
				type: 'button',
				title: '현재 계산기를 새 GUID로 복제',
			},
		});
		cloneButtonEl.addEventListener('click', () => {
			void this.host.cloneValuationBlock(
				this.guid,
				this.sourcePath,
				this.getSourceLineEnd(),
			);
		});
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
		const midpointHeaderEl = headerRowEl.createEl('th');
		const midpointHeaderContentEl = midpointHeaderEl.createDiv({
			cls: 'stock-valuation-midpoint-header',
		});
		midpointHeaderContentEl.createSpan({ text: '중간' });
		this.addMidMarketCapLockControl(midpointHeaderContentEl);
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
		this.renderScenarioSection();
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
			const patch = this.createSliderPatch(options.percentKey, percent);
			this.host.updateValuationInput(
				this.guid,
				patch,
				this.instanceId,
			);
			this.syncControls();
			this.updateCalculatedView();
		});
		const valueEl = sliderWrapEl.createDiv({
			cls: 'stock-valuation-mid-value',
		});
		options.midLabel(valueEl);

		const maxCellEl = rowEl.createEl('td');
		this.addNumberInput(maxCellEl, options.maxKey, options.input);
	}

	private addMidMarketCapLockControl(containerEl: HTMLElement): void {
		const labelEl = containerEl.createEl('label', {
			cls: 'stock-valuation-mid-lock-toggle',
			attr: {
				title: '중간 시가총액을 고정합니다.',
			},
		});
		this.lockMidMarketCapCheckboxEl = labelEl.createEl('input', {
			attr: {
				type: 'checkbox',
			},
		});
		this.lockMidMarketCapCheckboxEl.checked =
			this.host.getValuationInput(this.guid).lockMidMarketCap;
		labelEl.createSpan({ text: '시총 고정' });
		this.lockMidMarketCapCheckboxEl.addEventListener('change', () => {
			const lockMidMarketCap =
				this.lockMidMarketCapCheckboxEl?.checked ?? false;
			const currentInput = this.host.getValuationInput(this.guid);
			this.host.updateValuationInput(
				this.guid,
				{
					lockMidMarketCap,
					lockedMidMarketCap: lockMidMarketCap
						? calculateMidMarketCap(currentInput)
						: null,
				},
				this.instanceId,
			);
			this.updateCalculatedView();
		});
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
			if (isRangeBoundKey(key)) {
				patch.lockedMidMarketCap = calculateMidMarketCap({
					...this.host.getValuationInput(this.guid),
					...patch,
				});
			}
			this.host.updateValuationInput(
				this.guid,
				patch,
				this.instanceId,
			);
			this.updateCalculatedView();
		});

		return inputEl;
	}

	private createSliderPatch(
		changedKey: PercentValuationInputKey,
		changedPercent: number,
	): Partial<ValuationBandInput> {
		const input = this.host.getValuationInput(this.guid);
		if (!input.lockMidMarketCap) {
			return { [changedKey]: changedPercent };
		}

		const lockedMidMarketCap =
			input.lockedMidMarketCap ?? calculateMidMarketCap(input);
		if (lockedMidMarketCap === null) {
			return { [changedKey]: changedPercent };
		}

		const adjusted = adjustLockedMidMarketCap(
			input,
			changedKey,
			changedPercent,
			lockedMidMarketCap,
		);

		return {
			...adjusted,
			lockedMidMarketCap,
		};
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
		if (this.lockMidMarketCapCheckboxEl !== null) {
			this.lockMidMarketCapCheckboxEl.checked = input.lockMidMarketCap;
		}
		this.syncLivePriceControls(input);
	}

	private syncScenarioSort(): void {
		const sort = this.host.getValuationScenarioSort(this.guid);
		this.scenarioSortKey = sort.key;
		this.scenarioSortDirection = sort.direction;
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
			this.livePriceLoading = true;
			this.displayedCurrentPrice = null;
			this.setLivePriceStatus('조회 중...');
			this.scenarioFormRefresh?.();
			const livePrice = await this.host.getLivePrice(
				this.sourcePath,
				this.initialFrontmatter,
				forceRefresh,
			);
			if (requestId !== this.livePriceRequestId) {
				return;
			}
			this.livePriceLoading = false;
			this.applyLivePrice(calculationInput, livePrice);
		} else {
			this.livePriceLoading = false;
			this.displayedCurrentPrice = parsePositiveNumber(input.currentPrice);
			this.setLivePriceStatus('');
		}
		this.scenarioFormRefresh?.();

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

		this.displayedCurrentPrice = result.values.currentPrice ?? null;
		this.scenarioFormRefresh?.();

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
		this.displayedCurrentPrice = livePrice.price;
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

	private renderScenarioSection(): void {
		const sectionEl = this.containerEl.createDiv({
			cls: 'stock-valuation-scenarios',
		});
		const headerEl = sectionEl.createDiv({
			cls: 'stock-valuation-scenario-header',
		});
		headerEl.createEl('h5', { text: '시나리오' });
		const actionEl = headerEl.createDiv({
			cls: 'stock-valuation-scenario-header-actions',
		});
		const includeQuestionLabelEl = actionEl.createEl('label', {
			cls: 'stock-valuation-scenario-question-toggle',
		});
		const includeQuestionCheckboxEl = includeQuestionLabelEl.createEl(
			'input',
			{
				attr: { type: 'checkbox' },
			},
		);
		includeQuestionCheckboxEl.checked = this.includeQuestionInScenarioCopy;
		includeQuestionLabelEl.createSpan({ text: '질문 포함' });
		includeQuestionCheckboxEl.addEventListener('change', () => {
			this.includeQuestionInScenarioCopy = includeQuestionCheckboxEl.checked;
		});
		const templateButtonEl = actionEl.createEl('button', {
			text: '질문 템플릿',
			attr: { type: 'button' },
		});
		templateButtonEl.addEventListener('click', () => {
			this.host.openScenarioQuestionTemplateModal();
		});
		const copyJsonButtonEl = actionEl.createEl('button', {
			text: 'JSON 복사',
			attr: { type: 'button' },
		});
		copyJsonButtonEl.addEventListener('click', () => {
			void this.copyScenariosAsJson();
		});
		const addButtonEl = actionEl.createEl('button', {
			text: '시나리오 추가',
			attr: { type: 'button' },
		});
		this.scenarioFormEl = sectionEl.createDiv({
			cls: 'stock-valuation-scenario-form-container',
		});
		this.scenarioFormEl.hide();
		addButtonEl.addEventListener('click', () => {
			if (this.scenarioFormEl?.isShown()) {
				this.closeScenarioForm();
				return;
			}
			this.openScenarioForm();
		});

		this.scenarioListEl = sectionEl.createDiv({
			cls: 'stock-valuation-scenario-list',
		});
		this.renderScenarioList();
	}

	private async copyScenariosAsJson(): Promise<void> {
		const scenarios = this.sortScenarios(
			this.host.getValuationScenarios(this.guid),
		);
		if (scenarios.length === 0) {
			new Notice('복사할 시나리오가 없습니다.');
			return;
		}

		const exportedAt = new Date().toISOString();
		const weightedSummary = calculateScenarioWeightedSummary(scenarios);
		const payload = {
			type: 'stock_valuation_scenarios',
			description:
				'이 JSON은 사용자가 특정 주식을 분석하면서 지금까지 관찰한 내용과 가정을 바탕으로 작성한 가치평가 시나리오입니다. 각 시나리오는 미래 순이익과 적용 PER에 대한 사용자 정의 가정이며, 사실 확정값이나 공식 전망치가 아니라 비교와 추가 분석을 위한 가설입니다.',
			language: 'ko',
			unitNotes: {
				weight: '시나리오 발생 가능성에 대한 사용자 체감 가중치, 1~10 정수',
				netIncomeEok: '예상 연간 순이익, 단위는 억 원',
				per: '가치평가에 적용한 PER 배수',
				marketCapEok: '예상 시가총액, 단위는 억 원',
				totalShares: '총 주식 수, 단위는 주',
				fairPriceKrw: '적정 주가, 단위는 원',
				currentPriceKrw: '시나리오 저장 당시 기준 현재 주가, 단위는 원',
				returnPercent: '현재 주가 대비 예상 수익률, 단위는 %',
			},
			calculationMethod: {
				marketCapEok: 'netIncomeEok * per',
				fairPriceKrw: '(marketCapEok * 100000000) / totalShares',
				returnPercent: '(fairPriceKrw / currentPriceKrw - 1) * 100',
			},
			source: {
				app: 'Obsidian Stock Valuation Band',
				guid: this.guid,
				path: this.sourcePath,
			},
			sort: {
				key: this.scenarioSortKey,
				label: getScenarioSortLabel(this.scenarioSortKey),
				direction: this.scenarioSortDirection,
			},
			exportedAt,
			scenarioCount: scenarios.length,
			weightedSummary,
			scenarios: scenarios.map((scenario) => ({
				scenario: scenario.name,
				description: scenario.description,
				weight: scenario.weight,
				assumption: `순이익 ${formatNumber(scenario.netIncome)}억 × PER ${formatNumber(scenario.per)}배`,
				netIncomeEok: scenario.netIncome,
				per: scenario.per,
				marketCapEok: scenario.marketCap,
				totalShares: scenario.totalShares,
				fairPriceKrw: scenario.fairPrice,
				currentPriceKrw: scenario.currentPrice,
				returnPercent: scenario.potentialPercent,
				display: {
					marketCap: `${formatNumber(scenario.marketCap)}억`,
					fairPrice: `${formatPrice(scenario.fairPrice)}원`,
					currentPrice: `${formatPrice(scenario.currentPrice)}원`,
					return: formatPercent(scenario.potentialPercent),
					createdAt: formatScenarioTime(scenario.createdAt),
				},
				createdAt: scenario.createdAt,
			})),
		};

		const jsonText = JSON.stringify(payload, null, 2);
		const text = this.includeQuestionInScenarioCopy
			? await this.createScenarioQuestionCopyText(
					jsonText,
					scenarios.length,
					exportedAt,
				)
			: jsonText;
		if (text === null) {
			return;
		}

		await navigator.clipboard.writeText(text);
		new Notice(SCENARIO_JSON_COPY_SUCCESS_MESSAGE);
	}

	private async createScenarioQuestionCopyText(
		jsonText: string,
		scenarioCount: number,
		exportedAt: string,
	): Promise<string | null> {
		const template = this.host.getScenarioQuestionTemplate();
		if (!template.includes('{{json}}')) {
			new Notice('질문 템플릿에는 {{json}} 치환 문자열이 필요합니다.');
			return null;
		}

		const frontmatter = await this.host.getDocumentFrontmatter(
			this.sourcePath,
			this.initialFrontmatter,
		);
		const companyName = template.includes('{{asset_name}}')
			? getCompanyName(frontmatter)
			: '';
		const symbol = template.includes('{{symbol}}')
			? getFrontmatterField(frontmatter, 'symbol')
			: '';
		if (template.includes('{{asset_name}}') && companyName === null) {
			new Notice(
				'질문 포함 복사를 하려면 문서 frontmatter에 asset_name을 입력해주세요.',
			);
			return null;
		}
		if (template.includes('{{symbol}}') && symbol === null) {
			new Notice(
				'질문 포함 복사를 하려면 문서 frontmatter에 symbol을 입력해주세요.',
			);
			return null;
		}

		return renderScenarioQuestionTemplate(template, {
			assetName: companyName ?? '',
			symbol: symbol ?? '',
			jsonText,
			scenarioCount,
			exportedAt,
		});
	}

	private openScenarioForm(scenarioToEdit?: ValuationScenario): void {
		if (this.scenarioFormEl === null) {
			return;
		}

		const isEditing = scenarioToEdit !== undefined;
		this.scenarioFormEl.empty();
		this.scenarioFormEl.show();
		const input = this.host.getValuationInput(this.guid);
		const nameEl = this.addScenarioTextField(
			this.scenarioFormEl,
			'시나리오 이름',
			'예: 성장 유지하지만 멀티플 축소',
		);
		nameEl.value = scenarioToEdit?.name ?? '';
		const descriptionEl = this.addScenarioTextField(
			this.scenarioFormEl,
			'가정 설명',
			'선택 입력',
		);
		descriptionEl.value = scenarioToEdit?.description ?? '';
		const numbersEl = this.scenarioFormEl.createDiv({
			cls: 'stock-valuation-scenario-number-grid',
		});
		const netIncomeEl = this.addScenarioNumberField(
			numbersEl,
			'예상 순이익 (억)',
			scenarioToEdit?.netIncome ??
				getMidpointValue(
					input.operatingProfitMin,
					input.operatingProfitMax,
					input.operatingProfitMidPercent,
				),
		);
		const perEl = this.addScenarioNumberField(
			numbersEl,
			'적용 PER',
			scenarioToEdit?.per ??
				getMidpointValue(input.perMin, input.perMax, input.perMidPercent),
		);
		const weightEl = this.addScenarioNumberField(
			numbersEl,
			'시나리오 가중치',
			scenarioToEdit?.weight ?? 5,
			{ min: 1, max: 10, step: 1 },
		);
		const snapshotEl = this.scenarioFormEl.createDiv({
			cls: 'stock-valuation-scenario-snapshot',
		});
		const previewEl = this.scenarioFormEl.createDiv({
			cls: 'stock-valuation-scenario-preview',
		});
		const actionsEl = this.scenarioFormEl.createDiv({
			cls: 'stock-valuation-scenario-form-actions',
		});
		const cancelButtonEl = actionsEl.createEl('button', {
			text: '취소',
			attr: { type: 'button' },
		});
		const saveButtonEl = actionsEl.createEl('button', {
			text: isEditing ? '수정 저장' : '시나리오 저장',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});

		const refresh = () => {
			const totalShares =
				scenarioToEdit?.totalShares ??
				parsePositiveNumber(this.host.getValuationInput(this.guid).totalShares);
			const currentPrice =
				scenarioToEdit?.currentPrice ?? this.displayedCurrentPrice;
			const netIncome = parsePositiveNumber(netIncomeEl.value);
			const per = parsePositiveNumber(perEl.value);
			const weight = parseScenarioWeight(weightEl.value);
			snapshotEl.empty();
			previewEl.empty();

			if (!isEditing && this.livePriceLoading) {
				snapshotEl.setText('현재가를 조회하고 있습니다.');
			} else if (totalShares === null || currentPrice === null) {
				snapshotEl.setText(
					'시나리오를 저장하려면 총 주식 수와 현재 주가가 필요합니다.',
				);
			} else {
				snapshotEl.setText(
					`${isEditing ? '수정 기준' : '스냅샷 기준'}: 총 주식 수 ${formatNumber(totalShares)}주 · 현재가 ${formatPrice(currentPrice)}원`,
				);
			}

			const canCalculate =
				totalShares !== null &&
				currentPrice !== null &&
				netIncome !== null &&
				per !== null;
			if (canCalculate) {
				const marketCap = netIncome * per;
				const fairPrice = (marketCap * 100_000_000) / totalShares;
				previewEl.createDiv({
					text: `예상 시가총액 ${formatNumber(marketCap)}억`,
				});
				previewEl.createDiv({
					text: `적정 주가 ${formatPrice(fairPrice)}원`,
				});
				previewEl.createDiv({
					text: `현재가 대비 ${formatPercent((fairPrice / currentPrice - 1) * 100)}`,
				});
				previewEl.createDiv({
					text: `가중치 ${weight ?? '-'} / 10`,
				});
			}

			saveButtonEl.disabled =
				nameEl.value.trim().length === 0 ||
				!canCalculate ||
				weight === null;
		};
		this.scenarioFormRefresh = refresh;
		for (const element of [nameEl, netIncomeEl, perEl, weightEl]) {
			element.addEventListener('input', refresh);
		}
		cancelButtonEl.addEventListener('click', () => this.closeScenarioForm());
		saveButtonEl.addEventListener('click', () => {
			const totalShares =
				scenarioToEdit?.totalShares ??
				parsePositiveNumber(this.host.getValuationInput(this.guid).totalShares);
			const currentPrice =
				scenarioToEdit?.currentPrice ?? this.displayedCurrentPrice;
			const netIncome = parsePositiveNumber(netIncomeEl.value);
			const per = parsePositiveNumber(perEl.value);
			const weight = parseScenarioWeight(weightEl.value);
			if (
				nameEl.value.trim().length === 0 ||
				totalShares === null ||
				currentPrice === null ||
				netIncome === null ||
				per === null ||
				weight === null
			) {
				new Notice('시나리오의 필수 값을 확인해주세요.');
				return;
			}

			const scenarioInput = {
				name: nameEl.value,
				description: descriptionEl.value,
				weight,
				netIncome,
				per,
				totalShares,
				currentPrice,
			};
			if (scenarioToEdit !== undefined) {
				this.host.updateValuationScenario(
					this.guid,
					updateValuationScenario(scenarioToEdit, scenarioInput),
					this.instanceId,
				);
			} else {
				this.host.addValuationScenario(
					this.guid,
					createValuationScenario(scenarioInput),
					this.instanceId,
				);
			}
			this.closeScenarioForm();
			this.renderScenarioList();
			new Notice(
				isEditing ? '시나리오를 수정했습니다.' : '시나리오를 저장했습니다.',
			);
		});
		refresh();
		nameEl.focus();
	}

	private closeScenarioForm(): void {
		this.scenarioFormRefresh = null;
		this.scenarioFormEl?.empty();
		this.scenarioFormEl?.hide();
	}

	private addScenarioTextField(
		containerEl: HTMLElement,
		label: string,
		placeholder: string,
	): HTMLInputElement {
		const fieldEl = containerEl.createEl('label', {
			cls: 'stock-valuation-scenario-field',
		});
		fieldEl.createSpan({ text: label });
		return fieldEl.createEl('input', {
			attr: { type: 'text', placeholder },
		});
	}

	private addScenarioNumberField(
		containerEl: HTMLElement,
		label: string,
		initialValue: number | null,
		options?: {
			min?: number;
			max?: number;
			step?: number;
		},
	): HTMLInputElement {
		const fieldEl = containerEl.createEl('label', {
			cls: 'stock-valuation-scenario-field',
		});
		fieldEl.createSpan({ text: label });
		const inputEl = fieldEl.createEl('input', {
			attr: {
				type: 'number',
				min: String(options?.min ?? 0),
				...(options?.max !== undefined ? { max: String(options.max) } : {}),
				step: String(options?.step ?? 'any'),
			},
		});
		inputEl.value = initialValue === null ? '' : String(initialValue);
		return inputEl;
	}

	private renderScenarioList(): void {
		if (this.scenarioListEl === null) {
			return;
		}

		this.scenarioListEl.empty();
		const scenarios = this.sortScenarios(
			this.host.getValuationScenarios(this.guid),
		);
		if (scenarios.length === 0) {
			this.scenarioListEl.createDiv({
				text: '저장된 시나리오가 없습니다.',
				cls: 'stock-valuation-message',
			});
			return;
		}

		const tableEl = this.scenarioListEl.createEl('table', {
			cls: 'stock-valuation-scenario-table',
		});
		const headerRowEl = tableEl.createEl('thead').createEl('tr');
		this.addScenarioSortHeader(headerRowEl, '시나리오', 'name');
		this.addScenarioSortHeader(headerRowEl, '가정', 'assumption');
		this.addScenarioSortHeader(headerRowEl, '가중치', 'weight');
		this.addScenarioSortHeader(headerRowEl, '적정가', 'fairPrice');
		this.addScenarioSortHeader(
			headerRowEl,
			'현재 대비',
			'potentialPercent',
		);
		this.addScenarioSortHeader(headerRowEl, '저장 시점', 'createdAt');
		headerRowEl.createEl('th');
		const tbodyEl = tableEl.createEl('tbody');
		for (const scenario of scenarios) {
			const rowEl = tbodyEl.createEl('tr', {
				cls: 'stock-valuation-scenario-row',
			});
			const nameCellEl = rowEl.createEl('td', {
				cls: 'stock-valuation-scenario-name',
			});
			const nameButtonEl = nameCellEl.createEl('button', {
				text: scenario.name,
				cls: 'stock-valuation-scenario-edit-button',
				attr: {
					type: 'button',
					'aria-label': `${scenario.name} 시나리오 수정`,
				},
			});
			nameButtonEl.addEventListener('click', () => {
				this.openScenarioForm(scenario);
			});
			const assumptionEl = rowEl.createEl('td', {
				cls: 'stock-valuation-scenario-assumption',
			});
			if (scenario.description.length > 0) {
				assumptionEl.createDiv({ text: scenario.description });
			}
			assumptionEl.createDiv({
				text: `순이익 ${formatNumber(scenario.netIncome)}억 × PER ${formatNumber(scenario.per)}배`,
				cls: 'stock-valuation-scenario-detail',
			});
			rowEl.createEl('td', {
				text: String(scenario.weight),
				cls: 'stock-valuation-scenario-weight',
			});
			rowEl.createEl('td', {
				text: `${formatPrice(scenario.fairPrice)}원`,
				cls: 'stock-valuation-scenario-price',
			});
			const potentialEl = rowEl.createEl('td', {
				cls: 'stock-valuation-scenario-potential',
			});
			potentialEl.createSpan({
				text: formatPercent(scenario.potentialPercent),
				cls:
					scenario.potentialPercent >= 0
						? 'stock-valuation-scenario-potential-badge is-positive'
						: 'stock-valuation-scenario-potential-badge is-negative',
			});
			potentialEl.createDiv({
				text: `기준 ${formatPrice(scenario.currentPrice)}원`,
				cls: 'stock-valuation-scenario-detail',
			});
			rowEl.createEl('td', {
				text: formatScenarioTime(scenario.createdAt),
				cls: 'stock-valuation-scenario-created-at',
			});
			const deleteCellEl = rowEl.createEl('td', {
				cls: 'stock-valuation-scenario-delete-cell',
			});
			this.addScenarioDeleteButton(deleteCellEl, scenario.id);
		}
		this.renderScenarioWeightedSummary(this.scenarioListEl, scenarios);
	}

	private addScenarioSortHeader(
		rowEl: HTMLTableRowElement,
		label: string,
		key: ScenarioSortKey,
	): void {
		const isActive = this.scenarioSortKey === key;
		const headerEl = rowEl.createEl('th', {
			attr: {
				'aria-sort': isActive ? this.scenarioSortDirection : 'none',
			},
		});
		const buttonEl = headerEl.createEl('button', {
			cls: 'stock-valuation-scenario-sort-button',
			attr: {
				type: 'button',
				'aria-label': `${label} 기준 정렬`,
			},
		});
		buttonEl.createSpan({ text: label });
		buttonEl.createSpan({
			text: isActive
				? this.scenarioSortDirection === 'ascending'
					? '▲'
					: '▼'
				: '↕',
			cls: 'stock-valuation-scenario-sort-indicator',
		});
		buttonEl.addEventListener('click', () => {
			if (this.scenarioSortKey === key) {
				this.scenarioSortDirection =
					this.scenarioSortDirection === 'ascending'
						? 'descending'
						: 'ascending';
			} else {
				this.scenarioSortKey = key;
				this.scenarioSortDirection =
					key === 'name' || key === 'assumption'
						? 'ascending'
						: 'descending';
			}
			this.host.updateValuationScenarioSort(
				this.guid,
				{
					key: this.scenarioSortKey,
					direction: this.scenarioSortDirection,
				},
				this.instanceId,
			);
			this.renderScenarioList();
		});
	}

	private renderScenarioWeightedSummary(
		containerEl: HTMLElement,
		scenarios: ValuationScenario[],
	): void {
		const summary = calculateScenarioWeightedSummary(scenarios);
		if (summary === null) {
			return;
		}

		const summaryEl = containerEl.createDiv({
			cls: 'stock-valuation-scenario-weighted-summary',
		});
		summaryEl.createDiv({
			text: `가중치 합 ${formatNumber(summary.weightTotal)}`,
		});
		summaryEl.createDiv({
			text: `기대 적정주가 ${formatPrice(summary.weightedFairPriceKrw)}원`,
		});
		summaryEl.createDiv({
			text: `가중평균 현재가 대비 ${formatPercent(summary.expectedReturnPercent)}`,
		});
	}

	private sortScenarios(scenarios: ValuationScenario[]): ValuationScenario[] {
		const direction = this.scenarioSortDirection === 'ascending' ? 1 : -1;
		return scenarios.sort((left, right) => {
			let comparison: number;
			switch (this.scenarioSortKey) {
				case 'name':
					comparison = left.name.localeCompare(right.name, 'ko');
					break;
				case 'assumption':
					comparison =
						left.netIncome - right.netIncome || left.per - right.per;
					break;
				case 'weight':
					comparison = left.weight - right.weight;
					break;
				case 'fairPrice':
					comparison = left.fairPrice - right.fairPrice;
					break;
				case 'potentialPercent':
					comparison = left.potentialPercent - right.potentialPercent;
					break;
				case 'createdAt':
					comparison =
						Date.parse(left.createdAt) - Date.parse(right.createdAt);
					break;
			}

			return (
				comparison * direction ||
				Date.parse(right.createdAt) - Date.parse(left.createdAt)
			);
		});
	}

	private addScenarioDeleteButton(
		containerEl: HTMLElement,
		scenarioId: string,
	): void {
		const buttonEl = containerEl.createEl('button', {
			cls: 'stock-valuation-scenario-delete clickable-icon',
			attr: { type: 'button', 'aria-label': '시나리오 삭제', title: '시나리오 삭제' },
		});
		setIcon(buttonEl, 'trash-2');
		let confirmationTimer: number | null = null;
		buttonEl.addEventListener('click', () => {
			if (buttonEl.dataset.confirmDelete !== 'true') {
				buttonEl.dataset.confirmDelete = 'true';
				buttonEl.setText('삭제 확인');
				buttonEl.addClass('stock-valuation-scenario-delete-confirm');
				confirmationTimer = window.setTimeout(() => {
					buttonEl.dataset.confirmDelete = 'false';
					buttonEl.removeClass('stock-valuation-scenario-delete-confirm');
					buttonEl.empty();
					setIcon(buttonEl, 'trash-2');
				}, 3000);
				return;
			}

			if (confirmationTimer !== null) {
				window.clearTimeout(confirmationTimer);
			}
			this.host.deleteValuationScenario(
				this.guid,
				scenarioId,
				this.instanceId,
			);
			this.renderScenarioList();
			new Notice('시나리오를 삭제했습니다.');
		});
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

function calculateScenarioWeightedSummary(
	scenarios: ValuationScenario[],
): {
	weightTotal: number;
	weightedFairPriceKrw: number;
	weightedCurrentPriceKrw: number;
	expectedReturnPercent: number;
} | null {
	const weightTotal = scenarios.reduce(
		(total, scenario) => total + scenario.weight,
		0,
	);
	if (weightTotal <= 0) {
		return null;
	}

	const weightedFairPriceKrw =
		scenarios.reduce(
			(total, scenario) => total + scenario.fairPrice * scenario.weight,
			0,
		) / weightTotal;
	const weightedCurrentPriceKrw =
		scenarios.reduce(
			(total, scenario) => total + scenario.currentPrice * scenario.weight,
			0,
		) / weightTotal;

	return {
		weightTotal,
		weightedFairPriceKrw,
		weightedCurrentPriceKrw,
		expectedReturnPercent:
			(weightedFairPriceKrw / weightedCurrentPriceKrw - 1) * 100,
	};
}

function getMidpointValue(
	minValue: string,
	maxValue: string,
	percent: number,
): number | null {
	const min = parsePositiveNumber(minValue);
	const max = parsePositiveNumber(maxValue);
	if (min === null || max === null || min > max) {
		return null;
	}

	return min + (max - min) * (percent / 100);
}

function parseScenarioWeight(value: string): number | null {
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) {
		return null;
	}

	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
		return null;
	}

	return normalizeScenarioWeight(parsed);
}

function formatScenarioTime(isoTime: string): string {
	const date = new Date(isoTime);
	const parts = new Intl.DateTimeFormat('ko-KR', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
		.formatToParts(date)
		.reduce<Record<string, string>>((acc, part) => {
			acc[part.type] = part.value;
			return acc;
		}, {});

	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function getScenarioSortLabel(key: ScenarioSortKey): string {
	switch (key) {
		case 'name':
			return '시나리오';
		case 'assumption':
			return '가정';
		case 'weight':
			return '가중치';
		case 'fairPrice':
			return '적정가';
		case 'potentialPercent':
			return '현재 대비';
		case 'createdAt':
			return '저장 시점';
	}
}

function getCompanyName(frontmatter: unknown): string | null {
	return getFrontmatterField(frontmatter, 'asset_name');
}

function getFrontmatterField(frontmatter: unknown, key: string): string | null {
	const data = isRecord(frontmatter) ? frontmatter : {};
	const value = valueToString(data[key]);

	return value.length > 0 ? value : null;
}

function renderScenarioQuestionTemplate(
	template: string,
	values: {
		assetName: string;
		symbol: string;
		jsonText: string;
		scenarioCount: number;
		exportedAt: string;
	},
): string {
	return template
		.replaceAll('{{asset_name}}', values.assetName)
		.replaceAll('{{symbol}}', values.symbol)
		.replaceAll('{{json}}', values.jsonText)
		.replaceAll('{{scenario_count}}', String(values.scenarioCount))
		.replaceAll('{{exported_at}}', values.exportedAt);
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

function isRangeBoundKey(key: TextValuationInputKey): boolean {
	return (
		key === 'operatingProfitMin' ||
		key === 'operatingProfitMax' ||
		key === 'perMin' ||
		key === 'perMax'
	);
}

function adjustLockedMidMarketCap(
	input: ValuationBandInput,
	changedKey: PercentValuationInputKey,
	changedPercent: number,
	lockedMidMarketCap: number,
): Partial<ValuationBandInput> {
	const ranges = parseMidpointRanges(input);
	if (ranges === null || lockedMidMarketCap <= 0) {
		return { [changedKey]: changedPercent };
	}

	if (changedKey === 'perMidPercent') {
		const perPercent = clampPercent(changedPercent);
		const per = valueFromPercent(ranges.perMin, ranges.perMax, perPercent);
		const requiredProfit = lockedMidMarketCap / per;
		const profit = clamp(
			requiredProfit,
			ranges.profitMin,
			ranges.profitMax,
		);
		const operatingProfitMidPercent = percentFromValue(
			ranges.profitMin,
			ranges.profitMax,
			profit,
		);
		const adjustedPer = lockedMidMarketCap / profit;
		const perMidPercent = percentFromValue(
			ranges.perMin,
			ranges.perMax,
			adjustedPer,
		);

		return {
			perMidPercent,
			operatingProfitMidPercent,
		};
	}

	const operatingProfitMidPercent = clampPercent(changedPercent);
	const profit = valueFromPercent(
		ranges.profitMin,
		ranges.profitMax,
		operatingProfitMidPercent,
	);
	const requiredPer = lockedMidMarketCap / profit;
	const per = clamp(requiredPer, ranges.perMin, ranges.perMax);
	const perMidPercent = percentFromValue(ranges.perMin, ranges.perMax, per);
	const adjustedProfit = lockedMidMarketCap / per;

	return {
		operatingProfitMidPercent: percentFromValue(
			ranges.profitMin,
			ranges.profitMax,
			adjustedProfit,
		),
		perMidPercent,
	};
}

function calculateMidMarketCap(input: ValuationBandInput): number | null {
	const ranges = parseMidpointRanges(input);
	if (ranges === null) {
		return null;
	}

	const profit = valueFromPercent(
		ranges.profitMin,
		ranges.profitMax,
		input.operatingProfitMidPercent,
	);
	const per = valueFromPercent(ranges.perMin, ranges.perMax, input.perMidPercent);

	return profit * per;
}

function parseMidpointRanges(input: ValuationBandInput): {
	profitMin: number;
	profitMax: number;
	perMin: number;
	perMax: number;
} | null {
	const profitMin = parsePositiveNumber(input.operatingProfitMin);
	const profitMax = parsePositiveNumber(input.operatingProfitMax);
	const perMin = parsePositiveNumber(input.perMin);
	const perMax = parsePositiveNumber(input.perMax);

	if (
		profitMin === null ||
		profitMax === null ||
		perMin === null ||
		perMax === null ||
		profitMin > profitMax ||
		perMin > perMax
	) {
		return null;
	}

	return {
		profitMin,
		profitMax,
		perMin,
		perMax,
	};
}

function valueFromPercent(min: number, max: number, percent: number): number {
	return min + (max - min) * (clampPercent(percent) / 100);
}

function percentFromValue(min: number, max: number, value: number): number {
	if (min === max) {
		return 0;
	}

	return clampPercent(((value - min) / (max - min)) * 100);
}

function clampPercent(value: number): number {
	return clamp(Math.round(value), 0, 100);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function createInstanceId(): string {
	if (typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return Math.random().toString(36).slice(2);
}
