import { describe, expect, test } from "bun:test";
import { resolveTimelineElementLanes } from "./overlap-lanes";

const element = (id: string, startTime: number, duration: number) => ({
	id,
	startTime,
	duration,
});

describe("timeline overlap lanes", () => {
	test("keeps touching clips full-height and separates overlapping clips", () => {
		const lanes = resolveTimelineElementLanes([
			element("first", 0, 10),
			element("overlap", 5, 10),
			element("chained", 12, 5),
			element("touching", 17, 3),
		]);

		expect(lanes.get("first")).toEqual({ index: 0, count: 2 });
		expect(lanes.get("overlap")).toEqual({ index: 1, count: 2 });
		expect(lanes.get("chained")).toEqual({ index: 0, count: 2 });
		expect(lanes.get("touching")).toEqual({ index: 0, count: 1 });
	});

	test("gives nested overlaps enough visible lanes", () => {
		const lanes = resolveTimelineElementLanes([
			element("outer", 0, 20),
			element("middle", 2, 10),
			element("inner", 4, 2),
		]);

		expect(lanes.get("outer")).toEqual({ index: 0, count: 3 });
		expect(lanes.get("middle")).toEqual({ index: 1, count: 3 });
		expect(lanes.get("inner")).toEqual({ index: 2, count: 3 });
	});
});
