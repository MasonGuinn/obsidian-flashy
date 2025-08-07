![Flashy Banner](https://placehold.co/1400x200/2f3542/74b9ff?text=Flashy&font=raleway)

**Flashy** is a simple but powerful plugin for Obsidian that allows you to create and review interactive flashcards directly inside your notes. Using a clean and intuitive syntax, you can build decks for multiple-choice, fill-in-the-blank, and classic Q&A style cards.

It's perfect for students, lifelong learners, and anyone looking to reinforce knowledge without leaving their Obsidian vault. This project started as a way to study for cybersecurity topics, so it's built with flexibility in mind!

---

## ✨ Features

* **Multiple Card Types:** Create multiple-choice, fill-in-the-blank, and classic question/answer cards.
* **Intuitive Syntax:** Write flashcards using a simple, markdown-friendly syntax that's easy to remember.
* **Deck Creation:** Combine multiple cards into a single, reviewable deck within one code block.
* **Session Tracking:** Get a summary of your performance after completing a deck.
* **Interactive UI:** A clean, modern interface that works beautifully in both light and dark mode.
* **Ribbon Icon Creator:** Quickly create new cards using a handy pop-up modal, accessible from the Obsidian ribbon.
* **Keyboard Navigation:** Speed through your review sessions with hotkeys for navigation and answering.
* **Custom Styling:** Apply custom background and text colors to individual cards or entire decks.
* **Configurable:** Customize your experience with settings like shuffling cards and answers.

---

## Examples

<img width="642" height="434" alt="before" src="https://github.com/user-attachments/assets/b928b973-4583-448a-a8b3-c76444d30269" />

https://github.com/user-attachments/assets/0d2746dd-9705-4edd-926b-f9239e90d5c6

https://github.com/user-attachments/assets/42fe4236-116c-4bfd-83a4-0404626bcb41

https://github.com/user-attachments/assets/ffceeced-5a95-4bd3-beda-ffa55ae1b796





## 🚀 Creating Cards with the Ribbon Icon

For a more guided experience, you can use the Flashy modal:

1.  Click the **"Create Flashy Cards"** icon in the left-hand ribbon (it looks like a stack of blocks).
2.  A modal will pop up, allowing you to build a full deck of cards, one by one.
3.  Click **"Add New Card"** to add more cards to your deck, and use "Previous Card" to go back and edit.
4.  When you're done, click **"Finish & Insert Deck"**. The complete `flashy` code block will be inserted into your active note.

> **Note:** You must be in **Editing View** to insert cards from the modal.

---

## ✍️ Creating Cards with Markdown Code Blocks

Creating flashcards is as simple as adding a `flashy` code block to your note.

### The `flashy` Code Block

Start by fencing your content with ` ```flashy ` and end it with ` ``` `.

````
```flashy
[Your Cards Go Here]
```
````
### Card Types

Flashy supports three main types of cards.

#### 1. Multiple-Choice Cards
The first line is the question. Each following line is an answer choice. Mark one or more **correct** answers by starting the line with an equals sign (`=`). Incorrect answers have no prefix.

**Syntax:**
````
```flashy
What is 10+20?
=30
20
10
50
```
````

#### 2. Fill-in-the-Blank Cards
The entire card is on a single line. Write out the full sentence, but wrap the part you want to hide (the answer) in **double curly braces** `{{answer}}`.

**Syntax:**
````
```flashy
Humans have {{206}} bones in their body
```
````

#### 3. Classic Q&A Cards
The first line (or lines) is the question. The answer is separated by a line starting with `===`.

**Syntax:**
```
This plugin is
===Awesome
```

### Creating a Deck
To create a deck with multiple cards in one block, simply separate each card with `---` on a new line.

**Example:**
````
```flashy
What is 10+20?
=30
20
10
50
---
Humans have {{206}} bones in their body
---
This plugin is
===Awesome
```
````

### Custom Styling (Optional)
You can apply custom background to your cards. More customization will be added in later updates.

* **Block-Level Styling:** To apply a style to **every card** in a `flashy` block, add a properties line at the very top using double brackets
    `[[bg=#2c3e50]]`

* **Card-Level Styling:** To style just a **single card**, use single brackets at the beginning of that specific card. This will override any block-level styles.
    `[bg=gold]`

---

## 📦 Manual Installation

This plugin is not yet in the community store. To install it manually:

1.  Download the `main.js`, `styles.css`, and `manifest.json` files from the latest [GitHub Release](https://github.com/MasonGuinn/obsidian-flashy/releases).
2.  Create a new folder named `flashy` inside your Obsidian vault's `/.obsidian/plugins/` directory.
3.  Place the three downloaded files inside the new `flashy` folder.
4.  Reload Obsidian.
5.  Go to `Settings -> Community Plugins`, find "Flashy", and enable it.

---

## 💓 Support

<a href="https://www.buymeacoffee.com/MasonGuinn" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

[Sponsor @MasonGuinn on GitHub](https://github.com/sponsors/MasonGuinn)



