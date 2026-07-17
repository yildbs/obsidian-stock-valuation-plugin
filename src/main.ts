import { MarkdownView, Notice, parseYaml, Plugin, TFile } from 'obsidian';
import {
	DEFAULT_VALUATION_INPUT,
	ValuationBandInput,
} from './valuation-band';
import {
	ScenarioSortKey,
	SortDirection,
	ValuationBlockHost,
	ValuationBlockRenderer,
	ValuationScenarioSort,
} from './valuation-block';
import { fetchLivePrice, LivePriceResult } from './live-price';
import {
	DEFAULT_SCENARIO_QUESTION_TEMPLATE,
	LEGACY_SCENARIO_QUESTION_TEMPLATE,
	ScenarioQuestionTemplateModal,
} from './scenario-question-template';
import {
	normalizeValuationScenarios,
	ValuationScenario,
} from './valuation-scenario';

interface StockValuationPluginData {
	valuations: Record<string, ValuationBandInput>;
	scenarios: Record<string, ValuationScenario[]>;
	scenarioSorts: Record<string, ValuationScenarioSort>;
	questionTemplate: string;
}

const DEFAULT_DATA: StockValuationPluginData = {
	valuations: {},
	scenarios: {},
	scenarioSorts: {},
	questionTemplate: DEFAULT_SCENARIO_QUESTION_TEMPLATE,
};
const DEFAULT_SCENARIO_SORT: ValuationScenarioSort = {
	key: 'createdAt',
	direction: 'descending',
};
const SAVE_DELAY_MS = 300;

