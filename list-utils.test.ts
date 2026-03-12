import {
	isListLine,
	parseListItems,
	getItemWithChildren,
	findLastChildLine,
	renumberOrderedList,
	moveListItems,
} from "./list-utils";

// ---- isListLine ----
// These matter because false positives/negatives break drag handle detection

describe("isListLine", () => {
	it("does not false-positive on horizontal rules or bare markers", () => {
		expect(isListLine("---")).toBe(false);
		expect(isListLine("1.no space")).toBe(false);
		expect(isListLine("")).toBe(false);
		expect(isListLine("some paragraph text")).toBe(false);
	});

	it("recognizes all Obsidian list syntaxes", () => {
		expect(isListLine("- item")).toBe(true);
		expect(isListLine("* item")).toBe(true);
		expect(isListLine("+ item")).toBe(true);
		expect(isListLine("1. item")).toBe(true);
		expect(isListLine("- [ ] task")).toBe(true);
		expect(isListLine("- [x] done")).toBe(true);
		expect(isListLine("  - nested")).toBe(true);
		expect(isListLine("    1. deeply indented")).toBe(true);
	});
});

// ---- parseListItems ----
// Verifies the parent-child hierarchy is correct — bugs here cause
// dragging a parent to lose or duplicate children

describe("parseListItems", () => {
	it("builds correct parent-child hierarchy for nested list", () => {
		const items = parseListItems([
			"- parent",       // 0
			"  - child1",     // 1
			"    - grandchild", // 2
			"  - child2",     // 3
			"- sibling",      // 4
		]);
		// parent has 3 descendants (child1, grandchild, child2)
		expect(items[0].children.map((c) => c.line)).toEqual([1, 2, 3]);
		// child1 has 1 descendant (grandchild)
		expect(items[1].children.map((c) => c.line)).toEqual([2]);
		// sibling has no children
		expect(items[4].children).toHaveLength(0);
	});

	it("preserves correct line numbers when non-list lines are interspersed", () => {
		const items = parseListItems([
			"# Heading",      // 0 - not a list
			"- first",        // 1
			"some paragraph", // 2 - not a list
			"- second",       // 3
		]);
		expect(items.map((i) => i.line)).toEqual([1, 3]);
	});

	it("handles mixed ordered and unordered in same document", () => {
		const items = parseListItems([
			"- bullet",
			"1. ordered",
			"- [x] task",
		]);
		expect(items).toHaveLength(3);
		expect(items.every((i) => i.indent === 0)).toBe(true);
	});
});

// ---- getItemWithChildren ----
// This determines what gets dragged — wrong result means dropped/lost lines

describe("getItemWithChildren", () => {
	it("includes all nested descendants when selecting a parent", () => {
		const items = parseListItems([
			"- parent",
			"  - child",
			"    - grandchild",
			"- unrelated",
		]);
		const result = getItemWithChildren(items[0], items);
		expect(result.map((r) => r.line)).toEqual([0, 1, 2]);
	});

	it("does not include siblings at the same level", () => {
		const items = parseListItems([
			"- a",
			"- b",
			"  - b-child",
			"- c",
		]);
		const result = getItemWithChildren(items[1], items);
		expect(result.map((r) => r.line)).toEqual([1, 2]);
		// "a" and "c" should not be included
	});

	it("selecting a leaf node returns only that item", () => {
		const items = parseListItems([
			"- parent",
			"  - leaf",
			"- other",
		]);
		const result = getItemWithChildren(items[1], items);
		expect(result).toHaveLength(1);
		expect(result[0].line).toBe(1);
	});
});

// ---- findLastChildLine ----
// Determines where "after" drops insert — wrong value causes items
// to land in the middle of a subtree

describe("findLastChildLine", () => {
	it("finds last child across multiple nesting levels", () => {
		const lines = [
			"- parent",
			"  - child",
			"    - grandchild1",
			"    - grandchild2",
			"- next",
		];
		expect(findLastChildLine(0, lines)).toBe(3);
	});

	it("skips blank lines between children", () => {
		const lines = [
			"- parent",
			"  - child1",
			"",
			"  - child2",
			"- next",
		];
		expect(findLastChildLine(0, lines)).toBe(3);
	});

	it("returns same line for items with no children", () => {
		expect(findLastChildLine(1, ["- a", "- b", "- c"])).toBe(1);
	});

	it("handles parent at end of document with children", () => {
		const lines = ["- other", "- parent", "  - child", "    - deep"];
		expect(findLastChildLine(1, lines)).toBe(3);
	});
});

// ---- renumberOrderedList ----
// This was the original bug: dragging to first position left no #1 item

