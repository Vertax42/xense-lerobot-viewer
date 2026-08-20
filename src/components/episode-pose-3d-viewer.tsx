"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useT } from "@/context/locale-context";
import { useTime } from "@/context/time-context";
import {
  extractEpisodePoseTrajectories,
  sampleEpisodePoseRotation,
  sampleEpisodePoseTrajectory,
  type EpisodePoseTrajectory,
  type RotationMatrix3,
} from "@/utils/poseTrajectory3d";

type Bounds = {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  extent: number;
};

type ControlsHandle = React.ElementRef<typeof OrbitControls>;

function toScenePoint(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  // Dataset coordinates are x/y/z with z up. Three.js uses y up.
  return [x, z, -y];
}

function trajectoryColor(trajectory: EpisodePoseTrajectory): string {
  const source = trajectory.source.toLowerCase();
  const label = trajectory.label.toLowerCase();
  if (source === "action" && label.includes("left")) return "#22d3ee";
  if (source === "action" && label.includes("right")) return "#f472b6";
  if (source === "observation.state" && label.includes("left")) {
    return "#34d399";
  }
  if (source === "observation.state" && label.includes("right")) {
    return "#fbbf24";
  }

  let hash = 0;
  for (const character of trajectory.id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  const fallback = ["#60a5fa", "#c084fc", "#fb7185", "#a3e635"];
  return fallback[Math.abs(hash) % fallback.length];
}

function sourceLabel(source: string): string {
  return source;
}

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1000 || (absolute > 0 && absolute < 0.001)) {
    return value.toExponential(2);
  }
  return value.toFixed(3);
}

/**
 * The global time context throttles React renders for the rest of the UI.
 * Keep a local frame clock for this visualizer so playback advances at the
 * dataset FPS between sparse video `timeupdate` events.
 */
