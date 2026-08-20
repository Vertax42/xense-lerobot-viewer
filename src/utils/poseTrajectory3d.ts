const SERIES_NAME_DELIMITER = " | ";

type PoseAxis = "x" | "y" | "z";
type RotationAxis = `r${1 | 2 | 3 | 4 | 5 | 6}`;
const ROTATION_AXES = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;

type PoseComponent = PoseAxis | RotationAxis;

type PoseComponentKey = {
  component: PoseComponent;
  base: string;
  source: string;
  key: string;
};

type PoseAxisGroup = {
  source: string;
  base: string;
  components: Partial<Record<PoseComponent, PoseComponentKey>>;
};

export type RotationMatrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type EpisodePoseTrajectory = {
  id: string;
  /** Original feature source, e.g. `action` or `observation.state`. */
  source: string;
  /** Pose name, e.g. `left_tcp` or `right_tcp`. */
  label: string;
  axisNames: [string, string, string];
  /** Flat xyz triples: [x0, y0, z0, x1, y1, z1, ...]. */
  points: number[];
  /** Source timestamps corresponding to each xyz triple when available. */
  timestamps: number[];
  /** Names of the six 6D rotation components when present. */
  rotationAxisNames?: [string, string, string, string, string, string];
  /** Per-point 6D rotations; null means that row had incomplete rotation data. */
  rotationValues?: Array<
    [number, number, number, number, number, number] | null
  >;
};

export type EpisodePoseTrajectoryPlayback = {
  /** Interpolated xyz position at the requested episode time. */
  point: [number, number, number];
  /** The portion of the trajectory reached at the requested time. */
  trailPoints: number[];
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function parsePoseComponentKey(key: string): PoseComponentKey | null {
  const parts = key.split(SERIES_NAME_DELIMITER);
  if (parts.length < 2) return null;

  const source = parts.shift()?.trim() ?? "";
  const feature = parts.join(SERIES_NAME_DELIMITER).trim();
  if (!source || !feature) return null;

  const match = /^(.*)\.(x|y|z|r[1-6])$/i.exec(feature);
  if (!match) return null;

  const base = match[1].trim();
  if (!base) return null;

  return {
    source,
    base,
    component: match[2].toLowerCase() as PoseComponent,
    key,
  };
}

function sourceOrder(source: string): number {
  const lower = source.toLowerCase();
  if (lower === "action") return 0;
  if (lower === "observation.state") return 1;
  return 2;
}

/**
 * Extract complete Cartesian pose trajectories from the flat chart rows used
 * by the Episodes tab. Keys are expected in the same form as the dataset
 * chart data, for example `action | left_tcp.x`.
 */
export function extractEpisodePoseTrajectories(
  rows: Record<string, number>[],
): EpisodePoseTrajectory[] {
  const groups = new Map<string, PoseAxisGroup>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === "timestamp") continue;
      const parsed = parsePoseComponentKey(key);
      if (!parsed) continue;

      const id = `${parsed.source}\u0000${parsed.base}`;
      const group = groups.get(id) ?? {
        source: parsed.source,
        base: parsed.base,
        components: {},
      };
      group.components[parsed.component] = parsed;
      groups.set(id, group);
    }
  }

  return [...groups.values()]
    .filter(
      (group) =>
        group.components.x !== undefined &&
        group.components.y !== undefined &&
        group.components.z !== undefined,
    )
    .map((group) => {
      const xKey = group.components.x!;
      const yKey = group.components.y!;
      const zKey = group.components.z!;
      const rotationKeys = ROTATION_AXES.map((axis) => group.components[axis]);
      const hasRotation = rotationKeys.every(
        (key): key is PoseComponentKey => key !== undefined,
      );
      const points: number[] = [];
      const timestamps: number[] = [];
      const rotationValues: Array<
        [number, number, number, number, number, number] | null
      > = [];

      for (const row of rows) {
        const x = finiteNumber(row[xKey.key]);
        const y = finiteNumber(row[yKey.key]);
        const z = finiteNumber(row[zKey.key]);
        if (x === null || y === null || z === null) continue;

        points.push(x, y, z);
        const timestamp = finiteNumber(row.timestamp);
        timestamps.push(timestamp ?? timestamps.length);

        if (hasRotation) {
          const values = rotationKeys.map((key) => finiteNumber(row[key.key]));
          rotationValues.push(
            values.every((value): value is number => value !== null)
              ? (values as [number, number, number, number, number, number])
              : null,
          );
        }
      }

      const trajectory: EpisodePoseTrajectory = {
        id: `${group.source}:${group.base}`,
        source: group.source,
        label: group.base,
        axisNames: [xKey.key, yKey.key, zKey.key],
        points,
        timestamps,
      };
      if (hasRotation) {
        trajectory.rotationAxisNames = rotationKeys.map((key) => key.key) as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        trajectory.rotationValues = rotationValues;
      }
      return trajectory;
    })
    .filter((trajectory) => trajectory.points.length >= 6)
    .sort(
      (a, b) =>
        sourceOrder(a.source) - sourceOrder(b.source) ||
        a.source.localeCompare(b.source) ||
        a.label.localeCompare(b.label),
    );
}

export function hasEpisodePoseTrajectories(
  rows: Record<string, number>[],
): boolean {
  return extractEpisodePoseTrajectories(rows).length > 0;
}