export default class StockValuationPlugin
	extends Plugin
	implements ValuationBlockHost
{
	private data: StockValuationPluginData = DEFAULT_DATA;
	private saveTimer: number | null = null;
	private listeners = new Map<string, Set<(sourceId?: string) => void>>();

	async onload(): Promise<void> {
		await this.loadPluginData();

		this.addRibbonIcon('calculator', '주식 가치 밴드 계산기 삽입', () => {
			this.insertValuationBlock();
		});

		this.addCommand({
			id: 'insert-stock-valuation-calculator',
			name: '주식 가치 밴드 계산기 삽입',
			editorCallback: () => {
				this.insertValuationBlock();
			},
		});

		this.addCommand({
			id: 'open-valuation-band-modal',
			name: '주식 가치 밴드 계산기 삽입',
			editorCallback: () => {
				this.insertValuationBlock();
			},
		});

		this.registerMarkdownCodeBlockProcessor(
			'stock-valuation',
			(source, el, ctx) => {
				const guid = parseGuid(source);
				if (guid === null) {
					el.createDiv({
						text: '잘못된 주식 가치 밴드 블록입니다. guid 값을 추가해주세요.',
						cls: 'stock-valuation-message',
					});
					return;
				}

				this.ensureValuationInput(guid);
				ctx.addChild(
					new ValuationBlockRenderer(
						el,
						guid,
							ctx.sourcePath,
							ctx.frontmatter,
							this,
							() => ctx.getSectionInfo(el)?.lineEnd ?? null,
						),
					);
				},
		);
	}

	onunload(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.saveData(this.data);
		}
	}

	getValuationInput(guid: string): ValuationBandInput {
		return { ...this.ensureValuationInput(guid) };
	}

	updateValuationInput(
		guid: string,
		patch: Partial<ValuationBandInput>,
		sourceId?: string,
	): void {
		const current = this.ensureValuationInput(guid);
		this.data.valuations[guid] = normalizeValuationInput({
			...current,
			...patch,
		});
		this.scheduleSave();
		this.notifyValuationListeners(guid, sourceId);
	}

	getValuationScenarios(guid: string): ValuationScenario[] {
		return (this.data.scenarios[guid] ?? []).map((scenario) => ({
			...scenario,
		}));
	}

	getValuationScenarioSort(guid: string): ValuationScenarioSort {
		return { ...(this.data.scenarioSorts[guid] ?? DEFAULT_SCENARIO_SORT) };
	}

	updateValuationScenarioSort(
		guid: string,
		sort: ValuationScenarioSort,
		sourceId?: string,
	): void {
		this.data.scenarioSorts[guid] = normalizeValuationScenarioSort(sort);
		this.scheduleSave();
		this.notifyValuationListeners(guid, sourceId);
	}

	addValuationScenario(
		guid: string,
		scenario: ValuationScenario,
		sourceId?: string,
	): void {
		this.data.scenarios[guid] = [
			scenario,
			...(this.data.scenarios[guid] ?? []),
		];
		this.scheduleSave();
		this.notifyValuationListeners(guid, sourceId);
	}

	updateValuationScenario(
		guid: string,
		scenario: ValuationScenario,
		sourceId?: string,
	): void {
		this.data.scenarios[guid] = (this.data.scenarios[guid] ?? []).map((item) =>
			item.id === scenario.id ? { ...scenario } : item,
		);
		this.scheduleSave();
		this.notifyValuationListeners(guid, sourceId);
	}

	deleteValuationScenario(
		guid: string,
		scenarioId: string,
		sourceId?: string,
	): void {
		this.data.scenarios[guid] = (this.data.scenarios[guid] ?? []).filter(
			(scenario) => scenario.id !== scenarioId,
		);
		this.scheduleSave();
		this.notifyValuationListeners(guid, sourceId);
	}

	subscribeValuation(
		guid: string,
		listener: (sourceId?: string) => void,
	): () => void {
		const guidListeners = this.listeners.get(guid) ?? new Set();
		guidListeners.add(listener);
		this.listeners.set(guid, guidListeners);

		return () => {
			guidListeners.delete(listener);
			if (guidListeners.size === 0) {
				this.listeners.delete(guid);
			}
		};
	}

	async getLivePrice(
		sourcePath: string,
		initialFrontmatter: unknown,
		forceRefresh: boolean,
	): Promise<LivePriceResult> {
		const frontmatter = await this.resolveFrontmatter(
			sourcePath,
			initialFrontmatter,
		);

		return fetchLivePrice(frontmatter, forceRefresh);
	}

	async getDocumentFrontmatter(
		sourcePath: string,
		initialFrontmatter: unknown,
	): Promise<unknown> {
		return this.resolveFrontmatter(sourcePath, initialFrontmatter);
	}

	getScenarioQuestionTemplate(): string {
		return this.data.questionTemplate;
	}

	updateScenarioQuestionTemplate(template: string): void {
		const trimmed = template.trim();
		this.data.questionTemplate =
			trimmed.length > 0 ? trimmed : DEFAULT_SCENARIO_QUESTION_TEMPLATE;
		this.scheduleSave();
	}

	openScenarioQuestionTemplateModal(): void {
		new ScenarioQuestionTemplateModal(this.app, this).open();
	}

	async cloneValuationBlock(
		guid: string,
		sourcePath: string,
		insertAfterLine: number | null,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			new Notice('복제할 Markdown 문서를 찾을 수 없습니다.');
			return;
		}

		const newGuid = createGuid();
		this.data.valuations[newGuid] = normalizeValuationInput(
			this.ensureValuationInput(guid),
		);
		this.data.scenarios[newGuid] = (this.data.scenarios[guid] ?? []).map(
			(scenario) => ({
				...scenario,
				id: createGuid(),
			}),
		);
		this.data.scenarioSorts[newGuid] = {
			...(this.data.scenarioSorts[guid] ?? DEFAULT_SCENARIO_SORT),
		};
		this.scheduleSave();

		try {
			const text = await this.app.vault.read(file);
			const lines = text.split('\n');
			const insertAt =
				insertAfterLine === null
					? lines.length
					: Math.min(Math.max(insertAfterLine + 1, 0), lines.length);
			lines.splice(
				insertAt,
				0,
				'',
				'```stock-valuation',
				`guid: ${newGuid}`,
				'```',
				'',
			);
			await this.app.vault.modify(file, lines.join('\n'));
			new Notice('계산기를 새 GUID로 복제했습니다.');
		} catch (error) {
			delete this.data.valuations[newGuid];
			delete this.data.scenarios[newGuid];
			delete this.data.scenarioSorts[newGuid];
			this.scheduleSave();
			new Notice(`계산기 복제 실패: ${getErrorMessage(error)}`);
		}
	}

	private async resolveFrontmatter(
		sourcePath: string,
		initialFrontmatter: unknown,
	): Promise<unknown> {
		if (hasFrontmatterFields(initialFrontmatter)) {
			return initialFrontmatter;
		}

		const cachedFrontmatter =
			this.app.metadataCache.getCache(sourcePath)?.frontmatter;
		if (hasFrontmatterFields(cachedFrontmatter)) {
			return cachedFrontmatter;
		}

		const activeFile = this.app.workspace.getActiveFile();
		const activeFrontmatter =
			activeFile !== null
				? this.app.metadataCache.getFileCache(activeFile)?.frontmatter
				: null;
		if (hasFrontmatterFields(activeFrontmatter)) {
			return activeFrontmatter;
		}

		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			return initialFrontmatter;
		}

		const text = await this.app.vault.cachedRead(file);
		const frontmatterText = extractFrontmatterText(text);
		if (frontmatterText === null) {
			return initialFrontmatter;
		}

		const parsed: unknown = parseYaml(frontmatterText);

		return parsed;
	}

	private async loadPluginData(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<StockValuationPluginData> | null;
		const valuations = loaded?.valuations ?? {};
		const scenarios = loaded?.scenarios ?? {};
		const scenarioSorts = loaded?.scenarioSorts ?? {};
		const questionTemplate =
			typeof loaded?.questionTemplate === 'string' &&
			loaded.questionTemplate.trim().length > 0
				? normalizeQuestionTemplate(loaded.questionTemplate)
				: DEFAULT_SCENARIO_QUESTION_TEMPLATE;
		this.data = {
			valuations: Object.fromEntries(
				Object.entries(valuations).map(([guid, input]) => [
					guid,
					normalizeValuationInput(input),
				]),
			),
			scenarios: Object.fromEntries(
				Object.entries(scenarios).map(([guid, items]) => [
					guid,
					normalizeValuationScenarios(items),
				]),
			),
			scenarioSorts: Object.fromEntries(
				Object.entries(scenarioSorts).map(([guid, sort]) => [
					guid,
					normalizeValuationScenarioSort(sort),
				]),
			),
			questionTemplate,
		};
	}

	private insertValuationBlock(): void {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView === null) {
			new Notice('계산기를 삽입할 Markdown 문서를 열어주세요.');
			return;
		}

		const guid = createGuid();
		this.ensureValuationInput(guid);
		this.scheduleSave();
		markdownView.editor.replaceSelection(
			`\n\`\`\`stock-valuation\nguid: ${guid}\n\`\`\`\n`,
		);
	}

	private ensureValuationInput(guid: string): ValuationBandInput {
		const existing = this.data.valuations[guid];
		if (existing !== undefined) {
			return existing;
		}

		const input = normalizeValuationInput(DEFAULT_VALUATION_INPUT);
		this.data.valuations[guid] = input;
		this.scheduleSave();

		return input;
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}

		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveData(this.data);
		}, SAVE_DELAY_MS);
	}

	private notifyValuationListeners(guid: string, sourceId?: string): void {
		for (const listener of this.listeners.get(guid) ?? []) {
			listener(sourceId);
		}
	}
}

