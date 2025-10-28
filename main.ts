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

/**
 * Base interface for all flashcard types.
 * Defines common properties like type, question, and custom styling.
 */
interface BaseFlashcard {
	type: 'multiple-choice' | 'fill-in-the-blank' | 'qa';
	question: string;
	customBackgroundColor?: string;
	customTextColor?: string;
}

/**
 * Represents a multiple-choice flashcard.
 * Extends BaseFlashcard with an array of possible answers, each with text and a correctness flag.
 */
interface MultipleChoiceCard extends BaseFlashcard {
	type: 'multiple-choice';
	answers: { text: string; isCorrect: boolean; }[];
}

/**
 * Represents a fill-in-the-blank flashcard.
 * Extends BaseFlashcard with an answer and an optional second part for the question
 * (used when the blank is in the middle of a sentence).
 */
interface FillInTheBlankCard extends BaseFlashcard {
	type: 'fill-in-the-blank';
	questionPartTwo?: string;
	answer: string;
}

/**
 * Represents a Question/Answer flashcard.
 * Extends BaseFlashcard with a direct answer to the question.
 */
interface QACard extends BaseFlashcard {
	type: 'qa';
	answer: string;
}

/**
 * Union type for all possible flashcard types.
 */
type Flashcard = MultipleChoiceCard | FillInTheBlankCard | QACard;

export type FlashyCardType = 'multiple-choice' | 'fill-in-the-blank' | 'qa';

interface ModalCardData {
	cardType: FlashyCardType;
	question: string;
	correctAnswers: string;
	incorrectAnswers: string;
	fitbText: string;
	qaAnswer: string;

	bgColor: string;
	textColor: string;
}

/**
 * Interface for the plugin's settings.
 * Defines configurable options such as card shuffling, auto-advancement,
 * and default card types for the creation modal.
 */
interface FlashyPluginSettings {
	shuffleCards: boolean;
	shuffleAnswers: boolean;
	autoAdvance: boolean;
	autoAdvanceIncorrect: boolean;
	autoAdvanceDelay: number;
	defaultModalCardType: 'multiple-choice' | 'fill-in-the-blank' | 'qa';
	keyPreviousCard: string;
	keyNextCard: string;
	keyResetSession: string;
	enableKeyboardNav: boolean;
}

/**
 * Default settings for the Flashy plugin.
 */
const DEFAULT_SETTINGS: FlashyPluginSettings = {
	shuffleCards: false,
	shuffleAnswers: true,
	autoAdvance: false,
	autoAdvanceIncorrect: false,
	autoAdvanceDelay: 1000,
	defaultModalCardType: 'multiple-choice',
	keyPreviousCard: 'ArrowLeft',
	keyNextCard: 'ArrowRight',
	keyResetSession: 'r',
	enableKeyboardNav: true,
}

/**
 * Main plugin class for Flashy.
 * Handles plugin lifecycle, settings, ribbon icon, and markdown code block processing.
 */
export default class FlashyPlugin extends Plugin {
	settings: FlashyPluginSettings;