function vectorNorm(vector: readonly number[]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalizeVector(
  vector: readonly number[],
): [number, number, number] | null {
  const norm = vectorNorm(vector);
  if (!Number.isFinite(norm) || norm <= 1e-12) return null;
  return [vector[0] / norm, vector[1] / norm, vector[2] / norm];
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(
  left: readonly number[],
  right: readonly number[],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

/** Reconstruct an orthonormal row-major rotation matrix from r1-r6. */
export function rotation6dToMatrix(
  values: readonly number[],
): RotationMatrix3 | null {
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const first = normalizeVector([values[0], values[1], values[2]]);
  if (!first) return null;
  const secondInput = [values[3], values[4], values[5]];
  const projection = dot(first, secondInput);
  const second = normalizeVector([
    secondInput[0] - projection * first[0],
    secondInput[1] - projection * first[1],
    secondInput[2] - projection * first[2],
  ]);
  if (!second) return null;
  const third = cross(first, second);

  // The six-dimensional representation stores the first two columns.
  return [
    first[0],
    second[0],
    third[0],
    first[1],
    second[1],
    third[1],
    first[2],
    second[2],
    third[2],
  ];
}

function interpolateRotationValues(
  lower: readonly number[],
  upper: readonly number[],
  alpha: number,
): [number, number, number, number, number, number] {
  return lower.map(
    (value, index) => value + (upper[index] - value) * alpha,
  ) as [number, number, number, number, number, number];
}

/** Return the SO(3) orientation at an episode-local playback time. */
export function sampleEpisodePoseRotation(
  trajectory: EpisodePoseTrajectory,
  timeSeconds: number,
): RotationMatrix3 | null {
  const rotations = trajectory.rotationValues;
  if (!rotations) return null;

  const validIndices = rotations.flatMap((rotation, index) =>
    rotation ? [index] : [],
  );
  if (validIndices.length === 0) return null;

  const requestedTime = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const firstIndex = validIndices[0];
  const lastIndex = validIndices[validIndices.length - 1];
  if (requestedTime <= trajectory.timestamps[firstIndex]) {
    return rotation6dToMatrix(rotations[firstIndex]!);
  }
  if (requestedTime >= trajectory.timestamps[lastIndex]) {
    return rotation6dToMatrix(rotations[lastIndex]!);
  }

  let lowerIndex = firstIndex;
  let upperIndex = lastIndex;
  for (const index of validIndices) {
    if (trajectory.timestamps[index] <= requestedTime) lowerIndex = index;
    if (trajectory.timestamps[index] >= requestedTime) {
      upperIndex = index;
      break;
    }
  }

  const lower = rotations[lowerIndex]!;
  const upper = rotations[upperIndex]!;
  if (lowerIndex === upperIndex) return rotation6dToMatrix(lower);
  const lowerTime = trajectory.timestamps[lowerIndex];
  const upperTime = trajectory.timestamps[upperIndex];
  const alpha =
    upperTime > lowerTime
      ? Math.max(
          0,
          Math.min(1, (requestedTime - lowerTime) / (upperTime - lowerTime)),
        )
      : 1;
  return rotation6dToMatrix(interpolateRotationValues(lower, upper, alpha));
}

/**
 * Interpolate a sampled trajectory at an episode-local playback time. The
 * chart rows are sampled for rendering, so interpolation keeps the playback
 * marker smooth without loading the original parquet rows again.
 */
export function sampleEpisodePoseTrajectory(
  trajectory: EpisodePoseTrajectory,
  timeSeconds: number,
): EpisodePoseTrajectoryPlayback | null {
  const pointCount = Math.min(
    Math.floor(trajectory.points.length / 3),
    trajectory.timestamps.length,
  );
  if (pointCount === 0) return null;

  const firstPoint: [number, number, number] = [
    trajectory.points[0],
    trajectory.points[1],
    trajectory.points[2],
  ];
  const firstTime = trajectory.timestamps[0];
  const requestedTime = Number.isFinite(timeSeconds) ? timeSeconds : firstTime;

  if (pointCount === 1 || requestedTime <= firstTime) {
    return {
      point: firstPoint,
      trailPoints: firstPoint.slice(),
    };
  }

  const lastIndex = pointCount - 1;
  const lastTime = trajectory.timestamps[lastIndex];
  if (requestedTime >= lastTime) {
    return {
      point: [
        trajectory.points[lastIndex * 3],
        trajectory.points[lastIndex * 3 + 1],
        trajectory.points[lastIndex * 3 + 2],
      ],
      trailPoints: trajectory.points.slice(0, pointCount * 3),
    };
  }

  // Find the first sampled point at or after the requested time. The chart
  // sample is capped at a few thousand points, so a linear walk is both
  // inexpensive and robust to duplicate/non-monotonic timestamps.
  let upperIndex = 1;
  while (
    upperIndex < pointCount &&
    trajectory.timestamps[upperIndex] < requestedTime
  ) {
    upperIndex += 1;
  }

  const lowerIndex = upperIndex - 1;
  const lowerTime = trajectory.timestamps[lowerIndex];
  const upperTime = trajectory.timestamps[upperIndex];
  const lowerOffset = lowerIndex * 3;
  const upperOffset = upperIndex * 3;
  const denominator = upperTime - lowerTime;
  const alpha =
    denominator > 0
      ? Math.max(0, Math.min(1, (requestedTime - lowerTime) / denominator))
      : 1;
  const point: [number, number, number] = [
    trajectory.points[lowerOffset] +
      (trajectory.points[upperOffset] - trajectory.points[lowerOffset]) * alpha,
    trajectory.points[lowerOffset + 1] +
      (trajectory.points[upperOffset + 1] -
        trajectory.points[lowerOffset + 1]) *
        alpha,
    trajectory.points[lowerOffset + 2] +
      (trajectory.points[upperOffset + 2] -
        trajectory.points[lowerOffset + 2]) *
        alpha,
  ];

  const trailPoints = trajectory.points.slice(0, (lowerIndex + 1) * 3);
  trailPoints.push(...point);
  return { point, trailPoints };
}
