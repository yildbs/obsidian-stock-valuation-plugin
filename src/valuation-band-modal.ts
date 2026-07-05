import { App, MarkdownView, Modal, Notice, Setting } from 'obsidian';
import { createValuationBandText, ValuationBandInput } from './valuation-band';

const COPY_SUCCESS_MESSAGE = '예상 시총 밴드를 클립보드에 복사했습니다.';

export class ValuationBandModal extends Modal {
	private dragCleanup: (() => void) | null = null;
	private scrollCleanup: (() => void) | null = null;
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
		contentEl.createEl('h2', {
			text: '예상 시총 밴드 계산기',
			cls: 'stock-valuation-modal-title',
		});
		this.enableDragging();
		this.enableScrollPassthrough();
		this.modalEl.addClass('stock-valuation-draggable-modal');

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
		this.dragCleanup?.();
		this.dragCleanup = null;
		this.scrollCleanup?.();
		this.scrollCleanup = null;
		this.contentEl.empty();
	}

	private enableDragging(): void {
		this.modalEl.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) {
				return;
			}
			if (isInteractiveElement(event.target)) {
				return;
			}

			const ownerWindow = this.modalEl.ownerDocument.defaultView;
			if (ownerWindow === null) {
				return;
			}

			this.dragCleanup?.();

			const modalEl = this.modalEl;
			const rect = modalEl.getBoundingClientRect();
			const offsetX = event.clientX - rect.left;
			const offsetY = event.clientY - rect.top;

			modalEl.addClass('stock-valuation-modal-dragging');
			modalEl.setCssStyles({
				position: 'fixed',
				left: `${rect.left}px`,
				top: `${rect.top}px`,
				margin: '0',
				transform: 'none',
			});

			const move = (moveEvent: PointerEvent): void => {
				const maxLeft = Math.max(0, ownerWindow.innerWidth - rect.width);
				const maxTop = Math.max(0, ownerWindow.innerHeight - rect.height);
				const left = clamp(moveEvent.clientX - offsetX, 0, maxLeft);
				const top = clamp(moveEvent.clientY - offsetY, 0, maxTop);

				modalEl.setCssStyles({
					left: `${left}px`,
					top: `${top}px`,
				});
			};

			const stop = (): void => {
				this.dragCleanup?.();
				this.dragCleanup = null;
			};

			this.dragCleanup = (): void => {
				ownerWindow.removeEventListener('pointermove', move);
				ownerWindow.removeEventListener('pointerup', stop);
				ownerWindow.removeEventListener('pointercancel', stop);
				modalEl.removeClass('stock-valuation-modal-dragging');
			};

			ownerWindow.addEventListener('pointermove', move);
			ownerWindow.addEventListener('pointerup', stop);
			ownerWindow.addEventListener('pointercancel', stop);
			event.preventDefault();
		});
	}

	private enableScrollPassthrough(): void {
		const handleWheel = (event: WheelEvent): void => {
			const scrollEl = this.findActiveDocumentScroller();
			if (scrollEl === null) {
				return;
			}

			scrollEl.scrollBy({
				left: event.deltaX,
				top: event.deltaY,
				behavior: 'auto',
			});
			event.preventDefault();
			event.stopPropagation();
		};

		this.containerEl.addEventListener('wheel', handleWheel, {
			passive: false,
		});
		this.scrollCleanup = (): void => {
			this.containerEl.removeEventListener('wheel', handleWheel);
		};
	}

	private findActiveDocumentScroller(): HTMLElement | null {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView === null) {
			return null;
		}

		const viewEl = markdownView.containerEl;
		const preferredScroller = viewEl.querySelector<HTMLElement>(
			'.cm-scroller, .markdown-preview-view',
		);
		if (preferredScroller !== null) {
			return preferredScroller;
		}

		return findScrollableElement(viewEl);
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function isInteractiveElement(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) {
		return false;
	}

	return target.closest(
		'input, textarea, select, button, a, [contenteditable="true"], .clickable-icon',
	) !== null;
}

function findScrollableElement(rootEl: HTMLElement): HTMLElement | null {
	const candidates = [rootEl, ...Array.from(rootEl.findAll('*'))];

	return (
		candidates.find((element) => {
			const style = getComputedStyle(element);
			const canScroll =
				style.overflowY === 'auto' ||
				style.overflowY === 'scroll' ||
				style.overflowY === 'overlay';

			return canScroll && element.scrollHeight > element.clientHeight;
		}) ?? null
	);
}
