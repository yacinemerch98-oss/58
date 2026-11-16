import React, { useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { NavPage, Project } from '../types/studio';
import { formatTimecode } from '../lib/formatters';

interface TimelineEditorProps {
  project: Project;
  currentTime: number;
  onSeek: (time: number) => void;
  onNavigate: (page: NavPage) => void;
}

export function TimelineEditor({
  project,
  currentTime,
  onSeek,
  onNavigate,
}: TimelineEditorProps) {
  const [zoom, setZoom] = useState(1);
  const duration = Math.max(1, project.metadata?.duration || 12);
  const playheadPct = Math.max(0, Math.min(100, (currentTime / duration) * 100));

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => r * duration);

  return (
    <div className="bg-[#111115] border border-white/[0.08] rounded-xl overflow-hidden select-none">
      <div className="h-9 px-4 border-b border-white/[0.08] flex items-center justify-between">
        <div className="text-xs font-medium text-zinc-300">Timeline Tracks</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            className="p-1 text-zinc-400 hover:text-white cursor-pointer"
            title="Zoom out timeline"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-mono text-zinc-400 tabular-nums">{zoom}x</span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
            className="p-1 text-zinc-400 hover:text-white cursor-pointer"
            title="Zoom in timeline"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ width: `${zoom * 100}%`, minWidth: '100%' }} className="relative p-3 space-y-1.5">
          {/* Ruler */}
          <div
            onClick={handleTrackClick}
            className="relative h-5 border-b border-white/[0.08] cursor-pointer flex items-center justify-between text-[10px] font-mono text-zinc-500 tabular-nums px-1"
          >
            {ticks.map((t, i) => (
              <span key={i}>{formatTimecode(t)}</span>
            ))}
          </div>

          {/* Playhead Line */}
          <div
            className="absolute top-3 bottom-3 w-px bg-violet-400 z-20 pointer-events-none"
            style={{ left: `calc(${playheadPct}% )` }}
          >
            <div className="w-2.5 h-2.5 -ml-[4.5px] -mt-0.5 bg-violet-400 rotate-45" />
          </div>

          {/* Track 1: Source Video + Waveform Peaks */}
          <div
            onClick={handleTrackClick}
            className="relative h-9 bg-[#18181D] border border-white/[0.06] rounded-md overflow-hidden cursor-pointer flex items-center px-2"
          >
            <span className="relative z-10 text-[10px] font-medium text-zinc-300 mr-2 shrink-0">
              Video + Audio
            </span>
            <div className="flex-1 h-6 flex items-center gap-[2px] opacity-65">
              {(project.waveformPeaks.length > 0
                ? project.waveformPeaks
                : new Array(60).fill(0.15)
              ).map((peak, idx) => (
                <div
                  key={idx}
                  className="flex-1 bg-violet-400/60 rounded-xs"
                  style={{ height: `${Math.max(12, peak * 100)}%` }}
                />
              ))}
            </div>
          </div>

          {/* Track 2: Blur Regions */}
          <div
            onClick={() => onNavigate('blur')}
            className="relative h-7 bg-[#18181D] border border-white/[0.06] rounded-md overflow-hidden cursor-pointer flex items-center px-2"
          >
            <span className="text-[10px] font-medium text-zinc-500 mr-2 shrink-0 z-10">
              Blur ({project.blurs.filter((b) => b.enabled).length})
            </span>
            <div className="relative flex-1 h-full">
              {project.blurs.map((blur) => {
                const left = (blur.startTime / duration) * 100;
                const width = Math.max(2, ((blur.endTime - blur.startTime) / duration) * 100);
                return (
                  <div
                    key={blur.id}
                    className={`absolute top-1 bottom-1 rounded-xs px-1.5 text-[10px] truncate flex items-center ${
                      blur.enabled
                        ? 'bg-violet-600/35 border border-violet-500/60 text-violet-200'
                        : 'bg-zinc-800 border border-zinc-700 text-zinc-500'
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {blur.mode}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Track 3: Logos / Watermarks */}
          <div
            onClick={() => onNavigate('branding')}
            className="relative h-7 bg-[#18181D] border border-white/[0.06] rounded-md overflow-hidden cursor-pointer flex items-center px-2"
          >
            <span className="text-[10px] font-medium text-zinc-500 mr-2 shrink-0 z-10">
              Logos ({project.logos.filter((l) => l.enabled).length})
            </span>
            <div className="relative flex-1 h-full">
              {project.logos.map((logo) => {
                const start = logo.permanent ? 0 : logo.startTime;
                const end = logo.permanent ? duration : logo.endTime;
                const left = (start / duration) * 100;
                const width = Math.max(3, ((end - start) / duration) * 100);
                return (
                  <div
                    key={logo.id}
                    className={`absolute top-1 bottom-1 rounded-xs px-1.5 text-[10px] truncate flex items-center ${
                      logo.enabled
                        ? 'bg-emerald-600/25 border border-emerald-500/50 text-emerald-200'
                        : 'bg-zinc-800 border border-zinc-700 text-zinc-500'
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {logo.filename}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Track 4: Captions */}
          <div
            onClick={() => onNavigate('captions')}
            className="relative h-7 bg-[#18181D] border border-white/[0.06] rounded-md overflow-hidden cursor-pointer flex items-center px-2"
          >
            <span className="text-[10px] font-medium text-zinc-500 mr-2 shrink-0 z-10">
              Captions ({project.captions.length})
            </span>
            <div className="relative flex-1 h-full">
              {project.captions.map((cap) => {
                const left = (cap.start / duration) * 100;
                const width = Math.max(1.5, ((cap.end - cap.start) / duration) * 100);
                return (
                  <div
                    key={cap.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(cap.start);
                    }}
                    title={cap.text}
                    className="absolute top-1 bottom-1 rounded-xs px-1 text-[10px] truncate flex items-center bg-sky-500/25 border border-sky-400/50 text-sky-100 hover:bg-sky-500/40"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {project.subtitleStyle.useTranslated && cap.translatedText
                      ? cap.translatedText
                      : cap.text}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Track 5: AI Voiceover & Music */}
          <div
            onClick={() => onNavigate('voice')}
            className="relative h-7 bg-[#18181D] border border-white/[0.06] rounded-md overflow-hidden cursor-pointer flex items-center px-2"
          >
            <span className="text-[10px] font-medium text-zinc-500 mr-2 shrink-0 z-10">
              AI Voice
            </span>
            <div className="relative flex-1 h-full">
              {project.voice.generatedClips.map((clip) => {
                const left = (clip.start / duration) * 100;
                const width = Math.max(2, ((clip.end - clip.start) / duration) * 100);
                return (
                  <div
                    key={clip.segmentId}
                    className="absolute top-1 bottom-1 rounded-xs px-1 text-[10px] truncate flex items-center bg-amber-500/25 border border-amber-400/50 text-amber-100"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {clip.text}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
