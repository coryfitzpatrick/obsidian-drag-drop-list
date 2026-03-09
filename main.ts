import { Plugin, MarkdownView, Editor } from "obsidian";

interface ListItem {
	line: number;
	text: string;
	indent: number;
	children: ListItem[];
}

interface DragState {
	sourceLine: number;
	sourceItems: ListItem[];
	ghost: HTMLElement | null;
	indicator: HTMLElement | null;
	targetLine: number;
	targetPosition: "before" | "after";
	editor: Editor;
	container: HTMLElement;
}

export default class DragDropListPlugin extends Plugin {
	private dragState: DragState | null = null;
	private handleContainers = new WeakSet<HTMLElement>();
	private debounceTimer: number | null = null;
	private isUpdatingDOM = false;
	private mutationObserver: MutationObserver | null = null;
	private globalMouseDownHandler: ((e: MouseEvent) => void) | null = null;

	async onload() {
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.scheduleAttach();
			})
		);
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.scheduleAttach();
			})
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.scheduleAttach();
			})
		);
		this.app.workspace.onLayoutReady(() => {
			this.scheduleAttach();
		});

		this.globalMouseDownHandler = (e: MouseEvent) => {
			this.onGlobalMouseDown(e);
		};
		document.addEventListener(
			"mousedown",
			this.globalMouseDownHandler,
			true
		);

		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (
						node instanceof HTMLElement &&
						(node.matches(
							".block-language-tasks, .tasks-plugin-main-list, .plugin-tasks-list-item, .task-list-item"
						) ||
							node.querySelector(
								".block-language-tasks, .tasks-plugin-main-list, .plugin-tasks-list-item, .task-list-item"
							))
					) {
						this.scheduleAttach();
						return;
					}
				}
			}
		});
		this.mutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	onunload() {
		this.removeAllHandles();
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}
		if (this.globalMouseDownHandler) {
			document.removeEventListener(
				"mousedown",
				this.globalMouseDownHandler,
				true
			);
			this.globalMouseDownHandler = null;
		}
	}

	private scheduleAttach() {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.attachToActiveView();
		}, 150);
	}

	private attachToActiveView() {
		const view =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const container = view.contentEl;
		this.addHandlesToReadingView(container);
	}

	/**
	 * Only add handles to reading view <li> elements.
	 * For live preview (CM), we use CSS ::after + event delegation instead.
	 */
	private addHandlesToReadingView(container: HTMLElement) {
		if (this.isUpdatingDOM) return;
		this.isUpdatingDOM = true;
		const readingItems = container.querySelectorAll(
			".markdown-reading-view li, .markdown-reading-view .task-list-item, .markdown-reading-view [data-task], .tasks-plugin-main-list li, .plugin-tasks-list-item"
		);
		readingItems.forEach((li) => {
			if (
				li instanceof HTMLElement &&
				!li.querySelector(":scope > .ddl-drag-handle")
			) {
				this.addDragHandle(li, container);
			}
		});
		this.isUpdatingDOM = false;
	}

	private createHandleSVG(): SVGSVGElement {
		const svg = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"svg"
		);
		svg.setAttribute("viewBox", "0 0 12 28");
		svg.setAttribute("fill", "none");
		svg.setAttribute("stroke", "currentColor");
		svg.setAttribute("stroke-width", "2");
		svg.setAttribute("stroke-linecap", "round");
		for (const y of [7, 14, 21]) {
			const line = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"line"
			);
			line.setAttribute("x1", "1");
			line.setAttribute("y1", String(y));
			line.setAttribute("x2", "11");
			line.setAttribute("y2", String(y));
			svg.appendChild(line);
		}
		return svg;
	}

	private addDragHandle(li: HTMLElement, container: HTMLElement) {
		li.classList.add("ddl-list-item-wrapper");
		const handle = document.createElement("div");
		handle.className = "ddl-drag-handle";
		handle.appendChild(this.createHandleSVG());
		handle.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.startDragReading(e, li, container);
		});
		li.insertBefore(handle, li.firstChild);
	}

	private removeAllHandles() {
		document
			.querySelectorAll(".ddl-drag-handle")
			.forEach((h) => h.remove());
		document
			.querySelectorAll(".ddl-list-item-wrapper")
			.forEach((el) => el.classList.remove("ddl-list-item-wrapper"));
		document
			.querySelectorAll(".ddl-cm-list-line")
			.forEach((el) => el.classList.remove("ddl-cm-list-line"));
	}

	// ---- Global mousedown for CM drag handles (event delegation) ----

	private onGlobalMouseDown(e: MouseEvent) {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;
		const cmLine = target.closest(".cm-line");
		if (!cmLine || !(cmLine instanceof HTMLElement)) return;
		if (!this.isListItemLine(cmLine)) return;
		const lineRect = cmLine.getBoundingClientRect();
		const clickX = e.clientX;
		const contentLeft = lineRect.left;
		if (clickX > contentLeft + 30) return;
		const container = cmLine.closest(".markdown-source-view");
		if (!container || !(container instanceof HTMLElement)) return;
		e.preventDefault();
		e.stopPropagation();
		this.startDragCM(e, cmLine, container);
	}

	private isListItemLine(el: HTMLElement): boolean {
		return (
			el.classList.contains("HyperMD-list-line") ||
			el.querySelector(".cm-formatting-list") !== null ||
			el.querySelector("[class*='cm-list-']") !== null ||
			el.querySelector("input[type='checkbox']") !== null ||
			el.querySelector(".task-list-item-checkbox") !== null ||
			/^\s*[-*+]\s/.test(el.textContent || "") ||
			/^\s*[-*+]\s*\[.\]\s/.test(el.textContent || "") ||
			/^\s*\d+\.\s/.test(el.textContent || "")
		);
	}

	// ---- Reading View Drag ----

	private startDragReading(
		e: MouseEvent,
		li: HTMLElement,
		container: HTMLElement
	) {
		const view =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;
		const lineIndex = this.findLineForReadingLi(li);
		if (lineIndex === -1) return;
		const items = this.parseListItems(editor);
		const sourceItem = items.find((item) => item.line === lineIndex);
		if (!sourceItem) return;
		const sourceItems = this.getItemWithChildren(sourceItem, items);
		li.classList.add("ddl-dragging");
		document.body.classList.add("ddl-drag-active");
		const ghost = this.createGhost(
			this.getDirectTextContent(li).trim(),
			e.clientX,
			e.clientY
		);
		const indicator = this.createIndicator(container);
		this.dragState = {
			sourceLine: lineIndex,
			sourceItems,
			ghost,
			indicator,
			targetLine: -1,
			targetPosition: "after",
			editor,
			container,
		};
		const onMouseMove = (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			window.getSelection()?.removeAllRanges();
			this.onDragMoveReading(ev, container);
		};
		const preventSelect = (ev: Event) => ev.preventDefault();
		document.addEventListener("selectstart", preventSelect, true);
		window.getSelection()?.removeAllRanges();
		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove, true);
			document.removeEventListener("mouseup", onMouseUp, true);
			document.removeEventListener(
				"selectstart",
				preventSelect,
				true
			);
			li.classList.remove("ddl-dragging");
			document.body.classList.remove("ddl-drag-active");
			this.finishDrag();
		};
		document.addEventListener("mousemove", onMouseMove, true);
		document.addEventListener("mouseup", onMouseUp, true);
	}

	private onDragMoveReading(e: MouseEvent, container: HTMLElement) {
		if (!this.dragState) return;
		if (this.dragState.ghost) {
			this.dragState.ghost.style.left = `${e.clientX + 12}px`;
			this.dragState.ghost.style.top = `${e.clientY - 10}px`;
		}
		const allLis = container.querySelectorAll(
			".markdown-reading-view li, .tasks-plugin-main-list li, .plugin-tasks-list-item"
		);
		let closest: HTMLElement | null = null;
		let closestDist = Infinity;
		let position = "after" as "before" | "after";
		allLis.forEach((targetLi) => {
			if (!(targetLi instanceof HTMLElement)) return;
			const rect = targetLi.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const dist = Math.abs(e.clientY - midY);
			if (dist < closestDist) {
				closestDist = dist;
				closest = targetLi;
				position = e.clientY < midY ? "before" : "after";
			}
		});
		if (closest && this.dragState.indicator) {
			const rect = (closest as HTMLElement).getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const scrollTop = container.scrollTop || 0;
			const y =
				position === "before"
					? rect.top - containerRect.top + scrollTop
					: rect.bottom - containerRect.top + scrollTop;
			this.dragState.indicator.style.top = `${y}px`;
			this.dragState.indicator.style.display = "block";
			const targetLine = this.findLineForReadingLi(
				closest as HTMLElement
			);
			if (targetLine !== -1) {
				this.dragState.targetLine = targetLine;
				this.dragState.targetPosition = position;
			}
		}
	}

	private findLineForReadingLi(li: HTMLElement): number {
		const view =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return -1;
		const editor = view.editor;
		const text = this.getDirectTextContent(li).trim();
		if (!text) return -1;
		for (let i = 0; i < editor.lineCount(); i++) {
			const lineText = editor.getLine(i);
			const stripped = lineText
				.replace(/^\s*[-*+]\s+(\[.\]\s+)?|^\s*\d+\.\s+/, "")
				.trim();
			if (stripped === text) {
				return i;
			}
		}
		return -1;
	}

	private getDirectTextContent(el: HTMLElement): string {
		let text = "";
		el.childNodes.forEach((node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				text += node.textContent;
			} else if (
				node instanceof HTMLElement &&
				!node.classList.contains("ddl-drag-handle") &&
				node.tagName !== "UL" &&
				node.tagName !== "OL"
			) {
				text += node.textContent;
			}
		});
		return text;
	}

	// ---- CodeMirror (Live Preview) Drag ----

	private startDragCM(
		e: MouseEvent,
		line: HTMLElement,
		container: HTMLElement
	) {
		const view =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;
		const lineIndex = this.getEditorLineFromCMLine(line, editor);
		if (lineIndex === -1) return;
		const items = this.parseListItems(editor);
		const sourceItem = items.find((item) => item.line === lineIndex);
		if (!sourceItem) return;
		const sourceItems = this.getItemWithChildren(sourceItem, items);
		line.classList.add("ddl-dragging");
		document.body.classList.add("ddl-drag-active");
		const ghost = this.createGhost(
			line.textContent?.trim() || "",
			e.clientX,
			e.clientY
		);
		const scroller =
			container.querySelector(".cm-scroller") || container;
		const indicator = this.createIndicator(
			scroller instanceof HTMLElement ? scroller : container
		);
		this.dragState = {
			sourceLine: lineIndex,
			sourceItems,
			ghost,
			indicator,
			targetLine: -1,
			targetPosition: "after",
			editor,
			container,
		};
		const onMouseMove = (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			window.getSelection()?.removeAllRanges();
			this.onDragMoveCM(ev, container);
		};
		const preventSelect = (ev: Event) => ev.preventDefault();
		document.addEventListener("selectstart", preventSelect, true);
		window.getSelection()?.removeAllRanges();
		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove, true);
			document.removeEventListener("mouseup", onMouseUp, true);
			document.removeEventListener(
				"selectstart",
				preventSelect,
				true
			);
			line.classList.remove("ddl-dragging");
			document.body.classList.remove("ddl-drag-active");
			this.finishDrag();
		};
		document.addEventListener("mousemove", onMouseMove, true);
		document.addEventListener("mouseup", onMouseUp, true);
	}

	private onDragMoveCM(e: MouseEvent, container: HTMLElement) {
		if (!this.dragState || !this.dragState.editor) return;
		if (this.dragState.ghost) {
			this.dragState.ghost.style.left = `${e.clientX + 12}px`;
			this.dragState.ghost.style.top = `${e.clientY - 10}px`;
		}
		const cmLines = container.querySelectorAll(".cm-line");
		let closest: HTMLElement | null = null;
		let closestDist = Infinity;
		let position = "after" as "before" | "after";
		cmLines.forEach((cmLine) => {
			if (!(cmLine instanceof HTMLElement)) return;
			if (!this.isListItemLine(cmLine)) return;
			const rect = cmLine.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const dist = Math.abs(e.clientY - midY);
			if (dist < closestDist) {
				closestDist = dist;
				closest = cmLine;
				position = e.clientY < midY ? "before" : "after";
			}
		});
		if (closest && this.dragState.indicator) {
			const rect = (closest as HTMLElement).getBoundingClientRect();
			const scroller =
				container.querySelector(".cm-scroller") || container;
			const scrollerRect = scroller.getBoundingClientRect();
			const y =
				position === "before"
					? rect.top -
						scrollerRect.top +
						scroller.scrollTop
					: rect.bottom -
						scrollerRect.top +
						scroller.scrollTop;
			this.dragState.indicator.style.top = `${y}px`;
			this.dragState.indicator.style.display = "block";
			const targetLineNum = this.getEditorLineFromCMLine(
				closest as HTMLElement,
				this.dragState.editor
			);
			if (targetLineNum !== -1) {
				this.dragState.targetLine = targetLineNum;
				this.dragState.targetPosition = position;
			}
		}
	}

	private getEditorLineFromCMLine(
		cmLine: HTMLElement,
		editor: Editor
	): number {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cmEditor = (editor as any).cm;
		if (cmEditor) {
			try {
				const pos = cmEditor.posAtDOM(cmLine);
				if (pos !== undefined) {
					const line = cmEditor.state.doc.lineAt(pos);
					return line.number - 1;
				}
			} catch {
				// fall through to text matching
			}
		}
		const text = cmLine.textContent || "";
		for (let i = 0; i < editor.lineCount(); i++) {
			const editorLine = editor.getLine(i);
			if (
				editorLine.replace(/\s+/g, " ").trim() ===
				text.replace(/\s+/g, " ").trim()
			) {
				return i;
			}
		}
		return -1;
	}

	// ---- Shared Drag Logic ----

	private createGhost(
		text: string,
		x: number,
		y: number
	): HTMLElement {
		const ghost = document.createElement("div");
		ghost.className = "ddl-ghost";
		ghost.textContent = text.substring(0, 80);
		ghost.style.left = `${x + 12}px`;
		ghost.style.top = `${y - 10}px`;
		document.body.appendChild(ghost);
		return ghost;
	}

	private createIndicator(parent: HTMLElement): HTMLElement {
		const indicator = document.createElement("div");
		indicator.className = "ddl-drop-indicator";
		indicator.style.display = "none";
		parent.style.position = "relative";
		parent.appendChild(indicator);
		return indicator;
	}

	private finishDrag() {
		if (!this.dragState) return;
		const {
			sourceItems,
			targetLine,
			targetPosition,
			editor,
			ghost,
			indicator,
		} = this.dragState;
		if (ghost) ghost.remove();
		if (indicator) indicator.remove();
		if (targetLine === -1 || !editor) {
			this.dragState = null;
			return;
		}
		const sourceLines = sourceItems.map((item) => item.line);
		if (sourceLines.includes(targetLine)) {
			this.dragState = null;
			return;
		}
		this.moveListItems(
			editor,
			sourceItems,
			targetLine,
			targetPosition
		);
		this.dragState = null;
		setTimeout(() => this.attachToActiveView(), 100);
	}

	private moveListItems(
		editor: Editor,
		sourceItems: ListItem[],
		targetLine: number,
		position: "before" | "after"
	) {
		const sortedItems = [...sourceItems].sort(
			(a, b) => a.line - b.line
		);
		const sourceLineNumbers = sortedItems.map((item) => item.line);
		const sourceTexts = sortedItems.map((item) =>
			editor.getLine(item.line)
		);
		const targetText = editor.getLine(targetLine);
		const targetIndent =
			targetText.match(/^(\s*)/)?.[1] || "";
		const sourceBaseIndent =
			sourceTexts[0].match(/^(\s*)/)?.[1] || "";
		const adjustedTexts = sourceTexts.map((text) => {
			const currentIndent = text.match(/^(\s*)/)?.[1] || "";
			const relativeIndent = currentIndent.substring(
				sourceBaseIndent.length
			);
			return targetIndent + relativeIndent + text.trimStart();
		});

		let insertLine: number;
		if (position === "before") {
			insertLine = targetLine;
		} else {
			insertLine = this.findLastChildLine(targetLine, editor) + 1;
		}

		const sourceAboveCount = sourceLineNumbers.filter(
			(ln) => ln < insertLine
		).length;
		const reversedLines = [...sourceLineNumbers].reverse();
		for (const ln of reversedLines) {
			const from = { line: ln, ch: 0 };
			const to =
				ln + 1 < editor.lineCount()
					? { line: ln + 1, ch: 0 }
					: { line: ln, ch: editor.getLine(ln).length };
			editor.replaceRange("", from, to);
		}

		const adjustedInsertLine = insertLine - sourceAboveCount;
		const clampedInsert = Math.min(
			Math.max(0, adjustedInsertLine),
			editor.lineCount()
		);
		const insertText = adjustedTexts.join("\n") + "\n";

		if (clampedInsert >= editor.lineCount()) {
			const lastLine = editor.lineCount() - 1;
			const lastLineText = editor.getLine(lastLine);
			editor.replaceRange(
				"\n" + adjustedTexts.join("\n"),
				{ line: lastLine, ch: lastLineText.length },
				{ line: lastLine, ch: lastLineText.length }
			);
			this.renumberOrderedList(editor, lastLine + 1);
		} else {
			editor.replaceRange(insertText, {
				line: clampedInsert,
				ch: 0,
			});
		}
		this.renumberOrderedList(editor, clampedInsert);
	}

	private renumberOrderedList(editor: Editor, aroundLine: number) {
		const lineText = editor.getLine(aroundLine);
		if (!/^\s*\d+\.\s/.test(lineText)) return;
		const indentLen = (lineText.match(/^(\s*)/)?.[1] || "").length;

		let start = aroundLine;
		for (let i = aroundLine - 1; i >= 0; i--) {
			const t = editor.getLine(i);
			const tIndentLen = (t.match(/^(\s*)/)?.[1] || "").length;
			if (tIndentLen < indentLen) break;
			if (tIndentLen === indentLen) {
				if (/^\s*\d+\.\s/.test(t)) {
					start = i;
				} else {
					break;
				}
			}
		}

		let num = 1;
		for (let i = start; i < editor.lineCount(); i++) {
			const t = editor.getLine(i);
			if (t.trim() === "" && i > start) break;
			const tIndentLen = (t.match(/^(\s*)/)?.[1] || "").length;
			if (tIndentLen < indentLen && i > start) break;
			if (tIndentLen === indentLen) {
				if (/^\s*\d+\.\s/.test(t)) {
					const newText = t.replace(
						/^(\s*)\d+\./,
						`$1${num}.`
					);
					if (newText !== t) {
						editor.replaceRange(
							newText,
							{ line: i, ch: 0 },
							{ line: i, ch: t.length }
						);
					}
					num++;
				} else {
					break;
				}
			}
		}
	}

	private findLastChildLine(line: number, editor: Editor): number {
		const baseText = editor.getLine(line);
		const baseIndent = (
			baseText.match(/^(\s*)/)?.[1] || ""
		).length;
		let lastChild = line;
		for (let i = line + 1; i < editor.lineCount(); i++) {
			const lineText = editor.getLine(i);
			if (lineText.trim() === "") continue;
			const indent = (
				lineText.match(/^(\s*)/)?.[1] || ""
			).length;
			if (indent > baseIndent) {
				lastChild = i;
			} else {
				break;
			}
		}
		return lastChild;
	}

	// ---- List Parsing ----

	private parseListItems(editor: Editor): ListItem[] {
		const items: ListItem[] = [];
		for (let i = 0; i < editor.lineCount(); i++) {
			const text = editor.getLine(i);
			if (
				/^\s*[-*+]\s/.test(text) ||
				/^\s*\d+\.\s/.test(text) ||
				/^\s*[-*+]\s*\[.\]\s/.test(text)
			) {
				const indent = (
					text.match(/^(\s*)/)?.[1] || ""
				).length;
				items.push({ line: i, text, indent, children: [] });
			}
		}
		for (let i = 0; i < items.length; i++) {
			for (let j = i + 1; j < items.length; j++) {
				if (items[j].indent > items[i].indent) {
					items[i].children.push(items[j]);
				} else {
					break;
				}
			}
		}
		return items;
	}

	private getItemWithChildren(
		item: ListItem,
		allItems: ListItem[]
	): ListItem[] {
		const result = [item];
		const idx = allItems.indexOf(item);
		for (let i = idx + 1; i < allItems.length; i++) {
			if (allItems[i].indent > item.indent) {
				result.push(allItems[i]);
			} else {
				break;
			}
		}
		return result;
	}
}
