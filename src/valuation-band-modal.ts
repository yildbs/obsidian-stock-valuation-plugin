import { App, Modal, Notice, Setting } from 'obsidian';
import { createValuationBandText, ValuationBandInput } from './valuation-band';

const COPY_SUCCESS_MESSAGE = '예상 시총 밴드를 클립보드에 복사했습니다.';

export class ValuationBandModal extends Modal {
	private input: ValuationBandInput = {
		operatingProfitMin: '',
		operatingProfitMax: '',
		perMin: '',
		perMax: '',
	};

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '예상 시총 밴드 계산기' });

		this.addNumberSetting('예상 영업이익 최소값 (억)', 'operatingProfitMin');
		this.addNumberSetting('예상 영업이익 최대값 (억)', 'operatingProfitMax');
		this.addNumberSetting('적정 PER 최소값', 'perMin');
		this.addNumberSetting('적정 PER 최대값', 'perMax');

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
