export type TimingQuality = "native" | "repaired" | "shared";

export interface GeminiTimedWord {
	id: string;
	text: string;
	startUs: number;
	endUs: number;
	rawStartUs?: number;
	rawEndUs?: number;
	timingQuality: TimingQuality;
	alignmentGroupId?: string;
	speaker?: string;
}

export type GeminiCaptionStage =
	| "extracting"
	| "uploading"
	| "waiting"
	| "transcribing"
	| "validating"
	| "converting"
	| "building";

export interface GeminiCaptionProgress {
	stage: GeminiCaptionStage;
	message: string;
	chunkIndex?: number;
	chunkCount?: number;
}

export interface AudioChunk {
	startUs: number;
	endUs: number;
}