	/**
	 * Called when the plugin is loaded.
	 */
	async onload() {
		await this.loadSettings();

		/**
		 * Registers a ribbon icon to the Obsidian UI.
		 * Clicking this icon opens a modal for creating new flashcards.
		 */
		this.addRibbonIcon('blocks', 'Create flashy cards', () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				if (view.getMode() === 'source') {
					new FlashcardCreatorModal(this.app, this.settings, (result) => {
						if (result) {
							view.editor.replaceSelection(`\n\`\`\`flashy\n${result}\n\`\`\`\n`);
						}
					}).open();
				} else {
					new Notice("Please switch to editing view to create a flashcard.");
				}
			} else {
				new Notice("Please open a note to create a flashcard.");
			}
		});

		/**
		 * Registers a markdown code block processor for 'flashy' blocks.
		 * This function is responsible for rendering and managing the interactive flashcards.
		 */
		this.registerMarkdownCodeBlockProcessor('flashy', (source, el, ctx) => {
			const settings = this.settings;

			let currentCardIndex: number;
			let stats: { correct: number, incorrect: number, answered: number };
			let answeredCardIndexes: Set<number>;
			let cardsToRender: Flashcard[];
			const allCards = parseAllCards(source);

			if (allCards.length === 0) {
				el.createEl('p', { text: 'No valid flashy cards found. Check your syntax!', cls: 'flashcard-error' });
				return;
			}

			// Fisher-Yates shuffle algorithm to randomize an array.
			function fisherYatesShuffle<T>(array: T[]): T[] {
				const arr = [...array];
				for (let i = arr.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[arr[i], arr[j]] = [arr[j], arr[i]];
				}
				return arr;
			}

			// Initialize/reset deck function
			function initializeDeck() {
				// Store the card that is *currently* at index 0 before resetting
				const previousFirstCard = cardsToRender ? cardsToRender[0] : undefined;

				// Reset stats
				stats = { correct: 0, incorrect: 0, answered: 0 };
				answeredCardIndexes = new Set<number>();

				// Shuffle logic with the added check
				if (settings.shuffleCards && allCards.length > 1) {
					do {
						cardsToRender = fisherYatesShuffle(allCards);
					} while (previousFirstCard !== undefined && cardsToRender[0] === previousFirstCard);
				} else {
					cardsToRender = [...allCards];
				}

				// Always start at the beginning
				currentCardIndex = 0;
			}

			const mainContainer = el.createDiv({ cls: 'flashcard-container' });
			const child = new MarkdownRenderChild(mainContainer);
			ctx.addChild(child);

			/**
			 * Handles keyboard navigation and interaction within the flashcard block.
			 * @param event The KeyboardEvent object.
			 */
			const handleKeyDown = (event: KeyboardEvent) => {
				if (!settings.enableKeyboardNav) return;
				const activeEl = el.win.document.activeElement;
				const isTyping = activeEl && activeEl.tagName === 'INPUT';

				// Don't intercept keys if the flashcard block isn't focused/hovered
				if (!el.contains(activeEl) && !el.matches(':hover')) return;

				if (event.key === settings.keyPreviousCard) {
					event.preventDefault();
					if (currentCardIndex > 0) renderCard(currentCardIndex - 1);
				} else if (event.key === settings.keyNextCard) {
					event.preventDefault();
					if (currentCardIndex < cardsToRender.length - 1) renderCard(currentCardIndex + 1);
				} else if (event.key.toLowerCase() === settings.keyResetSession.toLowerCase()) {
					if (isTyping) return;
					event.preventDefault();
					initializeDeck();
					renderCard(0);
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

			/**
			 * Callback function invoked when a card is graded (answered).
			 * Updates statistics and handles auto-advancement.
			 */
			const onGraded = (isCorrect: boolean) => {
				if (answeredCardIndexes.has(currentCardIndex)) {
					return;
				}
				answeredCardIndexes.add(currentCardIndex);

				if (isCorrect) stats.correct++;
				else stats.incorrect++;
				stats.answered++;

				// Check if we should auto advance
				const shouldAdvance = (isCorrect && settings.autoAdvance) || (!isCorrect && settings.autoAdvanceIncorrect);

				if (shouldAdvance && currentCardIndex < cardsToRender.length - 1) {
					window.setTimeout(() => {
						renderCard(currentCardIndex + 1);
					}, settings.autoAdvanceDelay);
				}

				if (stats.answered === cardsToRender.length) {
					window.setTimeout(() => renderSummary(), 1000);
				}
			};

			/**
			 * Renders a specific flashcard based on its index.
			 * Clears the container and renders the appropriate card type and controls.
			 * @param index The index of the card to render.
			 */
			function renderCard(index: number) {
				currentCardIndex = index;
				mainContainer.empty();
				const cardData = cardsToRender[index];
				if (!cardData) return;

				if (cardData.customBackgroundColor) {
					mainContainer.style.setProperty('--flashy-bg-override', cardData.customBackgroundColor);
				} else {
					mainContainer.style.removeProperty('--flashy-bg-override');
				}

				if (cardData.customTextColor) {
					mainContainer.style.setProperty('--flashy-text-override', cardData.customTextColor);
				} else {
					mainContainer.style.removeProperty('--flashy-text-override');
				}

				renderHeader(mainContainer, cardData);
				const body = mainContainer.createDiv({ cls: 'flashcard-body' });

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

			/**
			 * Renders the summary screen after all cards have been answered.
			 */
			function renderSummary() {
				mainContainer.empty();
				const summaryEl = mainContainer.createDiv({ cls: 'flashcard-summary' });
				summaryEl.createEl('h3', { text: 'Session complete!' });
				const score = cardsToRender.length > 0 ? (stats.correct / cardsToRender.length * 100) : 0;
				summaryEl.createEl('p', { text: `You answered ${stats.correct} out of ${cardsToRender.length} cards correctly on the first try.` });
				summaryEl.createEl('p', { text: `Score: ${score.toFixed(0)}%` });

				const resetButton = summaryEl.createEl('button', { text: 'Review again', cls: 'flashcard-reset' });
				resetButton.addEventListener('click', () => {
					initializeDeck();
					renderCard(0);
				});
			}

			/**
			 * Renders the header section of a flashcard, including the question and a reset button.
			 * @param container The HTMLElement to append the header to.
			 * @param card The Flashcard data.
			 */
			function renderHeader(container: HTMLElement, card: Flashcard) {
				const header = container.createDiv({ cls: 'flashcard-header' });

				const titleContainer = header.createDiv();
				let questionText = card.question;
				if (card.type === 'fill-in-the-blank' && card.questionPartTwo) {
					questionText += " ___ " + card.questionPartTwo;
				}
				titleContainer.createEl('p', { text: questionText, cls: 'flashcard-question' });

				const resetButton = header.createEl('button', { cls: 'flashcard-reset flashy-icon-button' });
				setIcon(resetButton, 'refresh-cw');
				resetButton.ariaLabel = "Reset session (R)";
				resetButton.addEventListener('click', () => {
					initializeDeck();
					renderCard(0);
				});
			}

			/**
			 * Renders the body for a multiple-choice flashcard.
			 * @param container The HTMLElement to append the body to.
			 * @param card The MultipleChoiceCard data.
			 * @param onGraded Callback function to call when the card is graded.
			 */
			function renderMultipleChoiceBody(container: HTMLElement, card: MultipleChoiceCard, onGraded: (correct: boolean) => void) {
				const buttonsContainer = container.createDiv({ cls: 'flashcard-buttons' });
				const answers = card.answers;
				const answersToShow = settings.shuffleAnswers ? fisherYatesShuffle(answers) : answers;
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

			/**
			 * Renders the body for a fill-in-the-blank flashcard.
			 * @param container The HTMLElement to append the body to.
			 * @param card The FillInTheBlankCard data.
			 * @param onGraded Callback function to call when the card is graded.
			 */
			function renderFillInTheBlankBody(container: HTMLElement, card: FillInTheBlankCard, onGraded: (correct: boolean) => void) {
				const formContainer = container.createDiv({ cls: 'flashcard-fill-container' });
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
						const reveal = container.createEl('p', { cls: 'flashcard-correct-answer-reveal' });
						reveal.appendText('The correct answer was: ');
						reveal.createEl('span', { text: card.answer });
					}
				};
				submitButton.addEventListener('click', checkAnswer);
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); checkAnswer(); }
				});
			}

			/**
			 * Renders the body for a Question/Answer flashcard.
			 * @param container The HTMLElement to append the body to.
			 * @param card The QACard data.
			 * @param onGraded Callback function to call when the card is graded.
			 */
			function renderQABody(container: HTMLElement, card: QACard, onGraded: (correct: boolean) => void) {
				const qaContainer = container.createDiv({ cls: 'qa-container' });
				const answerContainer = qaContainer.createDiv({ cls: 'qa-answer-container', text: card.answer });
				answerContainer.hide();

				const gradingContainer = qaContainer.createDiv({ cls: 'qa-grading-buttons' });
				gradingContainer.hide();

				const showAnswerButton = qaContainer.createEl('button', { text: "Show answer", cls: 'mod-cta' });

				const gradeCorrectButton = gradingContainer.createEl('button', { text: 'I was right', cls: 'qa-grading-button correct' });
				const gradeIncorrectButton = gradingContainer.createEl('button', { text: 'I was wrong', cls: 'qa-grading-button incorrect' });

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

			/**
			 * Renders navigation controls (previous/next buttons and progress indicator).
			 * @param container The HTMLElement to append the controls to.
			 * @param currentIndex The current index of the displayed card.
			 * @param total The total number of cards.
			 * @param onNavigate Callback function to navigate to a new card index.
			 */
			function renderControls(container: HTMLElement, currentIndex: number, total: number, onNavigate: (newIndex: number) => void) {
				const controls = container.createDiv({ cls: 'flashcard-controls' });

				const prevButton = controls.createEl('button', { cls: 'flashcard-nav flashy-icon-button' });
				setIcon(prevButton, 'arrow-left');
				prevButton.ariaLabel = 'Previous card (left arrow)';
				prevButton.disabled = currentIndex === 0;
				prevButton.addEventListener('click', () => onNavigate(currentIndex - 1));

				const middleContainer = controls.createDiv({ cls: 'flashcard-middle-controls' });
				if (total > 1) {
					middleContainer.createEl('span', { text: `${currentIndex + 1} / ${total}`, cls: 'flashcard-progress' });
				}

				const nextButton = controls.createEl('button', { cls: 'flashcard-nav flashy-icon-button' });
				setIcon(nextButton, 'arrow-right');
				nextButton.ariaLabel = 'Next card (right arrow)';
				nextButton.disabled = currentIndex >= total - 1;
				nextButton.addEventListener('click', () => onNavigate(currentIndex + 1));
			}

			/**
			 * Parses the source string of a flashy code block into an array of Flashcard objects.
			 * @param source The raw string content of the flashy code block.
			 */
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
					const lines = block.trim().split('\n').filter(line => line.trim().length > 0);
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

					const qaSeparatorIndex = lines.findIndex(line => line.trim().startsWith('==='));
					if (qaSeparatorIndex > -1) {
						const question = lines.slice(0, qaSeparatorIndex).join('\n').trim();
						const answer = lines[qaSeparatorIndex].trim().substring(3).trim();

						if (question && answer) {
							card = { type: 'qa', question, answer } as QACard;
						}
					} else {
						const questionLine = lines[0];
						const fitbMatch = questionLine.match(/(.*){{(.*)}}(.*)/);
						if (fitbMatch && fitbMatch[2]) {
							const [, q1, answer, q2] = fitbMatch;
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

			initializeDeck();
			renderCard(0);

		});

		this.addSettingTab(new FlashySettingTab(this.app, this));
	}

	/**
	 * Called when the plugin is unloaded.
	 */
	onunload() { }

	/**
	 * Loads the plugin settings from storage.
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Saves the plugin settings to storage.
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Modal for creating and editing flashcards.
 * Allows users to define multiple-choice, fill-in-the-blank, or Q&A cards.
 */