function useFramePlaybackTime(fps: number | undefined): number {
  const { currentTime, duration, isPlaying, subscribe } = useTime();
  const frameRate =
    Number.isFinite(fps) && (fps ?? 0) > 0 ? (fps as number) : 30;
  const snapToFrame = useCallback(
    (time: number) => {
      const bounded = Math.max(
        0,
        duration > 0 ? Math.min(time, duration) : time,
      );
      // A video frame owns the interval until the next frame boundary, so
      // floor rather than round; this keeps the marker from appearing one
      // frame ahead of the video.
      const snapped =
        Math.floor((bounded + Number.EPSILON) * frameRate) / frameRate;
      return duration > 0 ? Math.min(snapped, duration) : snapped;
    },
    [duration, frameRate],
  );
  const sourceRef = useRef({
    time: Number.isFinite(currentTime) ? currentTime : 0,
    wallTime: performance.now(),
  });
  const currentTimeRef = useRef(sourceRef.current.time);
  const [frameTime, setFrameTime] = useState(() =>
    snapToFrame(sourceRef.current.time),
  );

  useEffect(() => {
    currentTimeRef.current = Number.isFinite(currentTime) ? currentTime : 0;
  }, [currentTime]);

  useEffect(() => {
    const updateAnchor = (time: number) => {
      const finiteTime = Number.isFinite(time) ? time : 0;
      currentTimeRef.current = finiteTime;
      sourceRef.current = {
        time: finiteTime,
        wallTime: performance.now(),
      };
      const next = snapToFrame(finiteTime);
      setFrameTime((previous) => (previous === next ? previous : next));
    };

    updateAnchor(currentTimeRef.current);
    return subscribe(updateAnchor);
  }, [snapToFrame, subscribe]);

  useEffect(() => {
    if (!isPlaying) {
      const next = snapToFrame(currentTimeRef.current);
      setFrameTime((previous) => (previous === next ? previous : next));
      return;
    }

    let animationFrame = 0;
    const tick = (now: number) => {
      const elapsedSeconds = Math.max(
        0,
        (now - sourceRef.current.wallTime) / 1000,
      );
      const next = snapToFrame(sourceRef.current.time + elapsedSeconds);
      setFrameTime((previous) => (previous === next ? previous : next));
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, snapToFrame]);

  return frameTime;
}

function rotationColumn(
  matrix: RotationMatrix3,
  column: 0 | 1 | 2,
): [number, number, number] {
  return [matrix[column], matrix[3 + column], matrix[6 + column]];
}

function PoseOrientationFrame({
  origin,
  rotation,
  size,
  highlighted,
  onHover,
}: {
  /** Origin in dataset coordinates, before the Z-up to Y-up conversion. */
  origin: [number, number, number];
  rotation: RotationMatrix3;
  size: number;
  highlighted: boolean;
  onHover: () => void;
}) {
  const sceneOrigin = new THREE.Vector3(...toScenePoint(...origin));
  const axes = [
    { label: "X", color: "#f87171", direction: rotationColumn(rotation, 0) },
    { label: "Y", color: "#4ade80", direction: rotationColumn(rotation, 1) },
    { label: "Z", color: "#60a5fa", direction: rotationColumn(rotation, 2) },
  ] as const;

  return (
    <group>
      {axes.map((axis) => {
        const endpoint = new THREE.Vector3(
          ...toScenePoint(
            origin[0] + axis.direction[0] * size,
            origin[1] + axis.direction[1] * size,
            origin[2] + axis.direction[2] * size,
          ),
        );
        return (
          <React.Fragment key={axis.label}>
            <Line
              points={[sceneOrigin, endpoint]}
              color={axis.color}
              lineWidth={highlighted ? 2.8 : 1.6}
              transparent
              opacity={highlighted ? 1 : 0.8}
              depthWrite={false}
              onPointerOver={(event) => {
                event.stopPropagation();
                onHover();
              }}
            />
            {highlighted && (
              <Html position={endpoint} center>
                <span
                  className="pointer-events-none rounded bg-slate-950/80 px-0.5 text-[8px] font-semibold leading-none"
                  style={{ color: axis.color }}
                >
                  {axis.label}
                </span>
              </Html>
            )}
          </React.Fragment>
        );
      })}
    </group>
  );
}

function computeBounds(trajectories: EpisodePoseTrajectory[]): Bounds {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (const trajectory of trajectories) {
    for (let index = 0; index + 2 < trajectory.points.length; index += 3) {
      min.min(
        new THREE.Vector3(
          ...toScenePoint(
            trajectory.points[index],
            trajectory.points[index + 1],
            trajectory.points[index + 2],
          ),
        ),
      );
      max.max(
        new THREE.Vector3(
          ...toScenePoint(
            trajectory.points[index],
            trajectory.points[index + 1],
            trajectory.points[index + 2],
          ),
        ),
      );
    }
  }

  if (!Number.isFinite(min.x)) {
    min.set(-0.5, -0.5, -0.5);
    max.set(0.5, 0.5, 0.5);
  }

  const center = min.clone().add(max).multiplyScalar(0.5);
  const size = max.clone().sub(min);
  return {
    min,
    max,
    center,
    extent: Math.max(size.x, size.y, size.z, 0.1),
  };
}

function gridStep(extent: number): number {
  const rough = extent / 10;
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-6)));
  const normalized = rough / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : 5) * power;
}

function PoseLine({
  trajectory,
  highlighted,
  currentTime,
  pointRadius,
  onHover,
}: {
  trajectory: EpisodePoseTrajectory;
  highlighted: boolean;
  currentTime: number;
  pointRadius: number;
  onHover: (id: string | null) => void;
}) {
  const points = useMemo(() => {
    const result: THREE.Vector3[] = [];
    for (let index = 0; index + 2 < trajectory.points.length; index += 3) {
      result.push(
        new THREE.Vector3(
          ...toScenePoint(
            trajectory.points[index],
            trajectory.points[index + 1],
            trajectory.points[index + 2],
          ),
        ),
      );
    }
    return result;
  }, [trajectory]);

  const playback = useMemo(
    () => sampleEpisodePoseTrajectory(trajectory, currentTime),
    [currentTime, trajectory],
  );
  const rotation = useMemo(
    () => sampleEpisodePoseRotation(trajectory, currentTime),
    [currentTime, trajectory],
  );
  const activePoints = useMemo(
    () =>
      playback
        ? Array.from(
            { length: Math.floor(playback.trailPoints.length / 3) },
            (_, pointIndex) => {
              const offset = pointIndex * 3;
              return new THREE.Vector3(
                ...toScenePoint(
                  playback.trailPoints[offset],
                  playback.trailPoints[offset + 1],
                  playback.trailPoints[offset + 2],
                ),
              );
            },
          )
        : [],
    [playback],
  );

  const currentPoint = playback
    ? new THREE.Vector3(...toScenePoint(...playback.point))
    : null;

  if (points.length < 2) return null;

  return (
    <group>
      <Line
        points={points}
        color={trajectoryColor(trajectory)}
        lineWidth={highlighted ? 3 : 1.2}
        transparent
        opacity={highlighted ? 0.5 : 0.16}
        depthWrite={false}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(trajectory.id);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          onHover(null);
        }}
      />
      {activePoints.length >= 2 && (
        <Line
          points={activePoints}
          color={trajectoryColor(trajectory)}
          lineWidth={highlighted ? 4 : 2.2}
          transparent
          opacity={highlighted ? 1 : 0.9}
          depthWrite={false}
          onPointerOver={(event) => {
            event.stopPropagation();
            onHover(trajectory.id);
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            onHover(null);
          }}
        />
      )}
      {currentPoint && (
        <>
          <mesh
            position={currentPoint}
            onPointerOver={(event) => {
              event.stopPropagation();
              onHover(trajectory.id);
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              onHover(null);
            }}
          >
            <sphereGeometry args={[pointRadius, 12, 12]} />
            <meshBasicMaterial
              color={trajectoryColor(trajectory)}
              transparent
              opacity={highlighted ? 1 : 0.95}
            />
          </mesh>
          {rotation && playback && (
            <PoseOrientationFrame
              origin={playback.point}
              rotation={rotation}
              size={pointRadius * 3}
              highlighted={highlighted}
              onHover={() => onHover(trajectory.id)}
            />
          )}
        </>
      )}
    </group>
  );
}