function normalizeValuationInput(input: unknown): ValuationBandInput {
	const candidate =
		input !== null && typeof input === 'object'
			? (input as Partial<ValuationBandInput>)
			: {};

	return {
		operatingProfitMin:
			typeof candidate.operatingProfitMin === 'string'
				? candidate.operatingProfitMin
				: DEFAULT_VALUATION_INPUT.operatingProfitMin,
		operatingProfitMax:
			typeof candidate.operatingProfitMax === 'string'
				? candidate.operatingProfitMax
				: DEFAULT_VALUATION_INPUT.operatingProfitMax,
		operatingProfitMidPercent: normalizePercent(
			candidate.operatingProfitMidPercent,
		),
		perMin:
			typeof candidate.perMin === 'string'
				? candidate.perMin
				: DEFAULT_VALUATION_INPUT.perMin,
		perMax:
			typeof candidate.perMax === 'string'
				? candidate.perMax
				: DEFAULT_VALUATION_INPUT.perMax,
		perMidPercent: normalizePercent(candidate.perMidPercent),
		totalShares:
			typeof candidate.totalShares === 'string'
				? candidate.totalShares
				: DEFAULT_VALUATION_INPUT.totalShares,
		currentPrice:
			typeof candidate.currentPrice === 'string'
				? candidate.currentPrice
				: DEFAULT_VALUATION_INPUT.currentPrice,
		useLivePrice:
			typeof candidate.useLivePrice === 'boolean'
				? candidate.useLivePrice
				: DEFAULT_VALUATION_INPUT.useLivePrice,
		lockMidMarketCap:
			typeof candidate.lockMidMarketCap === 'boolean'
				? candidate.lockMidMarketCap
				: DEFAULT_VALUATION_INPUT.lockMidMarketCap,
		lockedMidMarketCap:
			typeof candidate.lockedMidMarketCap === 'number' &&
			Number.isFinite(candidate.lockedMidMarketCap)
				? candidate.lockedMidMarketCap
				: DEFAULT_VALUATION_INPUT.lockedMidMarketCap,
	};
}