class FlashcardCreatorModal extends Modal {
	private cards: ModalCardData[] = [];
	private editingIndex = 0;
	private readonly onSubmit: (result: string) => void;
	private settings: FlashyPluginSettings;

	/**
	 * Creates an instance of FlashcardCreatorModal.
	 * @param app The Obsidian App instance.
	 * @param settings The plugin settings, used for default card type.
	 * @param onSubmit Callback function to execute when the deck is finished and inserted.
	 */
	constructor(app: App, settings: FlashyPluginSettings, onSubmit: (result: string) => void) {
		super(app);
		this.settings = settings;
		this.onSubmit = onSubmit;
		this.cards.push(this.getEmptyCardData());
	}

	/** Returns an empty card data object with default values. */

	getEmptyCardData() {
		return {
			cardType: this.settings.defaultModalCardType,
			question: '',
			correctAnswers: '',
			incorrectAnswers: '',
			fitbText: '',
			qaAnswer: '',
			bgColor: '',
			textColor: '',
		};
	}

	/**
	 * Renders the main content of the modal, including navigation and the card form.
	 */
	renderContent() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: `Editing flashcard ${this.editingIndex + 1} of ${this.cards.length}` });

		this.renderCardForm(contentEl.createDiv());

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText("Previous card")
				.setDisabled(this.editingIndex === 0)
				.onClick(() => {
					if (this.editingIndex > 0) {
						this.editingIndex--;
						this.renderContent();
					}
				}))
			.addButton(button => button
				.setButtonText(this.editingIndex === this.cards.length - 1 ? "Add new card" : "Next card")
				.onClick(() => {
					this.editingIndex++;
					if (this.editingIndex === this.cards.length) {
						this.cards.push(this.getEmptyCardData());
					}
					this.renderContent();
				}));

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText("Finish & insert deck")
				.setCta()
				.onClick(() => {
					const deckString = this.buildDeckString();
					if (deckString) {
						this.onSubmit(deckString);
					}
					this.close();
				}));
	}

	/**
	 * Renders the form for editing a single flashcard based on its type.
	 * @param container The HTMLElement to append the card form to.
	 */
	renderCardForm(container: HTMLElement) {
		const cardData = this.cards[this.editingIndex];

		new Setting(container)
			.setName('Card type')
			.addDropdown(dropdown => dropdown
				.addOption('multiple-choice', 'Multiple choice')
				.addOption('fill-in-the-blank', 'Fill-in-the-blank')
				.addOption('qa', 'Question/answer')
				.setValue(cardData.cardType)
				.onChange(value => {
					cardData.cardType = value as FlashyCardType;
					this.renderContent();
				}));

		if (cardData.cardType === 'multiple-choice') {
			new Setting(container)
				.setName('Question')
				.addText(text => text.setPlaceholder('e.g., Which layer is the network layer?').setValue(cardData.question).onChange(value => cardData.question = value));

			new Setting(container)
				.setName('Correct answer(s)').setDesc("One answer per line.")
				.addTextArea(text => {
					text.setPlaceholder("e.g., Layer 3").setValue(cardData.correctAnswers).onChange(value => cardData.correctAnswers = value);
					text.inputEl.rows = 4;
				});

			new Setting(container)
				.setName('Incorrect answer(s)').setDesc("One answer per line.")
				.addTextArea(text => {
					text.setPlaceholder("e.g., Layer 2\nLayer 7").setValue(cardData.incorrectAnswers).onChange(value => cardData.incorrectAnswers = value);
					text.inputEl.rows = 4;
				});
		} else if (cardData.cardType === 'fill-in-the-blank') {
			new Setting(container)
				.setName('Full text').setDesc("Wrap the answer in {{double curly braces}}.")
				.addTextArea(text => {
					text.setPlaceholder("e.g., The OSI model has {{seven}} layers.").setValue(cardData.fitbText).onChange(value => cardData.fitbText = value);
					text.inputEl.rows = 4;
				});
		} else {
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
			.setName('Custom background color').setDesc("(optional)")
			.addText(text => text.setValue(cardData.bgColor).onChange(value => cardData.bgColor = value));
		new Setting(container)
			.setName('Custom text color').setDesc("(optional)")
			.addText(text => text.setValue(cardData.textColor).onChange(value => cardData.textColor = value));
	}

	/**
	 * Builds the final markdown string for the flashcard deck based on the collected card data.
	 */
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
					case 'multiple-choice': {
						cardString += `${cardData.question}\n`;
						const correct = cardData.correctAnswers.trim().split('\n').map((ans: string) => `=${ans.trim()}`);
						const incorrect = cardData.incorrectAnswers.trim().split('\n').map((ans: string) => ans.trim());
						cardString += [...correct, ...incorrect].filter(Boolean).join('\n');
						break;
					}
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

	/** Called when the modal is opened. */
	onOpen() {
		this.renderContent();
	}

	/** Called when the modal is closed. */
	onClose() {
		this.contentEl.empty();
	}
}

