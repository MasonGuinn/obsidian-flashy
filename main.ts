import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	MarkdownRenderChild,
	TextComponent,
	setIcon,
	Modal,
	MarkdownView,
	Notice
} from 'obsidian';

// --- DATA STRUCTURES ---
interface BaseFlashcard {
	type: 'multiple-choice' | 'fill-in-the-blank' | 'qa';
	question: string;
	customBackgroundColor?: string;
	customTextColor?: string;
}
interface MultipleChoiceCard extends BaseFlashcard {
	type: 'multiple-choice';
	answers: { text: string; isCorrect: boolean; }[];
}
interface FillInTheBlankCard extends BaseFlashcard {
	type: 'fill-in-the-blank';
	questionPartTwo?: string;
	answer: string;
}
interface QACard extends BaseFlashcard {
	type: 'qa';
	answer: string;
}

type Flashcard = MultipleChoiceCard | FillInTheBlankCard | QACard;

interface FlashyPluginSettings {
	shuffleCards: boolean;
	shuffleAnswers: boolean;
	autoAdvance: boolean;
	autoAdvanceDelay: number;
	defaultModalCardType: 'multiple-choice' | 'fill-in-the-blank' | 'qa';
}

const DEFAULT_SETTINGS: FlashyPluginSettings = {
	shuffleCards: false,
	shuffleAnswers: true,
	autoAdvance: false,
	autoAdvanceDelay: 1000,
	defaultModalCardType: 'multiple-choice',
}

