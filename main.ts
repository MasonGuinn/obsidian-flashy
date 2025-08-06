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
	type: 'multiple-choice' | 'fill-in-the-blank';
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
type Flashcard = MultipleChoiceCard | FillInTheBlankCard;

interface FlashyPluginSettings {
	shuffleCards: boolean;
	shuffleAnswers: boolean;
}

const DEFAULT_SETTINGS: FlashyPluginSettings = {
	shuffleCards: false,
	shuffleAnswers: true,
}

export default class FlashyPlugin extends Plugin {
	settings: FlashyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('blocks', 'Create Flashy Card', () => {
			// Check if there is an active editor
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				// Open the modal and pass it a callback function
				new FlashcardCreatorModal(this.app, (result) => {
					if (result) {
						const editor = view.editor;
						// Insert the generated flashcard text into the note
						editor.replaceSelection(`\n\`\`\`flashy\n${result}\n\`\`\`\n`);
					}
				}).open();
			} else {
				// If no note is open, show a notice
				new Notice("Please open a note to create a flashcard.")
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

				// CORRECTED: Removed the redundant backslashes on ']]'
				const globalPropMatch = content.match(/^\[\[(.*?)\]]\n?/);
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

					const questionLine = lines[0];
					const fitbMatch = questionLine.match(/(.*){{(.*)}}(.*)/);

					let card: Flashcard | null = null;
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
	// We now store a list of cards to be created, and the data for the card currently being edited.
	private cards: any[] = [];
	private currentCardData: any; // Will hold data for the card being edited

	// The callback to run when the user is finished creating the deck.
	private onSubmit: (result: string) => void;

	// A reference to the part of the modal that will be re-rendered.
	private formEl: HTMLElement;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.currentCardData = this.getEmptyCardData(); // Initialize the form for the first card
	}

	// Helper to get a clean object for a new card
	getEmptyCardData() {
		return {
			cardType: 'multiple-choice',
			question: '',
			correctAnswers: '',
			incorrectAnswers: '',
			fillBlankAnswer: '',
			bgColor: '',
			textColor: '',
		};
	}

	// onOpen now sets up the static parts of the modal (title, action buttons)
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Creating Flashcard #${this.cards.length + 1}` });

		// This container will hold the dynamic form for each card
		this.formEl = contentEl.createDiv();
		this.renderCardForm(this.formEl);

		// --- ACTION BUTTONS ---
		// These buttons are static and stay at the bottom of the modal.
		new Setting(contentEl)
			.addButton(button => button
				.setButtonText("Add Another Card")
				.onClick(() => {
					this.saveCurrentCard();
					this.currentCardData = this.getEmptyCardData(); // Clear the form
					this.onOpen(); // Re-render the whole modal to update the title and form
				}))
			.addButton(button => button
				.setButtonText("Finish & Insert Deck")
				.setCta() // Makes it the primary action button
				.onClick(() => {
					this.saveCurrentCard();
					const deckString = this.buildDeckString();
					if (deckString) {
						this.onSubmit(deckString);
					}
					this.close();
				}));
	}

	// This function builds the form for the *current* card being edited.
	renderCardForm(container: HTMLElement) {
		container.empty();

		new Setting(container)
			.setName('Card Type')
			.addDropdown(dropdown => dropdown
				.addOption('multiple-choice', 'Multiple Choice')
				.addOption('fill-in-the-blank', 'Fill-in-the-Blank')
				.setValue(this.currentCardData.cardType)
				.onChange(value => {
					this.currentCardData.cardType = value;
					this.renderCardForm(container); // Re-render to show correct fields
				}));

		new Setting(container)
			.setName('Question')
			.addText(text => text
				.setPlaceholder('What is the capital of France?')
				.setValue(this.currentCardData.question)
				.onChange(value => this.currentCardData.question = value));

		// --- DYNAMIC ANSWER FIELDS ---
		if (this.currentCardData.cardType === 'multiple-choice') {
			new Setting(container)
				.setName('Correct Answer(s)')
				.setDesc("Enter one correct answer per line.")
				.addTextArea(text => text
					.setPlaceholder("Paris")
					.setValue(this.currentCardData.correctAnswers)
					.onChange(value => this.currentCardData.correctAnswers = value)
					.inputEl.rows = 4);

			new Setting(container)
				.setName('Incorrect Answer(s)')
				.setDesc("Enter one incorrect answer per line.")
				.addTextArea(text => text
					.setPlaceholder("London\nBerlin")
					.setValue(this.currentCardData.incorrectAnswers)
					.onChange(value => this.currentCardData.incorrectAnswers = value)
					.inputEl.rows = 4);
		} else { // Fill-in-the-Blank
			new Setting(container)
				.setName('Answer')
				.setDesc("The text that will be hidden inside the {{brackets}}.")
				.addText(text => text
					.setPlaceholder("Paris")
					.setValue(this.currentCardData.fillBlankAnswer)
					.onChange(value => this.currentCardData.fillBlankAnswer = value));
		}

		// --- STYLE INPUTS ---
		new Setting(container)
			.setName('Custom Background Color').setDesc("(Optional)")
			.addText(text => text.setValue(this.currentCardData.bgColor).onChange(value => this.currentCardData.bgColor = value));
		new Setting(container)
			.setName('Custom Text Color').setDesc("(Optional)")
			.addText(text => text.setValue(this.currentCardData.textColor).onChange(value => this.currentCardData.textColor = value));
	}

	// --- DATA HANDLING ---
	saveCurrentCard() {
		// Only save if there's actually a question
		if (this.currentCardData.question.trim()) {
			this.cards.push({ ...this.currentCardData });
		}
	}

	buildDeckString(): string {
		return this.cards.map(cardData => {
			let cardString = '';
			const props = [];
			if (cardData.bgColor) props.push(`bg=${cardData.bgColor}`);
			if (cardData.textColor) props.push(`color=${cardData.textColor}`);
			if (props.length > 0) {
				cardString += `[${props.join(' ')}]\n`;
			}

			if (cardData.cardType === 'multiple-choice') {
				cardString += `${cardData.question}\n`;
				const correct = cardData.correctAnswers.trim().split('\n').map((ans: string) => `=${ans.trim()}`);
				const incorrect = cardData.incorrectAnswers.trim().split('\n').map((ans: string) => ans.trim());
				cardString += [...correct, ...incorrect].filter(Boolean).join('\n');
			} else {
				cardString += `${cardData.question} {{${cardData.fillBlankAnswer}}}`;
			}
			return cardString;
		}).join('\n---\n');
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
		new Setting(containerEl)
			.setName('Shuffle card order')
			.setDesc('If enabled, the order of the flashcards within a block will be randomized each time the note is loaded.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.shuffleCards)
				.onChange(async (value) => {
					this.plugin.settings.shuffleCards = value;
					await this.plugin.saveSettings();
					this.app.workspace.updateOptions();
				}));
		new Setting(containerEl)
			.setName('Shuffle answer choices')
			.setDesc('If enabled, the order of the multiple-choice answers will be randomized for each card.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.shuffleAnswers)
				.onChange(async (value) => {
					this.plugin.settings.shuffleAnswers = value;
					await this.plugin.saveSettings();
					this.app.workspace.updateOptions();
				}));
	}
}
