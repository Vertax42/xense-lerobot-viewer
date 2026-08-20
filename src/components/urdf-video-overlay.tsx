"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { VideoInfo } from "@/types";
import { THRESHOLDS } from "@/utils/constants";
import {
  groupUrdfReplayVideos,
  urdfReplayMediaTime,
} from "@/utils/urdfReplayVideos";

function fallbackLabel(filename: string): string {
  const tail = filename.split(/[./]/).at(-1) ?? filename;
  return tail.replaceAll("_", " ");
}

function ReplayVideoTile({
  active,
  compact = false,
  episodeTimeSeconds,
  playing,
  video,
}: {
  active: boolean;
  compact?: boolean;
  episodeTimeSeconds: number;
  playing: boolean;
  video: VideoInfo;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const targetTime = urdfReplayMediaTime(video, episodeTimeSeconds);
  const targetTimeRef = useRef(targetTime);
  const shouldPlayRef = useRef(active && playing);
  targetTimeRef.current = targetTime;
  shouldPlayRef.current = active && playing;

  const syncToReplay = useCallback((force: boolean) => {
    const element = videoRef.current;
    if (!element || element.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const tolerance = force ? 1 / 120 : THRESHOLDS.VIDEO_SYNC_TOLERANCE;
    if (Math.abs(element.currentTime - targetTimeRef.current) > tolerance) {
      element.currentTime = targetTimeRef.current;
    }
  }, []);

  const playFromReplay = useCallback(() => {
    const element = videoRef.current;
    if (!element || !shouldPlayRef.current || !element.paused) return;
    void element.play().catch((error: unknown) => {
      if (!(error instanceof DOMException) || error.name !== "AbortError") {
        console.warn(`Unable to play 3D Replay video ${video.filename}`);
      }
    });
  }, [video.filename]);

  // Paused slider changes are exact seeks. During playback the MP4 runs on its
  // own media clock and is only corrected when it drifts materially, avoiding
  // eight expensive decoder seeks on every rendered frame.
  useEffect(() => {
    if (!active) return;
    syncToReplay(!playing);
    // Seeking away from the native `ended` position does not resume an MP4
    // automatically. Restart it when the 3D frame counter loops to frame 0.
    playFromReplay();
  }, [active, playFromReplay, playing, syncToReplay, targetTime]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (!active || !playing) {
      element.pause();
      return;
    }
    syncToReplay(true);
    playFromReplay();
  }, [active, playFromReplay, playing, syncToReplay]);

  const handleLoadedMetadata = useCallback(() => {
    syncToReplay(true);
    playFromReplay();
  }, [playFromReplay, syncToReplay]);

  const label = fallbackLabel(video.filename);

  return (
    <figure className="relative overflow-hidden rounded-md border border-white/15 bg-black/90 shadow-xl">
      <video
        ref={videoRef}
        aria-label={label}
        className={`block w-full bg-black object-contain ${
          compact ? "aspect-[7/4]" : "aspect-[4/3]"
        }`}
        disablePictureInPicture
        muted
        onLoadedMetadata={handleLoadedMetadata}
        playsInline
        preload="metadata"
        src={video.url}
      />
      <figcaption className="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-slate-950/75 px-1.5 py-0.5 text-[9px] font-medium leading-none text-slate-100 shadow backdrop-blur-sm">
        {label}
      </figcaption>
    </figure>
  );
}

function SideVideoGroup({
  active,
  episodeTimeSeconds,
  playing,
  videos,
}: {
  active: boolean;
  episodeTimeSeconds: number;
  playing: boolean;
  videos: VideoInfo[];
}) {
  const [primary, ...secondary] = videos;
  if (!primary) return null;
  return (
    <div className="space-y-1.5">
      <ReplayVideoTile
        key={`${primary.filename}:${primary.url}:${primary.segmentStart ?? 0}`}
        active={active}
        episodeTimeSeconds={episodeTimeSeconds}
        playing={playing}
        video={primary}
      />
      {secondary.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {secondary.map((video) => (
            <ReplayVideoTile
              key={`${video.filename}:${video.url}:${video.segmentStart ?? 0}`}
              active={active}
              compact
              episodeTimeSeconds={episodeTimeSeconds}
              playing={playing}
              video={video}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function UrdfVideoOverlay({
  active,
  episodeTimeSeconds,
  playing,
  videos,
}: {
  active: boolean;
  episodeTimeSeconds: number;
  playing: boolean;
  videos: VideoInfo[];
}) {
  const groups = useMemo(() => groupUrdfReplayVideos(videos), [videos]);
  const hasAnyVideo =
    groups.left.length > 0 ||
    groups.center.length > 0 ||
    groups.right.length > 0;
  if (!hasAnyVideo) return null;

  const shared = { active, episodeTimeSeconds, playing };
  const hasSingleHead = groups.center.length === 1;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className="absolute left-3 top-3"
        style={{ width: "clamp(7.5rem, 17vw, 13.5rem)" }}
      >
        <SideVideoGroup {...shared} videos={groups.left} />
      </div>

      {groups.center.length > 0 && (
        <div
          className={`absolute left-1/2 top-3 grid -translate-x-1/2 gap-1.5 ${
            hasSingleHead ? "grid-cols-1" : "grid-cols-2"
          }`}
          style={{
            width: hasSingleHead
              ? "clamp(8rem, 16vw, 14rem)"
              : "clamp(12rem, 29vw, 26rem)",
          }}
        >
          {groups.center.map((video) => (
            <ReplayVideoTile
              key={`${video.filename}:${video.url}:${video.segmentStart ?? 0}`}
              {...shared}
              video={video}
            />
          ))}
        </div>
      )}

      <div
        className="absolute right-3 top-3"
        style={{ width: "clamp(7.5rem, 17vw, 13.5rem)" }}
      >
        <SideVideoGroup {...shared} videos={groups.right} />
      </div>
    </div>
  );
}