export default class FlashyPlugin extends Plugin {
	settings: FlashyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('blocks', 'Create Flashy Cards', () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				if (view.getMode() === 'source') {
					new FlashcardCreatorModal(this.app, this.settings, (result) => {
						if (result) {
							view.editor.replaceSelection(`\n\`\`\`flashy\n${result}\n\`\`\`\n`);
						}
					}).open();
				} else {
					new Notice("Please switch to Editing View to create a flashcard.");
				}
			} else {
				new Notice("Please open a note to create a flashcard.");
			}
		});

		this.registerMarkdownCodeBlockProcessor('flashy', (source, el, ctx) => {
			const settings = this.settings;
			let currentCardIndex = 0;
			let stats = { correct: 0, incorrect: 0, answered: 0 };
			const answeredCardIndexes = new Set<number>();

			const allCards = parseAllCards(source);
			const cardsToRender = settings.shuffleCards ? [...allCards].sort(() => Math.random() - 0.5) : allCards;

			if (cardsToRender.length === 0) {
				el.createEl('p', { text: 'No valid flashy cards found. Check your syntax!', cls: 'flashcard-error' });
				return;
			}

			const mainContainer = el.createDiv({ cls: 'flashcard-container' });
			const child = new MarkdownRenderChild(mainContainer);
			ctx.addChild(child);

			const handleKeyDown = (event: KeyboardEvent) => {
				const activeEl = el.win.document.activeElement;
				const isTyping = activeEl && activeEl.tagName === 'INPUT';

				if (!el.contains(activeEl) && !el.matches(':hover')) return;

				switch (event.key) {
					case 'ArrowLeft':
						event.preventDefault();
						if (currentCardIndex > 0) renderCard(currentCardIndex - 1);
						break;
					case 'ArrowRight':
						event.preventDefault();
						if (currentCardIndex < cardsToRender.length - 1) renderCard(currentCardIndex + 1);
						break;
					case 'r':
					case 'R':
						if (isTyping) return;
						event.preventDefault();
						stats = { correct: 0, incorrect: 0, answered: 0 };
						answeredCardIndexes.clear();
						renderCard(0);
						break;
				}

				const num = parseInt(event.key);
				if (!isNaN(num) && num >= 1 && num <= 9) {
					if (isTyping) return;
					event.preventDefault();
					const answerButtons = mainContainer.querySelectorAll<HTMLButtonElement>('.flashcard-answer');
					if (answerButtons[num - 1] && !answerButtons[num - 1].disabled) answerButtons[num - 1].click();
				}
			};
			child.registerDomEvent(el.win, 'keydown', handleKeyDown);

			const onGraded = (isCorrect: boolean) => {
				if (answeredCardIndexes.has(currentCardIndex)) {
					return;
				}
				answeredCardIndexes.add(currentCardIndex);

				if (isCorrect) stats.correct++;
				else stats.incorrect++;
				stats.answered++;

				if (isCorrect && settings.autoAdvance && currentCardIndex < cardsToRender.length - 1) {
					setTimeout(() => {
						renderCard(currentCardIndex + 1);
					}, settings.autoAdvanceDelay);
				}

				if (stats.answered === cardsToRender.length) {
					setTimeout(() => renderSummary(), 1000);
				}
			};

			function renderCard(index: number) {
				currentCardIndex = index;
				mainContainer.empty();
				const cardData = cardsToRender[index];
				if (!cardData) return;

				if (cardData.customBackgroundColor) {
					mainContainer.style.backgroundColor = cardData.customBackgroundColor;
				} else {
					mainContainer.style.backgroundColor = '';
				}
				if (cardData.customTextColor) {
					mainContainer.style.color = cardData.customTextColor;
				} else {
					mainContainer.style.color = '';
				}

				renderHeader(mainContainer, cardData);
				const body = mainContainer.createDiv({cls: 'flashcard-body'});

				switch (cardData.type) {
					case 'multiple-choice':
						renderMultipleChoiceBody(body, cardData, onGraded);
						break;
					case 'fill-in-the-blank':
						renderFillInTheBlankBody(body, cardData, onGraded);
						break;
					case 'qa':
						renderQABody(body, cardData, onGraded);
						break;
				}
				renderControls(mainContainer, index, cardsToRender.length, renderCard);
			}

			function renderSummary() {
				mainContainer.empty();
				const summaryEl = mainContainer.createDiv({cls: 'flashcard-summary'});
				summaryEl.createEl('h3', {text: 'Session Complete!'});
				const score = cardsToRender.length > 0 ? (stats.correct / cardsToRender.length * 100) : 0;
				summaryEl.createEl('p', {text: `You answered ${stats.correct} out of ${cardsToRender.length} cards correctly on the first try.`});
				summaryEl.createEl('p', {text: `Score: ${score.toFixed(0)}%`});

				const resetButton = summaryEl.createEl('button', {text: 'Review Again', cls: 'flashcard-reset'});
				resetButton.addEventListener('click', () => {
					stats = { correct: 0, incorrect: 0, answered: 0 };
					answeredCardIndexes.clear();
					renderCard(0);
				});
			}

			renderCard(0);

			function renderHeader(container: HTMLElement, card: Flashcard) {
				const header = container.createDiv({cls: 'flashcard-header'});

				const titleContainer = header.createDiv();
				let questionText = card.question;
				if (card.type === 'fill-in-the-blank' && card.questionPartTwo) {
					questionText += " ___ " + card.questionPartTwo;
				}
				titleContainer.createEl('p', { text: questionText, cls: 'flashcard-question' });

				const resetButton = header.createEl('button', { cls: 'flashcard-reset flashy-icon-button' });
				setIcon(resetButton, 'refresh-cw');
				resetButton.ariaLabel = "Reset Session (R)";
				resetButton.addEventListener('click', () => {
					stats = { correct: 0, incorrect: 0, answered: 0 };
					answeredCardIndexes.clear();
					renderCard(0);
				});
			}

			function renderMultipleChoiceBody(container: HTMLElement, card: MultipleChoiceCard, onGraded: (correct: boolean) => void) {
				const buttonsContainer = container.createDiv({ cls: 'flashcard-buttons' });
				const answers = card.answers;
				const answersToShow = settings.shuffleAnswers ? [...answers].sort(() => Math.random() - 0.5) : answers;
				const totalCorrectAnswers = answers.filter(a => a.isCorrect).length;
				let foundCorrectAnswers = 0;
				let hasAnswered = false;
				const allButtons: HTMLButtonElement[] = [];
				const correctButtons: HTMLButtonElement[] = [];

				answersToShow.forEach(answer => {
					const button = buttonsContainer.createEl('button', { text: answer.text, cls: 'flashcard-answer' });
					allButtons.push(button);
					if (answer.isCorrect) correctButtons.push(button);

					button.addEventListener('click', () => {
						if (answer.isCorrect) {
							button.classList.add('correct');
							button.disabled = true;
							foundCorrectAnswers++;
							if (foundCorrectAnswers === totalCorrectAnswers) {
								allButtons.forEach(btn => { if (!btn.disabled) btn.disabled = true; });
								container.createEl('p', { text: 'Correct!', cls: 'flashcard-feedback correct' });
								if (!hasAnswered) {
									onGraded(true);
									hasAnswered = true;
								}
							}
						} else {
							button.classList.add('incorrect');
							allButtons.forEach(btn => btn.disabled = true);
							correctButtons.forEach(correctBtn => correctBtn.classList.add('correct'));
							container.createEl('p', { text: 'Incorrect', cls: 'flashcard-feedback incorrect' });
							if (!hasAnswered) {
								onGraded(false);
								hasAnswered = true;
							}
						}
					});
				});
			}

			function renderFillInTheBlankBody(container: HTMLElement, card: FillInTheBlankCard, onGraded: (correct: boolean) => void) {
				const formContainer = container.createDiv({cls: 'flashcard-fill-container'});
				const input = new TextComponent(formContainer).setPlaceholder("Type your answer...").inputEl;
				input.classList.add('flashcard-fill-input');
				const submitButton = formContainer.createEl('button', { text: "Submit", cls: "flashcard-fill-submit" });

				const checkAnswer = () => {
					const userAnswer = input.value.trim();
					const isCorrect = userAnswer.toLowerCase() === card.answer.toLowerCase();
					input.disabled = true;
					submitButton.disabled = true;
					onGraded(isCorrect);
					const feedbackText = isCorrect ? "Correct!" : "Incorrect";
					const feedbackClass = isCorrect ? "correct" : "incorrect";
					input.classList.add(feedbackClass);
					container.createEl('p', { text: feedbackText, cls: `flashcard-feedback ${feedbackClass}` });
					if (!isCorrect) {
						const reveal = container.createEl('p', {cls: 'flashcard-correct-answer-reveal'});
						reveal.appendText('The correct answer was: ');
						reveal.createEl('span', {text: card.answer});
					}
				};
				submitButton.addEventListener('click', checkAnswer);
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); checkAnswer(); }
				});
			}

			function renderQABody(container: HTMLElement, card: QACard, onGraded: (correct: boolean) => void) {
				const qaContainer = container.createDiv({ cls: 'qa-container' });
				const answerContainer = qaContainer.createDiv({ cls: 'qa-answer-container', text: card.answer });
				answerContainer.hide();

				const gradingContainer = qaContainer.createDiv({ cls: 'qa-grading-buttons' });
				gradingContainer.hide();

				const showAnswerButton = qaContainer.createEl('button', { text: "Show Answer", cls: 'mod-cta' });

				const gradeCorrectButton = gradingContainer.createEl('button', { text: 'I Was Right', cls: 'qa-grading-button correct' });
				const gradeIncorrectButton = gradingContainer.createEl('button', { text: 'I Was Wrong', cls: 'qa-grading-button incorrect' });

				const handleGrading = (correct: boolean) => {
					onGraded(correct);
					gradeCorrectButton.disabled = true;
					gradeIncorrectButton.disabled = true;
				};

				gradeCorrectButton.addEventListener('click', () => handleGrading(true));
				gradeIncorrectButton.addEventListener('click', () => handleGrading(false));

				showAnswerButton.addEventListener('click', () => {
					showAnswerButton.hide();
					answerContainer.show();
					gradingContainer.show();
				});
			}

			function renderControls(container: HTMLElement, currentIndex: number, total: number, onNavigate: (newIndex: number) => void) {
				const controls = container.createDiv({cls: 'flashcard-controls'});

				const prevButton = controls.createEl('button', { cls: 'flashcard-nav flashy-icon-button' });
				setIcon(prevButton, 'arrow-left');
				prevButton.ariaLabel = 'Previous Card (Left Arrow)';
				prevButton.disabled = currentIndex === 0;
				prevButton.addEventListener('click', () => onNavigate(currentIndex - 1));

				const middleContainer = controls.createDiv({ cls: 'flashcard-middle-controls' });
				if (total > 1) {
					middleContainer.createEl('span', { text: `${currentIndex + 1} / ${total}`, cls: 'flashcard-progress' });
				}

				const nextButton = controls.createEl('button', { cls: 'flashcard-nav flashy-icon-button' });
				setIcon(nextButton, 'arrow-right');
				nextButton.ariaLabel = 'Next Card (Right Arrow)';
				nextButton.disabled = currentIndex >= total - 1;
				nextButton.addEventListener('click', () => onNavigate(currentIndex + 1));
			}
			function parseAllCards(source: string): Flashcard[] {
				let content = source.trim();
				const globalProperties: { bg?: string; color?: string } = {};

				const globalPropMatch = content.match(/^\[\[(.*?)]]\n?/);
				if (globalPropMatch) {
					const propLine = globalPropMatch[1];
					const props = propLine.trim().split(/\s+/);
					props.forEach(prop => {
						const [key, value] = prop.split('=');
						if (key === 'bg' && value) globalProperties.bg = value;
						if (key === 'color' && value) globalProperties.color = value;
					});
					content = content.substring(globalPropMatch[0].length);
				}

				const cardBlocks = content.split(/\n---\n/);

				return cardBlocks.map(block => {
					let lines = block.trim().split('\n').filter(line => line.trim().length > 0);
					if (lines.length === 0) return null;

					const cardProperties: { bg?: string; color?: string } = {};
					if (lines[0].startsWith('[') && lines[0].endsWith(']')) {
						const propLine = lines.shift()?.slice(1, -1);
						if (propLine) {
							const props = propLine.trim().split(/\s+/);
							props.forEach(prop => {
								const [key, value] = prop.split('=');
								if (key === 'bg' && value) cardProperties.bg = value;
								if (key === 'color' && value) cardProperties.color = value;
							});
						}
					}

					if (lines.length === 0) return null;

					let card: Flashcard | null = null;

					// MODIFIED: This logic is updated for the new Q&A syntax.
					const qaSeparatorIndex = lines.findIndex(line => line.trim().startsWith('==='));
					if (qaSeparatorIndex > -1) {
						const question = lines.slice(0, qaSeparatorIndex).join('\n').trim();
						// Get the answer from the same line as the separator
						const answer = lines[qaSeparatorIndex].trim().substring(3).trim();

						if (question && answer) {
							card = { type: 'qa', question, answer } as QACard;
						}
					} else {
						const questionLine = lines[0];
						const fitbMatch = questionLine.match(/(.*){{(.*)}}(.*)/);
						if (fitbMatch && fitbMatch[2]) {
							const [_, q1, answer, q2] = fitbMatch;
							card = {
								type: 'fill-in-the-blank',
								question: q1.trim(), questionPartTwo: q2.trim() || undefined, answer: answer.trim(),
							} as FillInTheBlankCard;
						} else if (lines.length > 1) {
							const answers = lines.slice(1).map(line => ({
								text: line.trim().startsWith('=') ? line.trim().substring(1).trim() : line.trim(),
								isCorrect: line.trim().startsWith('='),
							}));
							if (answers.some(a => a.isCorrect)) {
								card = {
									type: 'multiple-choice', question: questionLine.trim(), answers: answers,
								} as MultipleChoiceCard;
							}
						}
					}

					if (card) {
						card.customBackgroundColor = cardProperties.bg || globalProperties.bg;
						card.customTextColor = cardProperties.color || globalProperties.color;
						return card;
					}

					return null;
				}).filter((card): card is Flashcard => card !== null);
			}
		});

		this.addSettingTab(new FlashySettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class FlashcardCreatorModal extends Modal {
	// --- STATE MANAGEMENT ---
	private cards: any[] = [];
	private editingIndex: number = 0;
	private readonly onSubmit: (result: string) => void;
	private settings: FlashyPluginSettings;

	constructor(app: App, settings: FlashyPluginSettings, onSubmit: (result: string) => void) {
		super(app);
		this.settings = settings;
		this.onSubmit = onSubmit;
		this.cards.push(this.getEmptyCardData());
	}

	getEmptyCardData() {
		return {
			// MODIFIED: Uses the setting for the default type
			cardType: this.settings.defaultModalCardType,
			question: '',
			correctAnswers: '',
			incorrectAnswers: '',
			fitbText: '',
			qaAnswer: '', // NEW: Field for the Q&A answer
			bgColor: '',
			textColor: '',
		};
	}

	renderContent() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: `Editing Flashcard ${this.editingIndex + 1} of ${this.cards.length}` });

		this.renderCardForm(contentEl.createDiv());

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText("Previous Card")
				.setDisabled(this.editingIndex === 0)
				.onClick(() => {
					if (this.editingIndex > 0) {
						this.editingIndex--;
						this.renderContent();
					}
				}))
			.addButton(button => button
				.setButtonText(this.editingIndex === this.cards.length - 1 ? "Add New Card" : "Next Card")
				.onClick(() => {
					this.editingIndex++;
					if (this.editingIndex === this.cards.length) {
						this.cards.push(this.getEmptyCardData());
					}
					this.renderContent();
				}));

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText("Finish & Insert Deck")
				.setCta()
				.onClick(() => {
					const deckString = this.buildDeckString();
					if (deckString) {
						this.onSubmit(deckString);
					}
					this.close();
				}));
	}

	renderCardForm(container: HTMLElement) {
		const cardData = this.cards[this.editingIndex];

		new Setting(container)
			.setName('Card Type')
			.addDropdown(dropdown => dropdown
				.addOption('multiple-choice', 'Multiple Choice')
				.addOption('fill-in-the-blank', 'Fill-in-the-Blank')
				.addOption('qa', 'Question/Answer') // NEW: Q&A option
				.setValue(cardData.cardType)
				.onChange(value => {
					cardData.cardType = value;
					this.renderContent();
				}));

		if (cardData.cardType === 'multiple-choice') {
			new Setting(container)
				.setName('Question')
				.addText(text => text.setPlaceholder('e.g., Which layer is the Network layer?').setValue(cardData.question).onChange(value => cardData.question = value));

			new Setting(container)
				.setName('Correct Answer(s)').setDesc("One answer per line.")
				.addTextArea(text => {
					text.setPlaceholder("e.g., Layer 3").setValue(cardData.correctAnswers).onChange(value => cardData.correctAnswers = value);
					text.inputEl.rows = 4;
				});

			new Setting(container)
				.setName('Incorrect Answer(s)').setDesc("One answer per line.")
				.addTextArea(text => {
					text.setPlaceholder("e.g., Layer 2\nLayer 7").setValue(cardData.incorrectAnswers).onChange(value => cardData.incorrectAnswers = value);
					text.inputEl.rows = 4;
				});
		} else if (cardData.cardType === 'fill-in-the-blank') {
			new Setting(container)
				.setName('Full Text').setDesc("Wrap the answer in {{double curly braces}}.")
				.addTextArea(text => {
					text.setPlaceholder("e.g., The OSI model has {{seven}} layers.").setValue(cardData.fitbText).onChange(value => cardData.fitbText = value);
					text.inputEl.rows = 4;
				});
		} else { // NEW: Form for Q&A card type
			new Setting(container)
				.setName("Question")
				.addTextArea(text => {
					text.setPlaceholder("e.g., What does the 'A' in CIA Triad stand for?")
						.setValue(cardData.question)
						.onChange(value => cardData.question = value)
					text.inputEl.rows = 4;
				});
			new Setting(container)
				.setName("Answer")
				.addTextArea(text => {
					text.setPlaceholder("e.g., Availability")
						.setValue(cardData.qaAnswer)
						.onChange(value => cardData.qaAnswer = value)
					text.inputEl.rows = 4;
				});
		}

		new Setting(container)
			.setName('Custom Background Color').setDesc("(Optional)")
			.addText(text => text.setValue(cardData.bgColor).onChange(value => cardData.bgColor = value));
		new Setting(container)
			.setName('Custom Text Color').setDesc("(Optional)")
			.addText(text => text.setValue(cardData.textColor).onChange(value => cardData.textColor = value));
	}

	buildDeckString(): string {
		return this.cards
			.filter(cardData => (cardData.question && cardData.question.trim() !== "") || (cardData.fitbText && cardData.fitbText.trim() !== ""))
			.map(cardData => {
				let cardString = '';
				const props = [];
				if (cardData.bgColor) props.push(`bg=${cardData.bgColor}`);
				if (cardData.textColor) props.push(`color=${cardData.textColor}`);
				if (props.length > 0) {
					cardString += `[${props.join(' ')}]\n`;
				}

				switch (cardData.cardType) {
					case 'multiple-choice':
						cardString += `${cardData.question}\n`;
						const correct = cardData.correctAnswers.trim().split('\n').map((ans: string) => `=${ans.trim()}`);
						const incorrect = cardData.incorrectAnswers.trim().split('\n').map((ans: string) => ans.trim());
						cardString += [...correct, ...incorrect].filter(Boolean).join('\n');
						break;
					case 'fill-in-the-blank':
						cardString += cardData.fitbText;
						break;
					case 'qa':
						cardString += `${cardData.question}\n===${cardData.qaAnswer}`;
						break;
				}
				return cardString;
			}).join('\n---\n');
	}

	onOpen() {
		this.renderContent();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class FlashySettingTab extends PluginSettingTab {
	plugin: FlashyPlugin;
	constructor(app: App, plugin: FlashyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Settings for Flashy' });

		// --- BEHAVIOR ---
		containerEl.createEl('h3', { text: 'Behavior' });
		new Setting(containerEl)
			.setName('Shuffle card order')
			.setDesc('Randomize the order of cards within a block each session.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.shuffleCards).onChange(async (value) => {
				this.plugin.settings.shuffleCards = value; await this.plugin.saveSettings(); this.app.workspace.updateOptions();
			}));
		new Setting(containerEl)
			.setName('Shuffle answer choices')
			.setDesc('Randomize the order of answers for multiple-choice cards.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.shuffleAnswers).onChange(async (value) => {
				this.plugin.settings.shuffleAnswers = value; await this.plugin.saveSettings(); this.app.workspace.updateOptions();
			}));
		new Setting(containerEl)
			.setName('Auto-advance on correct')
			.setDesc('Automatically move to the next card after a correct answer.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.autoAdvance).onChange(async (value) => {
				this.plugin.settings.autoAdvance = value; await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
			.setName('Auto-advance delay (ms)')
			.setDesc('The delay in milliseconds before advancing to the next card.')
			.addText(text => text.setValue(String(this.plugin.settings.autoAdvanceDelay)).onChange(async (value) => {
				const delay = parseInt(value);
				if (!isNaN(delay)) {
					this.plugin.settings.autoAdvanceDelay = delay;
					await this.plugin.saveSettings();
				}
			}));

		// --- CARD CREATION ---
		containerEl.createEl('h3', { text: 'Card Creation' });
		new Setting(containerEl)
			.setName('Default card type in modal')
			.setDesc('Choose the default card type when opening the card creation modal.')
			.addDropdown(dropdown => dropdown
				.addOption('multiple-choice', 'Multiple Choice')
				.addOption('fill-in-the-blank', 'Fill-in-the-Blank')
				.addOption('qa', 'Question/Answer')
				.setValue(this.plugin.settings.defaultModalCardType)
				.onChange(async (value) => {
					this.plugin.settings.defaultModalCardType = value as any;
					await this.plugin.saveSettings();
				}));
	}
}