function AxisGuide({ bounds }: { bounds: Bounds }) {
  const length = bounds.extent * 0.18;
  const origin = new THREE.Vector3(
    bounds.min.x,
    bounds.min.y - bounds.extent * 0.04,
    bounds.max.z,
  );
  const labelClass =
    "pointer-events-none rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-semibold";

  return (
    <group>
      <Line
        points={[origin, origin.clone().add(new THREE.Vector3(length, 0, 0))]}
        color="#f87171"
        lineWidth={1.5}
      />
      <Line
        points={[origin, origin.clone().add(new THREE.Vector3(0, 0, -length))]}
        color="#4ade80"
        lineWidth={1.5}
      />
      <Line
        points={[origin, origin.clone().add(new THREE.Vector3(0, length, 0))]}
        color="#60a5fa"
        lineWidth={1.5}
      />
      <Html position={[origin.x + length, origin.y, origin.z]} center>
        <span className={`${labelClass} text-red-300`}>X</span>
      </Html>
      <Html position={[origin.x, origin.y, origin.z - length]} center>
        <span className={`${labelClass} text-green-300`}>Y</span>
      </Html>
      <Html position={[origin.x, origin.y + length, origin.z]} center>
        <span className={`${labelClass} text-blue-300`}>Z</span>
      </Html>
    </group>
  );
}

function CameraFit({
  bounds,
  controlsRef,
}: {
  bounds: Bounds;
  controlsRef: React.RefObject<ControlsHandle | null>;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const distance =
      (bounds.extent / (2 * Math.tan((perspective.fov * Math.PI) / 360))) *
      1.45;
    perspective.position.set(
      bounds.center.x + distance * 0.75,
      bounds.center.y + distance * 0.55,
      bounds.center.z + distance * 0.75,
    );
    perspective.near = Math.max(distance / 1000, 0.001);
    perspective.far = Math.max(distance * 20, 100);
    perspective.updateProjectionMatrix();
    controlsRef.current?.target.copy(bounds.center);
    controlsRef.current?.update();
  }, [bounds, camera, controlsRef]);

  return null;
}

function PoseScene({
  trajectories,
  boundsTrajectories,
  currentTime,
  hoveredId,
  onHover,
}: {
  trajectories: EpisodePoseTrajectory[];
  boundsTrajectories: EpisodePoseTrajectory[];
  currentTime: number;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}) {
  const controlsRef = useRef<ControlsHandle | null>(null);
  // Keep the camera bounds based on every trajectory, not only the selected
  // legend entries. Toggling action/state or left/right therefore never
  // changes the zoom or camera target.
  const bounds = useMemo(
    () => computeBounds(boundsTrajectories),
    [boundsTrajectories],
  );
  const size = bounds.extent * 1.4;
  const pointRadius = Math.max(bounds.extent * 0.012, 0.002);

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [1, 1, 1], fov: 45, near: 0.001, far: 100 }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={["#111827"]} />
      {trajectories.map((trajectory) => (
        <PoseLine
          key={trajectory.id}
          trajectory={trajectory}
          highlighted={hoveredId === trajectory.id}
          currentTime={currentTime}
          pointRadius={pointRadius}
          onHover={onHover}
        />
      ))}
      <Grid
        args={[size, size]}
        position={[
          bounds.center.x,
          bounds.min.y - bounds.extent * 0.05,
          bounds.center.z,
        ]}
        cellSize={gridStep(bounds.extent)}
        cellThickness={0.45}
        cellColor="#334155"
        sectionSize={gridStep(bounds.extent) * 5}
        sectionThickness={0.8}
        sectionColor="#475569"
        fadeDistance={size * 1.5}
        infiniteGrid
      />
      <AxisGuide bounds={bounds} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
      />
      <CameraFit bounds={bounds} controlsRef={controlsRef} />
    </Canvas>
  );
}