describe("renumberOrderedList", () => {
	it("fixes the original bug: moved item to first gets number 1", () => {
		// Simulates what happens after moving "3. cherry" to the top
		const lines = ["3. cherry", "1. apple", "2. banana"];
		const result = renumberOrderedList(lines, 0);
		expect(result).toEqual(["1. cherry", "2. apple", "3. banana"]);
	});

	it("renumbers correctly when triggered from middle of list", () => {
		const lines = ["1. a", "5. b", "3. c"];
		// aroundLine=2 should still find the list start and renumber from 1
		const result = renumberOrderedList(lines, 2);
		expect(result).toEqual(["1. a", "2. b", "3. c"]);
	});

	it("does not touch nested ordered lists at different indent", () => {
		const lines = [
			"1. parent",
			"  1. child",
			"  3. child2",
			"5. parent2",
		];
		// Renumbering at indent 0 should only fix parent-level numbers
		const result = renumberOrderedList(lines, 0);
		expect(result[0]).toBe("1. parent");
		expect(result[1]).toBe("  1. child");   // untouched
		expect(result[2]).toBe("  3. child2");  // untouched
		expect(result[3]).toBe("2. parent2");   // fixed
	});

	it("preserves indentation in the renumbered text", () => {
		const lines = ["  3. a", "  5. b"];
		const result = renumberOrderedList(lines, 0);
		expect(result).toEqual(["  1. a", "  2. b"]);
	});

	it("is a no-op for bullet lists", () => {
		const lines = ["- a", "- b", "- c"];
		const result = renumberOrderedList(lines, 0);
		expect(result).toEqual(lines);
	});

	it("handles out-of-bounds aroundLine gracefully", () => {
		const lines = ["1. a"];
		expect(renumberOrderedList(lines, 5)).toEqual(["1. a"]);
	});
});

// ---- moveListItems ----
// The core algorithm — these test real drag-and-drop scenarios

describe("moveListItems", () => {
	// Helper to run a move scenario concisely
	function move(
		lines: string[],
		sourceIdx: number,
		targetIdx: number,
		position: "before" | "after"
	): string[] {
		const items = parseListItems(lines);
		const source = getItemWithChildren(items[sourceIdx], items);
		return moveListItems(lines, source, items[targetIdx].line, position);
	}

	describe("basic reordering", () => {
		const list = ["- a", "- b", "- c"];

		it("moves first item to last", () => {
			expect(move(list, 0, 2, "after")).toEqual([
				"- b",
				"- c",
				"- a",
			]);
		});

		it("moves last item to first", () => {
			expect(move(list, 2, 0, "before")).toEqual([
				"- c",
				"- a",
				"- b",
			]);
		});

		it("swaps adjacent items", () => {
			expect(move(list, 0, 1, "after")).toEqual([
				"- b",
				"- a",
				"- c",
			]);
		});

		it("inserts before a middle item", () => {
			expect(move(list, 2, 1, "before")).toEqual([
				"- a",
				"- c",
				"- b",
			]);
		});
	});

	describe("parent with children", () => {
		it("moves parent and all children together", () => {
			const lines = [
				"- parent",
				"  - child1",
				"  - child2",
				"- target",
			];
			expect(move(lines, 0, 3, "after")).toEqual([
				"- target",
				"- parent",
				"  - child1",
				"  - child2",
			]);
		});

		it("preserves relative indent of children after move", () => {
			const lines = [
				"- parent",
				"  - child",
				"    - grandchild",
				"- target",
			];
			const result = move(lines, 0, 3, "after");
			expect(result).toEqual([
				"- target",
				"- parent",
				"  - child",
				"    - grandchild",
			]);
		});

		it("drops after target with children inserts below subtree", () => {
			const lines = [
				"- source",
				"- target",
				"  - target-child",
				"  - target-child2",
				"- other",
			];
			const result = move(lines, 0, 1, "after");
			// "source" should appear after target's last child, not between target and its children
			expect(result).toEqual([
				"- target",
				"  - target-child",
				"  - target-child2",
				"- source",
				"- other",
			]);
		});
	});

	describe("indent adjustment", () => {
		it("adopts target indent when moved to different level", () => {
			const lines = ["  - nested", "- top1", "- top2"];
			const items = parseListItems(lines);
			const source = getItemWithChildren(items[0], items);
			const result = moveListItems(
				lines,
				source,
				items[2].line,
				"after"
			);
			expect(result).toEqual(["- top1", "- top2", "- nested"]);
		});
	});

	describe("ordered list renumbering", () => {
		it("renumbers after moving last to first (original reported bug)", () => {
			const lines = ["1. apple", "2. banana", "3. cherry"];
			expect(move(lines, 2, 0, "before")).toEqual([
				"1. cherry",
				"2. apple",
				"3. banana",
			]);
		});

		it("renumbers after moving first to last", () => {
			const lines = ["1. apple", "2. banana", "3. cherry"];
			expect(move(lines, 0, 2, "after")).toEqual([
				"1. banana",
				"2. cherry",
				"3. apple",
			]);
		});

		it("renumbers after moving middle item", () => {
			const lines = [
				"1. apple",
				"2. banana",
				"3. cherry",
				"4. date",
			];
			expect(move(lines, 1, 3, "after")).toEqual([
				"1. apple",
				"2. cherry",
				"3. date",
				"4. banana",
			]);
		});
	});

	describe("does not mutate input", () => {
		it("returns a new array, original is unchanged", () => {
			const lines = ["- a", "- b", "- c"];
			const original = [...lines];
			move(lines, 0, 2, "after");
			expect(lines).toEqual(original);
		});
	});
});
