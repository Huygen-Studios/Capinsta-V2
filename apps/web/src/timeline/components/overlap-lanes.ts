import type { TimelineElement } from "@/timeline";

export interface TimelineElementLane {
	index: number;
	count: number;
}

type LaneElement = Pick<TimelineElement, "id" | "startTime" | "duration">;

export function resolveTimelineElementLanes(
	elements: readonly LaneElement[],
): Map<string, TimelineElementLane> {
	const sorted = [...elements].sort(
		(left, right) =>
			left.startTime - right.startTime || left.id.localeCompare(right.id),
	);
	const result = new Map<string, TimelineElementLane>();
	let group: LaneElement[] = [];
	let groupEnd = Number.NEGATIVE_INFINITY;

	const commitGroup = () => {
		const laneEnds: number[] = [];
		const assignments = new Map<string, number>();
		for (const element of group) {
			const start = element.startTime;
			const end = start + element.duration;
			const availableLane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
			const laneIndex = availableLane === -1 ? laneEnds.length : availableLane;
			laneEnds[laneIndex] = end;
			assignments.set(element.id, laneIndex);
		}
		const count = Math.max(1, laneEnds.length);
		for (const element of group) {
			result.set(element.id, {
				index: assignments.get(element.id) ?? 0,
				count,
			});
		}
	};

	for (const element of sorted) {
		if (group.length > 0 && element.startTime >= groupEnd) {
			commitGroup();
			group = [];
			groupEnd = Number.NEGATIVE_INFINITY;
		}
		group.push(element);
		groupEnd = Math.max(groupEnd, element.startTime + element.duration);
	}
	if (group.length > 0) commitGroup();

	return result;
}