export default function EpisodePose3DViewer({
  rows,
  fps,
}: {
  rows: Record<string, number>[];
  fps?: number;
}) {
  const t = useT();
  const { duration } = useTime();
  const playbackTime = useFramePlaybackTime(fps);
  const trajectories = useMemo(
    () => extractEpisodePoseTrajectories(rows),
    [rows],
  );
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    setVisibleIds(new Set(trajectories.map((trajectory) => trajectory.id)));
    setHoveredId(null);
  }, [trajectories]);

  const visibleTrajectories = useMemo(
    () => trajectories.filter((trajectory) => visibleIds.has(trajectory.id)),
    [trajectories, visibleIds],
  );
  const hoveredTrajectory = trajectories.find(
    (trajectory) => trajectory.id === hoveredId,
  );
  const hoveredPlayback = hoveredTrajectory
    ? sampleEpisodePoseTrajectory(hoveredTrajectory, playbackTime)
    : null;

  useEffect(() => {
    if (hoveredId && !visibleIds.has(hoveredId)) setHoveredId(null);
  }, [hoveredId, visibleIds]);

  const toggleTrajectory = (id: string) => {
    setVisibleIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (trajectories.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-white/10 bg-[var(--surface-1)]/40 text-sm text-slate-500">
        {t("chart.threeDNoData")}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-[var(--surface-1)]/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {trajectories.map((trajectory) => {
            const active = visibleIds.has(trajectory.id);
            return (
              <button
                key={trajectory.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTrajectory(trajectory.id)}
                className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
                  active
                    ? "text-slate-200"
                    : "text-slate-600 hover:text-slate-400"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: trajectoryColor(trajectory),
                    opacity: active ? 1 : 0.3,
                  }}
                />
                {sourceLabel(trajectory.source)} · {trajectory.label}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-slate-500">
          <span>
            {t("chart.threeDPointCount", {
              count: visibleTrajectories.reduce(
                (sum, trajectory) => sum + trajectory.points.length / 3,
                0,
              ),
            })}
          </span>
          <span className="ml-3 tabular-nums">
            {t("chart.threeDPlayback", {
              current: playbackTime.toFixed(2),
              duration: duration.toFixed(2),
            })}
          </span>
        </div>
      </div>

      <div
        className="flex min-h-7 items-center gap-2 rounded border border-white/10 bg-slate-950/30 px-2 py-1 text-[11px]"
        aria-live="polite"
      >
        {hoveredTrajectory ? (
          <>
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: trajectoryColor(hoveredTrajectory) }}
            />
            <span className="text-slate-100">
              {sourceLabel(hoveredTrajectory.source)} ·{" "}
              {hoveredTrajectory.label}
            </span>
            {hoveredPlayback && (
              <span className="ml-1 truncate font-mono text-[10px] tabular-nums text-slate-400">
                x {formatCoordinate(hoveredPlayback.point[0])} · y{" "}
                {formatCoordinate(hoveredPlayback.point[1])} · z{" "}
                {formatCoordinate(hoveredPlayback.point[2])} m
              </span>
            )}
          </>
        ) : (
          <span className="text-slate-500">{t("chart.threeDHoverPrompt")}</span>
        )}
      </div>

      <div className="relative h-[500px] overflow-hidden rounded-md border border-white/10 bg-slate-900">
        <PoseScene
          trajectories={visibleTrajectories}
          boundsTrajectories={trajectories}
          currentTime={playbackTime}
          hoveredId={hoveredId}
          onHover={setHoveredId}
        />
        {visibleTrajectories.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm text-slate-500">
            {t("chart.threeDSelectTrajectory")}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{t("chart.threeDControls")}</span>
        <span>
          {t("chart.threeDCoordinate")} · {t("chart.threeDRotationAxes")}
        </span>
      </div>
    </div>
  );
}