/**
 * Plugin setting tab for Flashy.
 * Allows users to configure various plugin behaviors and default card creation options.
 */
class FlashySettingTab extends PluginSettingTab {
	plugin: FlashyPlugin;

	/**
	 * Creates an instance of FlashySettingTab.
	 * @param app The Obsidian App instance.
	 * @param plugin The FlashyPlugin instance.
	 */
	constructor(app: App, plugin: FlashyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Behavior heading
		new Setting(containerEl).setName('Behavior').setHeading();

		// Shuffle card order
		new Setting(containerEl)
			.setName('Shuffle card order')
			.setDesc('Randomize the order of cards within a block each session.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.shuffleCards).onChange(async (value) => {
				this.plugin.settings.shuffleCards = value; await this.plugin.saveSettings(); this.app.workspace.updateOptions();
			}));

		// Shuffle answer choices
		new Setting(containerEl)
			.setName('Shuffle answer choices')
			.setDesc('Randomize the order of answers for multiple-choice cards.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.shuffleAnswers).onChange(async (value) => {
				this.plugin.settings.shuffleAnswers = value; await this.plugin.saveSettings(); this.app.workspace.updateOptions();
			}));

		// Auto-advance on correct
		new Setting(containerEl)
			.setName('Auto-advance on correct')
			.setDesc('Automatically move to the next card after a correct answer.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.autoAdvance).onChange(async (value) => {
				this.plugin.settings.autoAdvance = value; await this.plugin.saveSettings();
			}));

		// Auto-advance on incorrect
		new Setting(containerEl)
			.setName('Auto-advance on incorrect')
			.setDesc('Automatically move to the next card after an incorrect answer.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.autoAdvanceIncorrect).onChange(async (value) => {
				this.plugin.settings.autoAdvanceIncorrect = value;
				await this.plugin.saveSettings();
			}));

		// Auto-advance delay
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

		// Card creation heading
		new Setting(containerEl).setName('Card creation').setHeading();

		// Default card type in modal
		new Setting(containerEl)
			.setName('Default card type in modal')
			.setDesc('Choose the default card type when opening the card creation modal.')
			.addDropdown(dropdown => dropdown
				.addOption('multiple-choice', 'Multiple choice')
				.addOption('fill-in-the-blank', 'Fill-in-the-blank')
				.addOption('qa', 'Question/answer')
				.setValue(this.plugin.settings.defaultModalCardType)
				.onChange(async (value) => {
					this.plugin.settings.defaultModalCardType = value as FlashyCardType;
					await this.plugin.saveSettings();
				}));

		// Keyboard shortcuts heading
		new Setting(containerEl).setName('Keyboard shortcuts').setHeading();

		new Setting(containerEl)
			.setName('Enable keyboard navigation')
			.setDesc('Allow using keys (like arrows, R, 1-9) to navigate and interact with flashcards while focused.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableKeyboardNav)
				.onChange(async (value) => {
					this.plugin.settings.enableKeyboardNav = value;
					await this.plugin.saveSettings();
					this.display();
				})
			)

		// Conditionally show/hide specific key settings
		if (this.plugin.settings.enableKeyboardNav) {
			// Previous card key
			new Setting(containerEl)
				.setName('Previous card key')
				.setDesc('Key to navigate to the previous card. Use values like "ArrowLeft", "a", "PageUp", etc.')
				.addText(text => text
					.setPlaceholder('ArrowLeft')
					.setValue(this.plugin.settings.keyPreviousCard)
					.onChange(async (value) => {
						this.plugin.settings.keyPreviousCard = value.trim();
						await this.plugin.saveSettings();
					}));

			// Next card key
			new Setting(containerEl)
				.setName('Next card key')
				.setDesc('Key to navigate to the next card. Use values like "ArrowRight", "d", "PageDown", etc.')
				.addText(text => text
					.setPlaceholder('ArrowRight')
					.setValue(this.plugin.settings.keyNextCard)
					.onChange(async (value) => {
						this.plugin.settings.keyNextCard = value.trim();
						await this.plugin.saveSettings();
					}));

			// Reset session key
			new Setting(containerEl)
				.setName('Reset session key')
				.setDesc('Key to reset the current session. Use values like "r", "R", "F5" etc.')
				.addText(text => text
					.setPlaceholder('r')
					.setValue(this.plugin.settings.keyResetSession)
					.onChange(async (value) => {
						this.plugin.settings.keyResetSession = value.trim();
						await this.plugin.saveSettings();
					}));
		}

		// Support heading
		new Setting(containerEl).setName('Support').setHeading();

		// Sponsor development
		new Setting(containerEl)
			.setName('Sponsor development')
			.setDesc('If you find Flashy useful, please consider supporting its development. It makes a huge difference!')
			.addButton(button => button
				.setButtonText("Buy me a coffee")
				.setTooltip("https://buymeacoffee.com/masonguinn")
				.onClick(() => {
					window.open("https://buymeacoffee.com/masonguinn");
				}))
			.controlEl.createEl('iframe', {
				attr: {
					src: "https://github.com/sponsors/MasonGuinn/button",
					title: "Sponsor MasonGuinn",
					height: "32",
					width: "114",
				},
				cls: "flashy-sponsor-iframe"
			});
	}
}