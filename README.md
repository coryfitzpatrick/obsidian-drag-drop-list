# Drag & Drop List Items

Reorder list items in Obsidian by dragging and dropping. Works with bullet lists, numbered lists, and task/checkbox lists in both Reading View and Live Preview.

## Features

- **Drag handles** appear on hover to the left of list items
- **Reading View**: visible grip handle icon
- **Live Preview (CodeMirror)**: handle in the left margin of list lines
- **Ordered list renumbering**: automatically renumbers items after reordering
- **Child items**: moving a parent item moves all its children along with it
- **Drop indicator**: visual line shows where the item will be placed

## Usage

1. Hover over any list item to reveal the drag handle
2. Click and drag the handle to reorder
3. Release to drop the item in its new position

Works with:
- Bullet lists (`-`, `*`, `+`)
- Numbered lists (`1.`, `2.`, etc.)
- Task lists (`- [ ]`, `- [x]`)
- Obsidian Tasks plugin items

## Installation

Search for **Drag & Drop List Items** in Obsidian's Community Plugins browser, or manually copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/drag-drop-list/` folder.
