export interface ListItem {
	line: number;
	text: string;
	indent: number;
	children: ListItem[];
}

export function getIndent(text: string): number {
	return (text.match(/^(\s*)/)?.[1] || "").length;
}

export function isListLine(text: string): boolean {
	return (
		/^\s*[-*+]\s/.test(text) ||
		/^\s*\d+\.\s/.test(text) ||
		/^\s*[-*+]\s*\[.\]\s/.test(text)
	);
}

export function parseListItems(lines: string[]): ListItem[] {
	const items: ListItem[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (isListLine(lines[i])) {
			items.push({
				line: i,
				text: lines[i],
				indent: getIndent(lines[i]),
				children: [],
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

export function getItemWithChildren(
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

export function findLastChildLine(
	line: number,
	lines: string[]
): number {
	const baseIndent = getIndent(lines[line]);
	let lastChild = line;
	for (let i = line + 1; i < lines.length; i++) {
		if (lines[i].trim() === "") continue;
		if (getIndent(lines[i]) > baseIndent) {
			lastChild = i;
		} else {
			break;
		}
	}
	return lastChild;
}

export function renumberOrderedList(
	lines: string[],
	aroundLine: number
): string[] {
	const result = [...lines];
	if (aroundLine >= result.length) return result;
	if (!/^\s*\d+\.\s/.test(result[aroundLine])) return result;
	const indentLen = getIndent(result[aroundLine]);

	let start = aroundLine;
	for (let i = aroundLine - 1; i >= 0; i--) {
		const tIndentLen = getIndent(result[i]);
		if (tIndentLen < indentLen) break;
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
		if (result[i].trim() === "" && i > start) break;
		const tIndentLen = getIndent(result[i]);
		if (tIndentLen < indentLen && i > start) break;
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

export function moveListItems(
	lines: string[],
	sourceItems: ListItem[],
	targetLine: number,
	position: "before" | "after"
): string[] {
	const sortedItems = [...sourceItems].sort(
		(a, b) => a.line - b.line
	);
	const sourceLineNumbers = sortedItems.map((item) => item.line);
	const sourceTexts = sortedItems.map((item) => lines[item.line]);
	const targetText = lines[targetLine];
	const targetIndent = targetText.match(/^(\s*)/)?.[1] || "";
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
		insertLine = findLastChildLine(targetLine, lines) + 1;
	}

	const result = [...lines];

	// Remove source lines bottom-to-top to preserve indices
	const reversedLines = [...sourceLineNumbers].reverse();
	for (const ln of reversedLines) {
		result.splice(ln, 1);
	}

	// Adjusted insert position after removals
	const sourceAboveCount = sourceLineNumbers.filter(
		(ln) => ln < insertLine
	).length;
	const adjustedInsertLine = Math.min(
		Math.max(0, insertLine - sourceAboveCount),
		result.length
	);

	// Insert at new position
	result.splice(adjustedInsertLine, 0, ...adjustedTexts);

	// Renumber ordered lists
	return renumberOrderedList(result, adjustedInsertLine);
}