function normalizeQuestionTemplate(template: string): string {
	const trimmed = template.trim();
	if (trimmed === LEGACY_SCENARIO_QUESTION_TEMPLATE) {
		return DEFAULT_SCENARIO_QUESTION_TEMPLATE;
	}

	return trimmed;
}

function normalizeValuationScenarioSort(
	value: unknown,
): ValuationScenarioSort {
	if (value === null || typeof value !== 'object') {
		return DEFAULT_SCENARIO_SORT;
	}

	const candidate = value as Partial<ValuationScenarioSort>;
	return {
		key: isScenarioSortKey(candidate.key)
			? candidate.key
			: DEFAULT_SCENARIO_SORT.key,
		direction: isSortDirection(candidate.direction)
			? candidate.direction
			: DEFAULT_SCENARIO_SORT.direction,
	};
}

function isScenarioSortKey(value: unknown): value is ScenarioSortKey {
	return (
		value === 'name' ||
		value === 'assumption' ||
		value === 'weight' ||
		value === 'fairPrice' ||
		value === 'potentialPercent' ||
		value === 'createdAt'
	);
}

function isSortDirection(value: unknown): value is SortDirection {
	return value === 'ascending' || value === 'descending';
}

function normalizePercent(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 50;
	}

	return Math.min(Math.max(Math.round(value), 0), 100);
}

function parseGuid(source: string): string | null {
	const match = source.match(/^\s*guid\s*:\s*([^\s]+)\s*$/m);

	return match?.[1] ?? null;
}

function hasFrontmatterFields(value: unknown): boolean {
	if (value === null || typeof value !== 'object') {
		return false;
	}

	return 'symbol' in value || 'market' in value;
}

function extractFrontmatterText(text: string): string | null {
	const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);

	return match?.[1] ?? null;
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

function createGuid(): string {
	if (typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
		const random = Math.floor(Math.random() * 16);
		const value = char === 'x' ? random : (random & 0x3) | 0x8;

		return value.toString(16);
	});
}
