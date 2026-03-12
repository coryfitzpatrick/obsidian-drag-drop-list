import { Plugin, MarkdownView, Editor, Platform } from "obsidian";
import {
	ListItem,
	parseListItems,
	getItemWithChildren,
	moveListItems,
	isListLine,
} from "./list-utils";

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

interface CMEditorView {
	posAtDOM(node: Node): number;
	state: { doc: { lineAt(pos: number): { number: number } } };
}

function getCoords(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } | null {
	if ("touches" in e) {
		const touch = e.touches[0] || e.changedTouches[0];
		return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
	}
	return { clientX: e.clientX, clientY: e.clientY };
}

const SCROLL_EDGE = 60;
const SCROLL_SPEED = 8;

export default class DragDropListPlugin extends Plugin {
	private dragState: DragState | null = null;
	private debounceTimer: number | null = null;
	private scrollInterval: number | null = null;
	private lastDragY = 0;
	private isUpdatingDOM = false;
	private mutationObserver: MutationObserver | null = null;
	private globalMouseDownHandler: ((e: MouseEvent) => void) | null = null;
	private globalTouchStartHandler: ((e: TouchEvent) => void) | null = null;

	onload() {
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
			this.onGlobalPointerDown(e);
		};
		this.globalTouchStartHandler = (e: TouchEvent) => {
			this.onGlobalPointerDown(e);
		};
		document.addEventListener("mousedown", this.globalMouseDownHandler, true);
		document.addEventListener("touchstart", this.globalTouchStartHandler, { capture: true, passive: false });

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
			document.removeEventListener("mousedown", this.globalMouseDownHandler, true);
			this.globalMouseDownHandler = null;
		}
		if (this.globalTouchStartHandler) {
			document.removeEventListener("touchstart", this.globalTouchStartHandler, { capture: true });
			this.globalTouchStartHandler = null;
		}
	}

	// ---- Editor Helpers ----

	private getEditorLines(editor: Editor): string[] {
		const lines: string[] = [];
		for (let i = 0; i < editor.lineCount(); i++) {
			lines.push(editor.getLine(i));
		}
		return lines;
	}

	private startAutoScroll(scrollEl: HTMLElement) {
		this.stopAutoScroll();
		this.scrollInterval = window.setInterval(() => {
			const rect = scrollEl.getBoundingClientRect();
			const y = this.lastDragY;
			if (y < rect.top + SCROLL_EDGE) {
				scrollEl.scrollTop -= SCROLL_SPEED;
			} else if (y > rect.bottom - SCROLL_EDGE) {
				scrollEl.scrollTop += SCROLL_SPEED;
			}
		}, 16);
	}

	private stopAutoScroll() {
		if (this.scrollInterval !== null) {
			window.clearInterval(this.scrollInterval);
			this.scrollInterval = null;
		}
	}

	private setEditorLines(editor: Editor, lines: string[]) {
		const lastLine = editor.lineCount() - 1;
		editor.replaceRange(
			lines.join("\n"),
			{ line: 0, ch: 0 },
			{ line: lastLine, ch: editor.getLine(lastLine).length }
		);
	}

	// ---- Scheduling & Attachment ----

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
		// Don't add drag handles in Reading mode — only Live Preview / Source
		if (view.getMode() === "preview") return;
		this.addHandlesToReadingView(view.contentEl);
	}

	// ---- Reading View Handles ----

	private addHandlesToReadingView(container: HTMLElement) {
		if (this.isUpdatingDOM) return;
		this.isUpdatingDOM = true;
		container
			.querySelectorAll(
				".markdown-reading-view li, .markdown-reading-view .task-list-item, .markdown-reading-view [data-task], .tasks-plugin-main-list li, .plugin-tasks-list-item"
			)
			.forEach((li) => {
				if (
					li instanceof HTMLElement &&
					!li.querySelector(":scope > .ddl-drag-handle")
				) {
					this.addDragHandle(li, container);
				}
			});
		this.isUpdatingDOM = false;
	}

	private addDragHandle(li: HTMLElement, container: HTMLElement) {
		li.classList.add("ddl-list-item-wrapper");
		const handle = document.createElement("div");
		handle.className = "ddl-drag-handle";
		handle.appendChild(this.createHandleSVG());
		const startDrag = (e: MouseEvent | TouchEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.startDrag(e, li, container, "reading");
		};
		handle.addEventListener("mousedown", startDrag);
		handle.addEventListener("touchstart", startDrag, { passive: false });
		if (Platform.isMobile) {
			handle.classList.add("ddl-mobile-handle");
		}
		li.insertBefore(handle, li.firstChild);
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

	private removeAllHandles() {
		document
			.querySelectorAll(".ddl-drag-handle")
			.forEach((h) => h.remove());
		document
			.querySelectorAll(".ddl-list-item-wrapper")
			.forEach((el) =>
				el.classList.remove("ddl-list-item-wrapper")
			);
		document
			.querySelectorAll(".ddl-cm-list-line")
			.forEach((el) => el.classList.remove("ddl-cm-list-line"));
	}

	// ---- CM Drag Handle Detection (event delegation) ----

	private onGlobalPointerDown(e: MouseEvent | TouchEvent) {
		const coords = getCoords(e);
		if (!coords) return;
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;
		const cmLine = target.closest(".cm-line");
		if (!cmLine || !(cmLine instanceof HTMLElement)) return;
		if (!this.isListItemLine(cmLine)) return;
		const lineRect = cmLine.getBoundingClientRect();
		if (coords.clientX > lineRect.left + 30) return;
		const container = cmLine.closest(".markdown-source-view");
		if (!container || !(container instanceof HTMLElement)) return;
		e.preventDefault();
		e.stopPropagation();
		this.startDrag(e, cmLine, container, "cm");
	}

	private isListItemLine(el: HTMLElement): boolean {
		return (
			el.classList.contains("HyperMD-list-line") ||
			el.querySelector(".cm-formatting-list") !== null ||
			el.querySelector("[class*='cm-list-']") !== null ||
			el.querySelector("input[type='checkbox']") !== null ||
			el.querySelector(".task-list-item-checkbox") !== null ||
			isListLine(el.textContent || "")
		);
	}

	// ---- Unified Drag Logic ----

	private startDrag(
		e: MouseEvent | TouchEvent,
		element: HTMLElement,
		container: HTMLElement,
		mode: "reading" | "cm"
	) {
		const coords = getCoords(e);
		if (!coords) return;
		const view =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;
		const lines = this.getEditorLines(editor);

		const lineIndex =
			mode === "reading"
				? this.findLineForReadingLi(element, editor)
				: this.getEditorLineFromCMLine(element, editor);
		if (lineIndex === -1) return;

		const items = parseListItems(lines);
		const sourceItem = items.find(
			(item) => item.line === lineIndex
		);
		if (!sourceItem) return;
		const sourceItems = getItemWithChildren(sourceItem, items);

		element.classList.add("ddl-dragging");
		document.body.classList.add("ddl-drag-active");

		const ghostText =
			mode === "reading"
				? this.getDirectTextContent(element).trim()
				: element.textContent?.trim() || "";
		const ghost = this.createGhost(
			ghostText,
			coords.clientX,
			coords.clientY
		);

		const indicatorParent =
			mode === "cm"
				? (container.querySelector(".cm-scroller") instanceof
				  HTMLElement
						? container.querySelector(".cm-scroller")
						: container)!
				: container;
		const indicator = this.createIndicator(
			indicatorParent as HTMLElement
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

		const scrollContainer =
			mode === "cm"
				? (container.querySelector(".cm-scroller") || container)
				: container;

		this.startAutoScroll(scrollContainer as HTMLElement);

		const onPointerMove = (ev: MouseEvent | TouchEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			window.getSelection()?.removeAllRanges();
			const moveCoords = getCoords(ev);
			if (!moveCoords) return;
			this.lastDragY = moveCoords.clientY;
			if (mode === "reading") {
				this.onDragMoveReading(moveCoords, container);
			} else {
				this.onDragMoveCM(moveCoords, container);
			}
		};
		const preventSelect = (ev: Event) => ev.preventDefault();
		document.addEventListener("selectstart", preventSelect, true);
		window.getSelection()?.removeAllRanges();

		const cleanup = () => {
			this.stopAutoScroll();
			document.removeEventListener("mousemove", onPointerMove as EventListener, true);
			document.removeEventListener("mouseup", onPointerUp, true);
			document.removeEventListener("touchmove", onPointerMove as EventListener, true);
			document.removeEventListener("touchend", onPointerUp, true);
			document.removeEventListener("touchcancel", onPointerUp, true);
			document.removeEventListener("selectstart", preventSelect, true);
			element.classList.remove("ddl-dragging");
			document.body.classList.remove("ddl-drag-active");
		};

		const onPointerUp = () => {
			cleanup();
			this.finishDrag();
		};

		document.addEventListener("mousemove", onPointerMove as EventListener, true);
		document.addEventListener("mouseup", onPointerUp, true);
		document.addEventListener("touchmove", onPointerMove as EventListener, { capture: true, passive: false });
		document.addEventListener("touchend", onPointerUp, true);
		document.addEventListener("touchcancel", onPointerUp, true);
	}

	// ---- Drag Move Handlers ----

	private onDragMoveReading(
		coords: { clientX: number; clientY: number },
		container: HTMLElement
	) {
		if (!this.dragState) return;
		this.updateGhostPosition(coords);

		const allLis = container.querySelectorAll(
			".markdown-reading-view li, .tasks-plugin-main-list li, .plugin-tasks-list-item"
		);
		const { closest, position } = this.findClosestElement(
			coords.clientY,
			allLis
		);
		if (!closest || !this.dragState.indicator) return;

		const rect = closest.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const scrollTop = container.scrollTop || 0;
		const y =
			position === "before"
				? rect.top - containerRect.top + scrollTop
				: rect.bottom - containerRect.top + scrollTop;

		this.dragState.indicator.setCssProps({
			"--ddl-indicator-top": `${y}px`,
		});
		this.dragState.indicator.classList.add("ddl-visible");

		const targetLine = this.findLineForReadingLi(
			closest,
			this.dragState.editor
		);
		if (targetLine !== -1) {
			this.dragState.targetLine = targetLine;
			this.dragState.targetPosition = position;
		}
	}

	private onDragMoveCM(
		coords: { clientX: number; clientY: number },
		container: HTMLElement
	) {
		if (!this.dragState?.editor) return;
		this.updateGhostPosition(coords);

		const cmLines = container.querySelectorAll(".cm-line");
		const filtered: HTMLElement[] = [];
		cmLines.forEach((el) => {
			if (
				el instanceof HTMLElement &&
				this.isListItemLine(el)
			) {
				filtered.push(el);
			}
		});
		const { closest, position } = this.findClosestElement(
			coords.clientY,
			filtered
		);
		if (!closest || !this.dragState.indicator) return;

		const rect = closest.getBoundingClientRect();
		const scroller =
			container.querySelector(".cm-scroller") || container;
		const scrollerRect = scroller.getBoundingClientRect();
		const y =
			position === "before"
				? rect.top - scrollerRect.top + scroller.scrollTop
				: rect.bottom - scrollerRect.top + scroller.scrollTop;

		this.dragState.indicator.setCssProps({
			"--ddl-indicator-top": `${y}px`,
		});
		this.dragState.indicator.classList.add("ddl-visible");

		const targetLineNum = this.getEditorLineFromCMLine(
			closest,
			this.dragState.editor
		);
		if (targetLineNum !== -1) {
			this.dragState.targetLine = targetLineNum;
			this.dragState.targetPosition = position;
		}
	}

	private updateGhostPosition(coords: { clientX: number; clientY: number }) {
		if (this.dragState?.ghost) {
			this.dragState.ghost.setCssProps({
				"--ddl-ghost-left": `${coords.clientX + 12}px`,
				"--ddl-ghost-top": `${coords.clientY - 10}px`,
			});
		}
	}

	private findClosestElement(
		clientY: number,
		elements: NodeListOf<Element> | HTMLElement[]
	): { closest: HTMLElement | null; position: "before" | "after" } {
		let closest: HTMLElement | null = null;
		let closestDist = Infinity;
		let position = "after" as "before" | "after";
		elements.forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			const rect = el.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const dist = Math.abs(clientY - midY);
			if (dist < closestDist) {
				closestDist = dist;
				closest = el;
				position = clientY < midY ? "before" : "after";
			}
		});
		return { closest, position };
	}

	// ---- Line Resolution ----

	private findLineForReadingLi(
		li: HTMLElement,
		editor: Editor
	): number {
		const text = this.getDirectTextContent(li).trim();
		if (!text) return -1;
		for (let i = 0; i < editor.lineCount(); i++) {
			const lineText = editor.getLine(i);
			const stripped = lineText
				.replace(
					/^\s*[-*+]\s+(\[.\]\s+)?|^\s*\d+\.\s+/,
					""
				)
				.trim();
			if (stripped === text) return i;
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

	private getEditorLineFromCMLine(
		cmLine: HTMLElement,
		editor: Editor
	): number {
		const cmEditor = (editor as Editor & { cm?: CMEditorView }).cm;
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

	// ---- Ghost & Indicator ----

	private createGhost(
		text: string,
		x: number,
		y: number
	): HTMLElement {
		const ghost = document.createElement("div");
		ghost.className = "ddl-ghost";
		ghost.textContent = text.substring(0, 80);
		ghost.setCssProps({
			"--ddl-ghost-left": `${x + 12}px`,
			"--ddl-ghost-top": `${y - 10}px`,
		});
		document.body.appendChild(ghost);
		return ghost;
	}

	private createIndicator(parent: HTMLElement): HTMLElement {
		const indicator = document.createElement("div");
		indicator.className = "ddl-drop-indicator";
		parent.classList.add("ddl-indicator-parent");
		parent.appendChild(indicator);
		return indicator;
	}

	// ---- Finish Drag ----

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

		const lines = this.getEditorLines(editor);
		const newLines = moveListItems(
			lines,
			sourceItems,
			targetLine,
			targetPosition
		);
		this.setEditorLines(editor, newLines);

		this.dragState = null;
		setTimeout(() => this.attachToActiveView(), 100);
	}
}
