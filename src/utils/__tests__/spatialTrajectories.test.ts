import { describe, expect, test } from "bun:test";
import {
  extractSpatialTrajectory,
  findSpatialAxisGroups,
  spatialPointsPerEpisode,
} from "@/utils/spatialTrajectories";

describe("findSpatialAxisGroups", () => {
  test("finds complete left and right TCP xyz groups", () => {
    const groups = findSpatialAxisGroups("action", [
      "left_tcp.x",
      "left_tcp.y",
      "left_tcp.z",
      "left_tcp.r1",
      "right_tcp.x",
      "right_tcp.y",
      "right_tcp.z",
    ]);

    expect(groups).toEqual([
      {
        id: "action:left_tcp",
        label: "left_tcp",
        indices: [0, 1, 2],
        axisNames: ["left_tcp.x", "left_tcp.y", "left_tcp.z"],
      },
      {
        id: "action:right_tcp",
        label: "right_tcp",
        indices: [4, 5, 6],
        axisNames: ["right_tcp.x", "right_tcp.y", "right_tcp.z"],
      },
    ]);
  });

  test("ignores incomplete and numeric-only groups", () => {
    expect(
      findSpatialAxisGroups("action", ["0", "1", "2", "tcp.x", "tcp.y"]),
    ).toEqual([]);
  });
});

describe("spatial trajectory sampling", () => {
  test("shares the global point budget across every episode and layer", () => {
    expect(spatialPointsPerEpisode(150, 2, 120_000, 240)).toBe(240);
    expect(spatialPointsPerEpisode(1000, 2, 120_000, 240)).toBe(60);
  });

  test("keeps the first and last positions when downsampling", () => {
    const rows = Array.from({ length: 10 }, (_, index) => [
      index,
      index + 0.1,
      index + 0.2,
    ]);
    const points = extractSpatialTrajectory(
      rows,
      {
        id: "action:tcp",
        label: "tcp",
        indices: [0, 1, 2],
        axisNames: ["tcp.x", "tcp.y", "tcp.z"],
      },
      3,
    );

    expect(points.slice(0, 3)).toEqual([0, 0.1, 0.2]);
    expect(points.slice(-3)).toEqual([9, 9.1, 9.2]);
    expect(points).toHaveLength(9);
  });
});
