var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DragDropListPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// list-utils.ts
function getIndent(text) {
  var _a;
  return (((_a = text.match(/^(\s*)/)) == null ? void 0 : _a[1]) || "").length;
}
function isListLine(text) {
  return /^\s*[-*+]\s/.test(text) || /^\s*\d+\.\s/.test(text) || /^\s*[-*+]\s*\[.\]\s/.test(text);
}
function parseListItems(lines) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    if (isListLine(lines[i])) {
      items.push({
        line: i,
        text: lines[i],
        indent: getIndent(lines[i]),
        children: []
      });
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
function getItemWithChildren(item, allItems) {
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
function findLastChildLine(line, lines) {
  const baseIndent = getIndent(lines[line]);
  let lastChild = line;
  for (let i = line + 1; i < lines.length; i++) {
    if (lines[i].trim() === "")
      continue;
    if (getIndent(lines[i]) > baseIndent) {
      lastChild = i;
    } else {
      break;
    }
  }
  return lastChild;
}
function renumberOrderedList(lines, aroundLine) {
  const result = [...lines];
  if (aroundLine >= result.length)
    return result;
  if (!/^\s*\d+\.\s/.test(result[aroundLine]))
    return result;
  const indentLen = getIndent(result[aroundLine]);
  let start = aroundLine;
  for (let i = aroundLine - 1; i >= 0; i--) {
    const tIndentLen = getIndent(result[i]);
    if (tIndentLen < indentLen)
      break;
    if (tIndentLen === indentLen) {
      if (/^\s*\d+\.\s/.test(result[i])) {
        start = i;
      } else {
        break;
      }
    }
  }
  let num = 1;
  for (let i = start; i < result.length; i++) {
    if (result[i].trim() === "" && i > start)
      break;
    const tIndentLen = getIndent(result[i]);
    if (tIndentLen < indentLen && i > start)
      break;
    if (tIndentLen === indentLen) {
      if (/^\s*\d+\.\s/.test(result[i])) {
        result[i] = result[i].replace(
          /^(\s*)\d+\./,
          `$1${num}.`
        );
        num++;
      } else {
        break;
      }
    }
  }
  return result;
}
function moveListItems(lines, sourceItems, targetLine, position) {
  var _a, _b;
  const sortedItems = [...sourceItems].sort(
    (a, b) => a.line - b.line
  );
  const sourceLineNumbers = sortedItems.map((item) => item.line);
  const sourceTexts = sortedItems.map((item) => lines[item.line]);
  const targetText = lines[targetLine];
  const targetIndent = ((_a = targetText.match(/^(\s*)/)) == null ? void 0 : _a[1]) || "";
  const sourceBaseIndent = ((_b = sourceTexts[0].match(/^(\s*)/)) == null ? void 0 : _b[1]) || "";
  const adjustedTexts = sourceTexts.map((text) => {
    var _a2;
    const currentIndent = ((_a2 = text.match(/^(\s*)/)) == null ? void 0 : _a2[1]) || "";
    const relativeIndent = currentIndent.substring(
      sourceBaseIndent.length
    );
    return targetIndent + relativeIndent + text.trimStart();
  });
  let insertLine;
  if (position === "before") {
    insertLine = targetLine;
  } else {
    insertLine = findLastChildLine(targetLine, lines) + 1;
  }
  const result = [...lines];
  const reversedLines = [...sourceLineNumbers].reverse();
  for (const ln of reversedLines) {
    result.splice(ln, 1);
  }
  const sourceAboveCount = sourceLineNumbers.filter(
    (ln) => ln < insertLine
  ).length;
  const adjustedInsertLine = Math.min(
    Math.max(0, insertLine - sourceAboveCount),
    result.length
  );
  result.splice(adjustedInsertLine, 0, ...adjustedTexts);
  return renumberOrderedList(result, adjustedInsertLine);
}

// main.ts
function getCoords(e) {
  if ("touches" in e) {
    const touch = e.touches[0] || e.changedTouches[0];
    return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
  }
  return { clientX: e.clientX, clientY: e.clientY };
}
var SCROLL_EDGE = 60;
var SCROLL_SPEED = 8;
var DragDropListPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.dragState = null;
    this.debounceTimer = null;
    this.scrollInterval = null;
    this.lastDragY = 0;
    this.isUpdatingDOM = false;
    this.mutationObserver = null;
    this.globalMouseDownHandler = null;
    this.globalTouchStartHandler = null;
  }
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
    this.globalMouseDownHandler = (e) => {
      this.onGlobalPointerDown(e);
    };
    this.globalTouchStartHandler = (e) => {
      this.onGlobalPointerDown(e);
    };
    document.addEventListener("mousedown", this.globalMouseDownHandler, true);
    document.addEventListener("touchstart", this.globalTouchStartHandler, { capture: true, passive: false });
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && (node.matches(
            ".block-language-tasks, .tasks-plugin-main-list, .plugin-tasks-list-item, .task-list-item"
          ) || node.querySelector(
            ".block-language-tasks, .tasks-plugin-main-list, .plugin-tasks-list-item, .task-list-item"
          ))) {
            this.scheduleAttach();
            return;
          }
        }
      }
    });
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
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
  getEditorLines(editor) {
    const lines = [];
    for (let i = 0; i < editor.lineCount(); i++) {
      lines.push(editor.getLine(i));
    }
    return lines;
  }
  startAutoScroll(scrollEl) {
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
  stopAutoScroll() {
    if (this.scrollInterval !== null) {
      window.clearInterval(this.scrollInterval);
      this.scrollInterval = null;
    }
  }
  setEditorLines(editor, lines) {
    const lastLine = editor.lineCount() - 1;
    editor.replaceRange(
      lines.join("\n"),
      { line: 0, ch: 0 },
      { line: lastLine, ch: editor.getLine(lastLine).length }
    );
  }
  // ---- Scheduling & Attachment ----
  scheduleAttach() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.attachToActiveView();
    }, 150);
  }
  attachToActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!view)
      return;
    if (view.getMode() === "preview")
      return;
    this.addHandlesToReadingView(view.contentEl);
  }
  // ---- Reading View Handles ----
  addHandlesToReadingView(container) {
    if (this.isUpdatingDOM)
      return;
    this.isUpdatingDOM = true;
    container.querySelectorAll(
      ".markdown-reading-view li, .markdown-reading-view .task-list-item, .markdown-reading-view [data-task], .tasks-plugin-main-list li, .plugin-tasks-list-item"
    ).forEach((li) => {
      if (li instanceof HTMLElement && !li.querySelector(":scope > .ddl-drag-handle")) {
        this.addDragHandle(li, container);
      }
    });
    this.isUpdatingDOM = false;
  }
  addDragHandle(li, container) {
    li.classList.add("ddl-list-item-wrapper");
    const handle = document.createElement("div");
    handle.className = "ddl-drag-handle";
    handle.appendChild(this.createHandleSVG());
    const startDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.startDrag(e, li, container, "reading");
    };
    handle.addEventListener("mousedown", startDrag);
    handle.addEventListener("touchstart", startDrag, { passive: false });
    if (import_obsidian.Platform.isMobile) {
      handle.classList.add("ddl-mobile-handle");
    }
    li.insertBefore(handle, li.firstChild);
  }
  createHandleSVG() {
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
  removeAllHandles() {
    document.querySelectorAll(".ddl-drag-handle").forEach((h) => h.remove());
    document.querySelectorAll(".ddl-list-item-wrapper").forEach(
      (el) => el.classList.remove("ddl-list-item-wrapper")
    );
    document.querySelectorAll(".ddl-cm-list-line").forEach((el) => el.classList.remove("ddl-cm-list-line"));
  }
  // ---- CM Drag Handle Detection (event delegation) ----
  onGlobalPointerDown(e) {
    const coords = getCoords(e);
    if (!coords)
      return;
    const target = e.target;
    if (!(target instanceof HTMLElement))
      return;
    const cmLine = target.closest(".cm-line");
    if (!cmLine || !(cmLine instanceof HTMLElement))
      return;
    if (!this.isListItemLine(cmLine))
      return;
    const lineRect = cmLine.getBoundingClientRect();
    if (coords.clientX > lineRect.left + 30)
      return;
    const container = cmLine.closest(".markdown-source-view");
    if (!container || !(container instanceof HTMLElement))
      return;
    e.preventDefault();
    e.stopPropagation();
    this.startDrag(e, cmLine, container, "cm");
  }
  isListItemLine(el) {
    return el.classList.contains("HyperMD-list-line") || el.querySelector(".cm-formatting-list") !== null || el.querySelector("[class*='cm-list-']") !== null || el.querySelector("input[type='checkbox']") !== null || el.querySelector(".task-list-item-checkbox") !== null || isListLine(el.textContent || "");
  }
  // ---- Unified Drag Logic ----
  startDrag(e, element, container, mode) {
    var _a, _b;
    const coords = getCoords(e);
    if (!coords)
      return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!view)
      return;
    const editor = view.editor;
    const lines = this.getEditorLines(editor);
    const lineIndex = mode === "reading" ? this.findLineForReadingLi(element, editor) : this.getEditorLineFromCMLine(element, editor);
    if (lineIndex === -1)
      return;
    const items = parseListItems(lines);
    const sourceItem = items.find(
      (item) => item.line === lineIndex
    );
    if (!sourceItem)
      return;
    const sourceItems = getItemWithChildren(sourceItem, items);
    element.classList.add("ddl-dragging");
    document.body.classList.add("ddl-drag-active");
    const ghostText = mode === "reading" ? this.getDirectTextContent(element).trim() : ((_a = element.textContent) == null ? void 0 : _a.trim()) || "";
    const ghost = this.createGhost(
      ghostText,
      coords.clientX,
      coords.clientY
    );
    const indicatorParent = mode === "cm" ? container.querySelector(".cm-scroller") instanceof HTMLElement ? container.querySelector(".cm-scroller") : container : container;
    const indicator = this.createIndicator(
      indicatorParent
    );
    this.dragState = {
      sourceLine: lineIndex,
      sourceItems,
      ghost,
      indicator,
      targetLine: -1,
      targetPosition: "after",
      editor,
      container
    };
    const scrollContainer = mode === "cm" ? container.querySelector(".cm-scroller") || container : container;
    this.startAutoScroll(scrollContainer);
    const onPointerMove = (ev) => {
      var _a2;
      ev.preventDefault();
      ev.stopPropagation();
      (_a2 = window.getSelection()) == null ? void 0 : _a2.removeAllRanges();
      const moveCoords = getCoords(ev);
      if (!moveCoords)
        return;
      this.lastDragY = moveCoords.clientY;
      if (mode === "reading") {
        this.onDragMoveReading(moveCoords, container);
      } else {
        this.onDragMoveCM(moveCoords, container);
      }
    };
    const preventSelect = (ev) => ev.preventDefault();
    document.addEventListener("selectstart", preventSelect, true);
    (_b = window.getSelection()) == null ? void 0 : _b.removeAllRanges();
    const cleanup = () => {
      this.stopAutoScroll();
      document.removeEventListener("mousemove", onPointerMove, true);
      document.removeEventListener("mouseup", onPointerUp, true);
      document.removeEventListener("touchmove", onPointerMove, true);
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
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("mouseup", onPointerUp, true);
    document.addEventListener("touchmove", onPointerMove, { capture: true, passive: false });
    document.addEventListener("touchend", onPointerUp, true);
    document.addEventListener("touchcancel", onPointerUp, true);
  }
  // ---- Drag Move Handlers ----
  onDragMoveReading(coords, container) {
    if (!this.dragState)
      return;
    this.updateGhostPosition(coords);
    const allLis = container.querySelectorAll(
      ".markdown-reading-view li, .tasks-plugin-main-list li, .plugin-tasks-list-item"
    );
    const { closest, position } = this.findClosestElement(
      coords.clientY,
      allLis
    );
    if (!closest || !this.dragState.indicator)
      return;
    const rect = closest.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const scrollTop = container.scrollTop || 0;
    const y = position === "before" ? rect.top - containerRect.top + scrollTop : rect.bottom - containerRect.top + scrollTop;
    this.dragState.indicator.setCssProps({
      "--ddl-indicator-top": `${y}px`
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
  onDragMoveCM(coords, container) {
    var _a;
    if (!((_a = this.dragState) == null ? void 0 : _a.editor))
      return;
    this.updateGhostPosition(coords);
    const cmLines = container.querySelectorAll(".cm-line");
    const filtered = [];
    cmLines.forEach((el) => {
      if (el instanceof HTMLElement && this.isListItemLine(el)) {
        filtered.push(el);
      }
    });
    const { closest, position } = this.findClosestElement(
      coords.clientY,
      filtered
    );
    if (!closest || !this.dragState.indicator)
      return;
    const rect = closest.getBoundingClientRect();
    const scroller = container.querySelector(".cm-scroller") || container;
    const scrollerRect = scroller.getBoundingClientRect();
    const y = position === "before" ? rect.top - scrollerRect.top + scroller.scrollTop : rect.bottom - scrollerRect.top + scroller.scrollTop;
    this.dragState.indicator.setCssProps({
      "--ddl-indicator-top": `${y}px`
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
  updateGhostPosition(coords) {
    var _a;
    if ((_a = this.dragState) == null ? void 0 : _a.ghost) {
      this.dragState.ghost.setCssProps({
        "--ddl-ghost-left": `${coords.clientX + 12}px`,
        "--ddl-ghost-top": `${coords.clientY - 10}px`
      });
    }
  }
  findClosestElement(clientY, elements) {
    let closest = null;
    let closestDist = Infinity;
    let position = "after";
    elements.forEach((el) => {
      if (!(el instanceof HTMLElement))
        return;
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
  findLineForReadingLi(li, editor) {
    const text = this.getDirectTextContent(li).trim();
    if (!text)
      return -1;
    for (let i = 0; i < editor.lineCount(); i++) {
      const lineText = editor.getLine(i);
      const stripped = lineText.replace(
        /^\s*[-*+]\s+(\[.\]\s+)?|^\s*\d+\.\s+/,
        ""
      ).trim();
      if (stripped === text)
        return i;
    }
    return -1;
  }
  getDirectTextContent(el) {
    let text = "";
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node instanceof HTMLElement && !node.classList.contains("ddl-drag-handle") && node.tagName !== "UL" && node.tagName !== "OL") {
        text += node.textContent;
      }
    });
    return text;
  }
  getEditorLineFromCMLine(cmLine, editor) {
    const cmEditor = editor.cm;
    if (cmEditor) {
      try {
        const pos = cmEditor.posAtDOM(cmLine);
        if (pos !== void 0) {
          const line = cmEditor.state.doc.lineAt(pos);
          return line.number - 1;
        }
      } catch (e) {
      }
    }
    const text = cmLine.textContent || "";
    for (let i = 0; i < editor.lineCount(); i++) {
      const editorLine = editor.getLine(i);
      if (editorLine.replace(/\s+/g, " ").trim() === text.replace(/\s+/g, " ").trim()) {
        return i;
      }
    }
    return -1;
  }
  // ---- Ghost & Indicator ----
  createGhost(text, x, y) {
    const ghost = document.createElement("div");
    ghost.className = "ddl-ghost";
    ghost.textContent = text.substring(0, 80);
    ghost.setCssProps({
      "--ddl-ghost-left": `${x + 12}px`,
      "--ddl-ghost-top": `${y - 10}px`
    });
    document.body.appendChild(ghost);
    return ghost;
  }
  createIndicator(parent) {
    const indicator = document.createElement("div");
    indicator.className = "ddl-drop-indicator";
    parent.classList.add("ddl-indicator-parent");
    parent.appendChild(indicator);
    return indicator;
  }
  // ---- Finish Drag ----
  finishDrag() {
    if (!this.dragState)
      return;
    const {
      sourceItems,
      targetLine,
      targetPosition,
      editor,
      ghost,
      indicator
    } = this.dragState;
    if (ghost)
      ghost.remove();
    if (indicator)
      indicator.remove();
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
};
