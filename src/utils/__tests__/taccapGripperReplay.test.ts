import { describe, expect, test } from "bun:test";
import {
  extractTacCapGripperTracks,
  normalizeTacCapGripperOpening,
  sampleTacCapGripperFrame,
  tacCapGripperSources,
} from "@/utils/taccapGripperReplay";

function poseRow(
  timestamp: number,
  source: "action" | "observation.state",
  side: "left" | "right",
  x: number,
  gripper: number,
): Record<string, number> {
  const prefix = `${source} | ${side}_tcp`;
  return {
    timestamp,
    [`${prefix}.x`]: x,
    [`${prefix}.y`]: 0,
    [`${prefix}.z`]: 0,
    [`${prefix}.r1`]: 1,
    [`${prefix}.r2`]: 0,
    [`${prefix}.r3`]: 0,
    [`${prefix}.r4`]: 0,
    [`${prefix}.r5`]: 1,
    [`${prefix}.r6`]: 0,
    [`${source} | ${side}_gripper.pos`]: gripper,
  };
}

describe("TacCap gripper replay", () => {
  test("selects one action track per side ahead of observation.state", () => {
    const rows = [0, 1].map((timestamp) => ({
      ...poseRow(timestamp, "observation.state", "left", timestamp + 10, 0.1),
      ...poseRow(timestamp, "action", "left", timestamp, 0.2),
      ...poseRow(timestamp, "action", "right", timestamp + 2, 0.3),
    }));

    const tracks = extractTacCapGripperTracks(rows);
    expect(tracks.map(({ side, source }) => ({ side, source }))).toEqual([
      { side: "left", source: "action" },
      { side: "right", source: "action" },
    ]);
    expect(tracks[0].gripperKey).toBe("action | left_gripper.pos");
    expect(tacCapGripperSources(rows)).toEqual(["action", "observation.state"]);

    const stateTracks = extractTacCapGripperTracks(rows, "observation.state");
    expect(stateTracks[0].source).toBe("observation.state");
  });

  test("samples link4 pose, rotation, and gripper opening at playback time", () => {
    const rows = [
      poseRow(0, "action", "left", 0, 0.2),
      poseRow(1, "action", "left", 1, 0.8),
    ];
    const [track] = extractTacCapGripperTracks(rows);

    expect(sampleTacCapGripperFrame(track, 0.5)).toEqual({
      side: "left",
      source: "action",
      position: [0.5, 0, 0],
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      opening: 0.5,
    });
  });

  test("keeps native unit values and scales non-unit encoder ranges", () => {
    expect(normalizeTacCapGripperOpening(0.25, { min: 0.2, max: 0.3 })).toBe(
      0.25,
    );
    expect(normalizeTacCapGripperOpening(50, { min: 0, max: 100 })).toBe(0.5);
    expect(normalizeTacCapGripperOpening(150, { min: 0, max: 100 })).toBe(1);
  });
});
