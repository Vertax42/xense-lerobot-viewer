export type SpatialAxisGroup = {
  id: string;
  label: string;
  indices: [number, number, number];
  axisNames: [string, string, string];
};

export type SpatialTrajectory = {
  episodeIndex: number;
  /** Flat xyz triples: [x0, y0, z0, x1, y1, z1, ...]. */
  points: number[];
};

export type SpatialTrajectoryLayer = {
  id: string;
  label: string;
  axisNames: [string, string, string];
  trajectories: SpatialTrajectory[];
};

export type SpatialTrajectoryData = {
  totalEpisodes: number;
  pointsPerEpisode: number;
  totalPoints: number;
  layers: SpatialTrajectoryLayer[];
};

type MutableAxes = Partial<Record<"x" | "y" | "z", number>> & {
  names: Partial<Record<"x" | "y" | "z", string>>;
};

/**
 * Find complete named xyz triplets such as left_tcp.x/y/z. Numeric-only
 * feature names are intentionally ignored: without semantic names there is
 * no reliable way to know which three dimensions form a Cartesian position.
 */
export function findSpatialAxisGroups(
  featureKey: string,
  names: string[],
): SpatialAxisGroup[] {
  const groups = new Map<string, MutableAxes>();

  for (let index = 0; index < names.length; index++) {
    const name = names[index]?.trim();
    const match = name?.match(/^(.*)\.(x|y|z)$/i);
    if (!match) continue;

    const axis = match[2].toLowerCase() as "x" | "y" | "z";
    const rawBase = match[1].replace(/\.position$/i, "").trim();
    if (!rawBase) continue;

    const key = rawBase.toLowerCase();
    const group = groups.get(key) ?? { names: {} };
    group[axis] = index;
    group.names[axis] = name;
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(
      ([, axes]) =>
        axes.x !== undefined && axes.y !== undefined && axes.z !== undefined,
    )
    .map(([key, axes]) => ({
      id: `${featureKey}:${key}`,
      label: key,
      indices: [axes.x!, axes.y!, axes.z!],
      axisNames: [axes.names.x!, axes.names.y!, axes.names.z!],
    }));
}

export function spatialPointsPerEpisode(
  totalEpisodes: number,
  layerCount: number,
  maxTotalPoints: number,
  maxPointsPerEpisode: number,
): number {
  if (totalEpisodes <= 0 || layerCount <= 0) return 0;
  const fairShare = Math.floor(
    maxTotalPoints / Math.max(1, totalEpisodes * layerCount),
  );
  return Math.max(2, Math.min(maxPointsPerEpisode, fairShare));
}

function evenlySampleIndices(length: number, target: number): number[] {
  if (length <= 0 || target <= 0) return [];
  if (target >= length) return Array.from({ length }, (_, index) => index);
  if (target === 1) return [0];

  return Array.from({ length: target }, (_, index) =>
    Math.round((index * (length - 1)) / (target - 1)),
  );
}

export function extractSpatialTrajectory(
  rows: number[][],
  axes: SpatialAxisGroup,
  maxPoints: number,
): number[] {
  const result: number[] = [];
  for (const rowIndex of evenlySampleIndices(rows.length, maxPoints)) {
    const row = rows[rowIndex];
    const x = Number(row?.[axes.indices[0]]);
    const y = Number(row?.[axes.indices[1]]);
    const z = Number(row?.[axes.indices[2]]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    result.push(x, y, z);
  }
  return result;
}
