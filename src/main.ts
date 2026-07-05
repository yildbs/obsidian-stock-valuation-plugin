import { MarkdownView, Notice, Plugin } from 'obsidian';
import {
	DEFAULT_VALUATION_INPUT,
	ValuationBandInput,
} from './valuation-band';
import {
	ValuationBlockHost,
	ValuationBlockRenderer,
} from './valuation-block';

interface StockValuationPluginData {
	valuations: Record<string, ValuationBandInput>;
}

const DEFAULT_DATA: StockValuationPluginData = {
	valuations: {},
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
				ctx.addChild(new ValuationBlockRenderer(el, guid, this));
			},
		);
	}

	async onunload(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			await this.saveData(this.data);
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

	private async loadPluginData(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<StockValuationPluginData> | null;
		const valuations = loaded?.valuations ?? {};
		this.data = {
			valuations: Object.fromEntries(
				Object.entries(valuations).map(([guid, input]) => [
					guid,
					normalizeValuationInput(input),
				]),
			),
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
	};
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
