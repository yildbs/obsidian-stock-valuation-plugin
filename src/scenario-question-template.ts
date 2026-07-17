import { App, Modal, Notice } from 'obsidian';

export const DEFAULT_SCENARIO_QUESTION_TEMPLATE =
	'이 기업은 {{asset_name}}({{symbol}})인데,\n아래 시나리오를 바탕으로 단도분석을 해줘.\n\n{{json}}';
export const LEGACY_SCENARIO_QUESTION_TEMPLATE =
	'이 기업은 {{asset_name}}인데,\n아래 시나리오를 바탕으로 단도분석을 해줘.\n\n{{json}}';

export interface ScenarioQuestionTemplateHost {
	getScenarioQuestionTemplate(): string;
	updateScenarioQuestionTemplate(template: string): void;
}

export class ScenarioQuestionTemplateModal extends Modal {
	constructor(
		app: App,
		private readonly host: ScenarioQuestionTemplateHost,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('stock-valuation-template-modal');

		contentEl.createEl('h2', { text: '질문 템플릿' });
		contentEl.createEl('p', {
			text: '질문 포함 복사에 사용할 공통 템플릿입니다. 모든 가치평가 블록에서 같은 템플릿을 사용합니다.',
			cls: 'stock-valuation-template-description',
		});

		const tokenListEl = contentEl.createDiv({
			cls: 'stock-valuation-template-token-list',
		});
		tokenListEl.createDiv({ text: '{{asset_name}}: 문서 frontmatter의 asset_name' });
		tokenListEl.createDiv({ text: '{{symbol}}: 문서 frontmatter의 symbol' });
		tokenListEl.createDiv({ text: '{{json}}: 복사할 시나리오 JSON' });
		tokenListEl.createDiv({ text: '{{scenario_count}}: 시나리오 개수' });
		tokenListEl.createDiv({ text: '{{exported_at}}: JSON 추출 시각' });

		const textareaEl = contentEl.createEl('textarea', {
			cls: 'stock-valuation-template-textarea',
			attr: {
				rows: '10',
				spellcheck: 'false',
			},
		});
		textareaEl.value = this.host.getScenarioQuestionTemplate();

		const actionsEl = contentEl.createDiv({
			cls: 'stock-valuation-template-actions',
		});
		const resetButtonEl = actionsEl.createEl('button', {
			text: '기본값',
			attr: { type: 'button' },
		});
		const cancelButtonEl = actionsEl.createEl('button', {
			text: '취소',
			attr: { type: 'button' },
		});
		const saveButtonEl = actionsEl.createEl('button', {
			text: '저장',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});

		resetButtonEl.addEventListener('click', () => {
			textareaEl.value = DEFAULT_SCENARIO_QUESTION_TEMPLATE;
			textareaEl.focus();
		});
		cancelButtonEl.addEventListener('click', () => this.close());
		saveButtonEl.addEventListener('click', () => {
			const template = textareaEl.value.trim();
			if (template.length === 0) {
				new Notice('질문 템플릿을 입력해주세요.');
				return;
			}
			if (!template.includes('{{json}}')) {
				new Notice('질문 템플릿에는 {{json}} 치환 문자열이 필요합니다.');
				return;
			}

			this.host.updateScenarioQuestionTemplate(template);
			new Notice('질문 템플릿을 저장했습니다.');
			this.close();
		});

		textareaEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
