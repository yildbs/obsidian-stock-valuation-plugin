import { App, Modal, Notice, Setting } from 'obsidian';
import { createValuationBandText, ValuationBandInput } from './valuation-band';

const COPY_SUCCESS_MESSAGE = '예상 시총 밴드를 클립보드에 복사했습니다.';

export class ValuationBandModal extends Modal {
	private input: ValuationBandInput = {
		operatingProfitMin: '',
		operatingProfitMid: '',
		operatingProfitMax: '',
		perMin: '',
		perMid: '',
		perMax: '',
		totalShares: '',
		currentPrice: '',
	};

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '예상 시총 밴드 계산기' });

		this.addValuationTable();
		this.addNumberSetting('총 주식 수 (선택)', 'totalShares');
		this.addNumberSetting('현재 주가 (선택)', 'currentPrice');

		new Setting(contentEl).addButton((button) => {
			button
				.setButtonText('OK')
				.setCta()
				.onClick(() => {
					void this.copyValuationBand();
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private addValuationTable(): void {
		const table = this.contentEl.createEl('table', {
			cls: 'stock-valuation-input-table',
		});
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');
		headerRow.createEl('th');
		headerRow.createEl('th', { text: '최소' });
		headerRow.createEl('th', { text: '중간' });
		headerRow.createEl('th', { text: '최대' });

		const tbody = table.createEl('tbody');
		this.addValuationTableRow(tbody, '영업이익 (억)', [
			['operatingProfitMin', '필수'],
			['operatingProfitMid', '자동'],
			['operatingProfitMax', '필수'],
		]);
		this.addValuationTableRow(tbody, 'PER', [
			['perMin', '필수'],
			['perMid', '자동'],
			['perMax', '필수'],
		]);
	}

	private addValuationTableRow(
		tbody: HTMLTableSectionElement,
		label: string,
		cells: Array<[keyof ValuationBandInput, string]>,
	): void {
		const row = tbody.createEl('tr');
		row.createEl('th', { text: label });

		for (const [key, placeholder] of cells) {
			const cell = row.createEl('td');
			const inputEl = cell.createEl('input', {
				attr: {
					type: 'number',
					min: '0',
					step: 'any',
					placeholder,
				},
			});
			inputEl.addEventListener('input', () => {
				this.input[key] = inputEl.value;
			});
		}
	}

	private addNumberSetting(
		name: string,
		key: keyof ValuationBandInput,
	): void {
		new Setting(this.contentEl).setName(name).addText((text) => {
			text.inputEl.type = 'number';
			text.inputEl.min = '0';
			text.inputEl.step = 'any';
			text.onChange((value) => {
				this.input[key] = value;
			});
		});
	}

	private async copyValuationBand(): Promise<void> {
		const result = createValuationBandText(this.input);
		if (!result.ok) {
			new Notice(result.message);
			return;
		}

		await navigator.clipboard.writeText(result.text);
		new Notice(COPY_SUCCESS_MESSAGE);
		this.close();
	}
}
