import { describe, expect, test } from "bun:test";
import {
  TACCAP_ROOT_TO_RECORDED_TCP_TRANSLATION,
  tacCapDatasetPointToScene,
  tacCapRecordedTcpSceneMatrix,
  tacCapRecordedTcpToRootMatrix,
} from "@/utils/taccapGripperTransforms";

describe("TacCap replay coordinate transforms", () => {
  test("maps the world convention to the Three.js Y-up scene", () => {
    expect(tacCapDatasetPointToScene([1, 2, 3])).toEqual([1, 3, -2]);
    expect(
      tacCapRecordedTcpSceneMatrix([1, 2, 3], [1, 0, 0, 0, 1, 0, 0, 0, 1]),
    ).toEqual([1, 0, 0, 1, 0, 0, 1, 3, 0, -1, 0, -2, 0, 0, 0, 1]);
  });

  test("keeps both grippers aligned to the same canonical TCP axes", () => {
    expect(TACCAP_ROOT_TO_RECORDED_TCP_TRANSLATION.left[0]).toBeCloseTo(
      TACCAP_ROOT_TO_RECORDED_TCP_TRANSLATION.right[0],
      4,
    );
    expect(TACCAP_ROOT_TO_RECORDED_TCP_TRANSLATION.left[1]).toBe(0);
    expect(TACCAP_ROOT_TO_RECORDED_TCP_TRANSLATION.right[1]).toBe(0);

    for (const side of ["left", "right"] as const) {
      const tcpToRoot = tacCapRecordedTcpToRootMatrix(side);
      // Both rotation blocks are identity. In particular, the left side must
      // not inherit the URDF CAD marker's local -90° Z rotation.
      expect([
        tcpToRoot[0],
        tcpToRoot[1],
        tcpToRoot[2],
        tcpToRoot[4],
        tcpToRoot[5],
        tcpToRoot[6],
        tcpToRoot[8],
        tcpToRoot[9],
        tcpToRoot[10],
      ]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
  });
});
