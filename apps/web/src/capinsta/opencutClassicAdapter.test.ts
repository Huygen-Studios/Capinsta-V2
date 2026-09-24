import { describe, expect, test } from "bun:test"
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript"
import {
  capinstaTranscriptToOpenCutSubtitleImport,
  neutralCaptionDocumentToSubtitleCues,
} from "./opencutClassicAdapter"
import { capinstaTranscriptToCaptionDocument } from "./adapter"

describe("OpenCut Classic Capinsta adapter", () => {
  test("maps the sample transcript into OpenCut subtitle cues", () => {
    const result = capinstaTranscriptToOpenCutSubtitleImport(
      sampleCapinstaTranscriptV1,
    )

    expect(result.document.id).toBe("capinsta-doc-sample-video-001")
    expect(result.captions[0]).toEqual(
      expect.objectContaining({
		text: "Build the edit",
        startTime: 0.42,
      }),
    )
    expect(result.captions[1]).toEqual(
      expect.objectContaining({
		text: "then captions follow",
		startTime: 2.32,
      }),
    )
		expect(result.captions[0]?.duration).toBeCloseTo(1.77)
		expect(result.captions[1]?.duration).toBeCloseTo(2.35)
    expect(result.captions[0]?.style?.color).toBe("#FFFFFF")
    expect(result.source.sourceAssetName).toBe("sample-founder-intro.mp4")
  })

  test("keeps cue timing derived from neutral clips", () => {
    const document = capinstaTranscriptToCaptionDocument(
      sampleCapinstaTranscriptV1,
    )
    const cues = neutralCaptionDocumentToSubtitleCues({ document })

		expect(cues.map((cue) => cue.startTime)).toEqual([0.42, 2.32])
		expect(cues[0]?.duration).toBeCloseTo(1.77)
		expect(cues[1]?.duration).toBeCloseTo(2.35)
  })
})
