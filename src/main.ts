import { Plugin } from 'obsidian';
import { ValuationBandModal } from './valuation-band-modal';

export default class StockValuationPlugin extends Plugin {
	async onload(): Promise<void> {
		this.addRibbonIcon('calculator', 'Open valuation band calculator', () => {
			this.openValuationBandModal();
		});

		this.addCommand({
			id: 'open-valuation-band-modal',
			name: 'Open valuation band calculator',
			callback: () => {
				this.openValuationBandModal();
			},
		});
	}

	private openValuationBandModal(): void {
		new ValuationBandModal(this.app).open();
	}
}
