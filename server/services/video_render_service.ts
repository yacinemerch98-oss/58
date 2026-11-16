import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_VIDEO_CANVAS, Project } from '../../src/types/studio.ts';
import { resolveCanvasDimensions } from '../../src/lib/workflowStages.ts';
import { EXPORTS_DIR, FONTS_DIR, getAssetByUrl, registerAsset } from '../db.ts';
import { buildAudioMixFilters } from './audio_processing_service.ts';
import { buildBlurFilters } from './blur_processing_service.ts';
import { buildLogoOverlayFilters } from './logo_overlay_service.ts';
import { generateAssFile } from './subtitle_service.ts';
import { buildVideoEffectsFilters } from './video_effects_service.ts';
import { analyzeVideoFile } from './video_analysis_service.ts';
import {
  buildSyncedCaptionsForRender,
  buildVideoFrameHoldFilter,
  remapBlursForSyncPlan,
  remapLogosForSyncPlan,
} from './timeline_sync_service.ts';

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function renderProjectVideo(params: {
  project: Project;
  onProgress: (progress: number, stage: string, etaSeconds: number | null) => void;
}): Promise<{ outputPath: string; outputUrl: string; outputSize: number }> {
  const { project, onProgress } = params;
  if (!project.sourceVideoUrl || !project.metadata) {
    throw new Error('Project has no uploaded source video.');
  }

  const videoAsset = getAssetByUrl(project.sourceVideoUrl);
  if (!videoAsset || !fs.existsSync(videoAsset.file_path)) {
    throw new Error('Source video file is missing from storage.');
  }

  const { exportSettings } = project;
  const canvas = { ...DEFAULT_VIDEO_CANVAS, ...(project.canvas || {}) };
  const { width, height } = resolveCanvasDimensions(
    canvas,
    exportSettings,
    project.metadata
  );
  const origDur = Math.max(0.5, project.metadata.duration || 10);
  const activeSyncPlan =
    exportSettings.applyDubbing &&
    project.voice.enabled &&
    project.voice.fullDubUrl &&
    (project.voice.syncMode || 'flexible') === 'flexible' &&
    project.voice.syncPlan &&
    project.voice.syncPlan.holds.length > 0
      ? project.voice.syncPlan
      : undefined;
  const totalDur = activeSyncPlan
    ? Math.max(origDur, activeSyncPlan.estimatedFinalDuration)
    : origDur;

  onProgress(5, 'Preparing filter graph', null);

  const tempFilesToClean: string[] = [];
  const extraInputs: string[] = [];
  const filterSteps: string[] = [];
  let nextInputIdx = 1;

  const videoVisible = canvas.videoVisible !== false;
  const videoOpacity = Math.max(0.05, Math.min(1, canvas.videoOpacity ?? 1));
  const videoRotDeg = canvas.videoRotation || 0;
  const bgVisible = canvas.bgImageVisible !== false;
  const bgOpacity = Math.max(0.05, Math.min(1, canvas.bgImageOpacity ?? 1));
  const bgRotDeg = canvas.bgImageRotation || 0;

  // Step 1: Prepare Foreground Video & Canvas Background Fill
  let currentV = 'v_scaled';
  const hasCustomCanvas =
    canvas.aspectRatio !== 'original' ||
    Math.abs((canvas.zoom || 1) - 1) > 0.005 ||
    Math.abs(canvas.offsetX || 0) > 0.1 ||
    Math.abs(canvas.offsetY || 0) > 0.1 ||
    Math.abs(videoRotDeg) > 0.2 ||
    videoOpacity < 0.99 ||
    !videoVisible ||
    (canvas.cropTop || 0) > 0 ||
    (canvas.cropRight || 0) > 0 ||
    (canvas.cropBottom || 0) > 0 ||
    (canvas.cropLeft || 0) > 0 ||
    canvas.backgroundType !== 'solid' ||
    (canvas.bgColor || '#09090B').toUpperCase() !== '#09090B';

  if (!hasCustomCanvas) {
    if (exportSettings.aspectRatio === 'original') {
      filterSteps.push(`[0:v]scale=${width}:${height},setsar=1[${currentV}]`);
    } else if (exportSettings.fitMode === 'crop') {
      filterSteps.push(
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[${currentV}]`
      );
    } else if (exportSettings.fitMode === 'blur-pad') {
      filterSteps.push(
        `[0:v]split[v_bg][v_fg];` +
          `[v_bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=24[v_bg_b];` +
          `[v_fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[v_fg_s];` +
          `[v_bg_b][v_fg_s]overlay=(W-w)/2:(H-h)/2,setsar=1[${currentV}]`
      );
    } else {
      filterSteps.push(
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#09090B,setsar=1[${currentV}]`
      );
    }
  } else {
    const fpsVal = Math.max(1, Math.round(project.metadata.fps || 30));
    const srcW = Math.max(16, project.metadata.width || 1280);
    const srcH = Math.max(16, project.metadata.height || 720);
    const cropLeft = Math.max(0, Math.min(45, canvas.cropLeft || 0));
    const cropRight = Math.max(0, Math.min(45, canvas.cropRight || 0));
    const cropTop = Math.max(0, Math.min(45, canvas.cropTop || 0));
    const cropBottom = Math.max(0, Math.min(45, canvas.cropBottom || 0));

    const cw = Math.max(16, Math.round(srcW * (1 - (cropLeft + cropRight) / 100)) & ~1);
    const ch = Math.max(16, Math.round(srcH * (1 - (cropTop + cropBottom) / 100)) & ~1);
    const cx = Math.max(0, Math.min(srcW - cw, Math.round((srcW * cropLeft) / 100)));
    const cy = Math.max(0, Math.min(srcH - ch, Math.round((srcH * cropTop) / 100)));

    let fitW: number;
    let fitH: number;
    if (cw / ch > width / height) {
      fitW = width;
      fitH = Math.max(2, Math.round((width * ch) / cw) & ~1);
    } else {
      fitH = height;
      fitW = Math.max(2, Math.round((height * cw) / ch) & ~1);
    }

    const zoom = Math.max(0.25, Math.min(3.0, canvas.zoom || 1));
    const fgW = Math.max(16, Math.round(fitW * zoom) & ~1);
    const fgH = Math.max(16, Math.round(fitH * zoom) & ~1);
    const centerX = width / 2 + ((canvas.offsetX || 0) / 100) * width;
    const centerY = height / 2 + ((canvas.offsetY || 0) / 100) * height;

    const needsFgTransform = Math.abs(videoRotDeg) > 0.2 || videoOpacity < 0.99;
    let fgChain = `[0:v]crop=${cw}:${ch}:${cx}:${cy},scale=${fgW}:${fgH},setsar=1`;
    if (needsFgTransform) {
      fgChain += `,format=rgba`;
      if (videoOpacity < 0.99) {
        fgChain += `,colorchannelmixer=aa=${videoOpacity.toFixed(2)}`;
      }
      if (Math.abs(videoRotDeg) > 0.2) {
        const rad = ((videoRotDeg * Math.PI) / 180).toFixed(4);
        fgChain += `,rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none`;
      }
    }

    const fgOverlayX = needsFgTransform
      ? `${Math.round(centerX)}-w/2`
      : String(Math.round(centerX - fgW / 2));
    const fgOverlayY = needsFgTransform
      ? `${Math.round(centerY)}-h/2`
      : String(Math.round(centerY - fgH / 2));

    const bgAsset =
      canvas.backgroundType === 'image' && canvas.bgImageUrl && bgVisible
        ? getAssetByUrl(canvas.bgImageUrl)
        : null;

    if (canvas.backgroundType === 'blur' && bgVisible) {
      const sigma = Math.max(1, Math.min(60, Math.round(canvas.bgBlurIntensity || 24)));
      const brightVal = Math.max(
        -0.6,
        Math.min(0.6, (canvas.bgBlurBrightness ?? -15) / 100)
      ).toFixed(2);
      const blurOpacity = Math.max(0.1, Math.min(1.0, canvas.bgBlurOpacity ?? 0.9));

      filterSteps.push(`[0:v]split[v_bg_raw][v_fg_raw]`);
      filterSteps.push(
        `[v_bg_raw]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=${sigma},eq=brightness=${brightVal},setsar=1[v_bg_blurred]`
      );

      let bgOut = 'v_bg_blurred';
      if (blurOpacity < 0.99) {
        filterSteps.push(`color=c=#09090B:s=${width}x${height}:r=${fpsVal}:d=${origDur.toFixed(2)}[v_bg_dark]`);
        filterSteps.push(
          `[v_bg_blurred]format=yuva420p,colorchannelmixer=aa=${blurOpacity.toFixed(2)}[v_bg_alpha]`
        );
        filterSteps.push(`[v_bg_dark][v_bg_alpha]overlay=0:0:shortest=1[v_canvas_bg]`);
        bgOut = 'v_canvas_bg';
      }

      if (!videoVisible) {
        filterSteps.push(`[${bgOut}]null[${currentV}]`);
      } else {
        let splitFg = `[v_fg_raw]crop=${cw}:${ch}:${cx}:${cy},scale=${fgW}:${fgH},setsar=1`;
        if (needsFgTransform) {
          splitFg += `,format=rgba`;
          if (videoOpacity < 0.99) splitFg += `,colorchannelmixer=aa=${videoOpacity.toFixed(2)}`;
          if (Math.abs(videoRotDeg) > 0.2) {
            const rad = ((videoRotDeg * Math.PI) / 180).toFixed(4);
            splitFg += `,rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none`;
          }
        }
        filterSteps.push(`${splitFg}[v_fg_scaled]`);
        filterSteps.push(
          `[${bgOut}][v_fg_scaled]overlay=x='${fgOverlayX}':y='${fgOverlayY}':shortest=1,setsar=1[${currentV}]`
        );
      }
    } else if (bgAsset && fs.existsSync(bgAsset.file_path)) {
      const bgIdx = nextInputIdx++;
      extraInputs.push('-loop', '1', '-t', origDur.toFixed(2), '-i', bgAsset.file_path);
      const bgScale = Math.max(0.5, Math.min(2.5, canvas.bgImageScale || 1));
      const targetBgW = Math.max(16, Math.round(width * bgScale) & ~1);
      const targetBgH = Math.max(16, Math.round(height * bgScale) & ~1);
      const bgShiftX = Math.round(((canvas.bgImageOffsetX || 0) / 100) * width);
      const bgShiftY = Math.round(((canvas.bgImageOffsetY || 0) / 100) * height);

      filterSteps.push(`color=c=#09090B:s=${width}x${height}:r=${fpsVal}:d=${origDur.toFixed(2)}[v_bg_dark]`);
      let bgChain = `[${bgIdx}:v]scale=${targetBgW}:${targetBgH}:force_original_aspect_ratio=increase,fps=${fpsVal},setsar=1`;
      if (bgOpacity < 0.99 || Math.abs(bgRotDeg) > 0.2) {
        bgChain += `,format=rgba`;
        if (bgOpacity < 0.99) bgChain += `,colorchannelmixer=aa=${bgOpacity.toFixed(2)}`;
        if (Math.abs(bgRotDeg) > 0.2) {
          const rad = ((bgRotDeg * Math.PI) / 180).toFixed(4);
          bgChain += `,rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none`;
        }
      }
      filterSteps.push(`${bgChain}[v_bg_img]`);
      filterSteps.push(
        `[v_bg_dark][v_bg_img]overlay=x=(W-w)/2+${bgShiftX}:y=(H-h)/2+${bgShiftY}:shortest=1[v_canvas_bg]`
      );

      if (!videoVisible) {
        filterSteps.push(`[v_canvas_bg]null[${currentV}]`);
      } else {
        filterSteps.push(`${fgChain}[v_fg_scaled]`);
        filterSteps.push(
          `[v_canvas_bg][v_fg_scaled]overlay=x='${fgOverlayX}':y='${fgOverlayY}':shortest=1,setsar=1[${currentV}]`
        );
      }
    } else {
      const bgHex = /^#[0-9a-fA-F]{6}$/.test(canvas.bgColor || '') ? canvas.bgColor : '#09090B';
      filterSteps.push(`color=c=${bgHex}:s=${width}x${height}:r=${fpsVal}:d=${origDur.toFixed(2)}[v_canvas_bg]`);
      if (!videoVisible) {
        filterSteps.push(`[v_canvas_bg]null[${currentV}]`);
      } else {
        filterSteps.push(`${fgChain}[v_fg_scaled]`);
        filterSteps.push(
          `[v_canvas_bg][v_fg_scaled]overlay=x='${fgOverlayX}':y='${fgOverlayY}':shortest=1,setsar=1[${currentV}]`
        );
      }
    }
  }

  // Step 1.5: Flexible Timeline Visual Frame Holds
  if (activeSyncPlan && activeSyncPlan.holds.length > 0) {
    const holdSteps = buildVideoFrameHoldFilter({
      inputLabel: currentV,
      outputLabel: 'v_held',
      originalDuration: origDur,
      holds: activeSyncPlan.holds,
    });
    filterSteps.push(...holdSteps);
    currentV = 'v_held';
  }

  // Step 1.8: Video Filters & Visual Effects (applied to video stream)
  if (exportSettings.applyVideoEffects !== false && project.videoEffects) {
    const effectsRes = buildVideoEffectsFilters({
      config: project.videoEffects,
      startLabel: currentV,
      outputLabel: 'v_effects',
      duration: totalDur,
    });
    if (effectsRes.filterSteps.length > 0) {
      filterSteps.push(...effectsRes.filterSteps);
      currentV = effectsRes.currentLabel;
    }
  }

  // Prepare ordered overlays (Blurs, Logos, Captions) respecting canvas.layerOrder
  const renderBlurs = activeSyncPlan
    ? remapBlursForSyncPlan(project.blurs, activeSyncPlan.holds)
    : project.blurs;
  const renderLogos = activeSyncPlan
    ? remapLogosForSyncPlan(project.logos, activeSyncPlan.holds)
    : project.logos;
  const renderCaptions =
    exportSettings.applyDubbing && project.voice.enabled && project.voice.syncPlan
      ? buildSyncedCaptionsForRender(project.captions, project.voice.syncPlan)
      : project.captions;

  const captionsEnabled =
    exportSettings.applyCaptions &&
    project.subtitleStyle.enabled &&
    project.subtitleStyle.visible !== false &&
    renderCaptions.length > 0;

  const blurMap = new Map(renderBlurs.filter((b) => b.enabled).map((b) => [b.id, b]));
  const logoMap = new Map(renderLogos.filter((l) => l.enabled).map((l) => [l.id, l]));

  const defaultOrder: string[] = [
    ...renderBlurs.filter((b) => b.enabled).map((b) => `blur:${b.id}`),
    ...renderLogos.filter((l) => l.enabled).map((l) => `logo:${l.id}`),
    ...(captionsEnabled ? ['captions'] : []),
  ];

  const orderedTokens: string[] = [];
  const seenTokens = new Set<string>();
  for (const tok of canvas.layerOrder || []) {
    if (
      (tok.startsWith('blur:') && blurMap.has(tok.slice(5))) ||
      (tok.startsWith('logo:') && logoMap.has(tok.slice(5))) ||
      (tok === 'captions' && captionsEnabled)
    ) {
      orderedTokens.push(tok);
      seenTokens.add(tok);
    }
  }
  for (const tok of defaultOrder) {
    if (!seenTokens.has(tok)) {
      orderedTokens.push(tok);
      seenTokens.add(tok);
    }
  }

  let layerStep = 0;
  for (const token of orderedTokens) {
    layerStep += 1;
    if (token.startsWith('blur:') && exportSettings.applyBlur) {
      const blur = blurMap.get(token.slice(5));
      if (!blur) continue;
      const blurRes = buildBlurFilters({
        blurs: [blur],
        startLabel: currentV,
        targetWidth: width,
        targetHeight: height,
        nextInputIndex: nextInputIdx,
        labelPrefix: `lb${layerStep}`,
      });
      extraInputs.push(...blurRes.extraInputs);
      filterSteps.push(...blurRes.filterSteps);
      currentV = blurRes.currentLabel;
      nextInputIdx += blurRes.extraInputs.filter((a) => a === '-i').length;
    } else if (token.startsWith('logo:') && exportSettings.applyLogo) {
      const logo = logoMap.get(token.slice(5));
      if (!logo) continue;
      const logoRes = buildLogoOverlayFilters({
        logos: [logo],
        startLabel: currentV,
        targetWidth: width,
        targetHeight: height,
        nextInputIndex: nextInputIdx,
        labelPrefix: `ll${layerStep}`,
      });
      extraInputs.push(...logoRes.extraInputs);
      filterSteps.push(...logoRes.filterSteps);
      currentV = logoRes.currentLabel;
      nextInputIdx = logoRes.nextInputIndex;
    } else if (token === 'captions' && captionsEnabled) {
      const assPath = generateAssFile({
        projectId: project.id,
        captions: renderCaptions,
        style: project.subtitleStyle,
        videoWidth: width,
        videoHeight: height,
      });
      tempFilesToClean.push(assPath);
      const escapedAss = escapeFilterPath(assPath);
      const escapedFonts = fs.existsSync(FONTS_DIR) ? escapeFilterPath(FONTS_DIR) : '';
      const outLabel = `v_sub_${layerStep}`;
      const fontsOpt = escapedFonts ? `:fontsdir='${escapedFonts}'` : '';
      filterSteps.push(`[${currentV}]ass='${escapedAss}'${fontsOpt}[${outLabel}]`);
      currentV = outLabel;
    }
  }

  // Step 5: Audio Mixing & Synchronization
  const audioRes = buildAudioMixFilters({
    hasSourceAudio: project.metadata.hasAudio,
    duration: totalDur,
    originalDuration: origDur,
    holds: activeSyncPlan?.holds,
    voice: project.voice,
    applyDubbing: exportSettings.applyDubbing,
    applyAudioMix: exportSettings.applyAudioMix,
    nextInputIndex: nextInputIdx,
  });
  extraInputs.push(...audioRes.extraInputs);
  filterSteps.push(...audioRes.filterSteps);

  const outFilename = `recap_export_${project.id.slice(0, 8)}_${Date.now()}.mp4`;
  const outputPath = path.join(EXPORTS_DIR, outFilename);

  const ffmpegArgs = [
    '-y',
    '-i',
    videoAsset.file_path,
    ...extraInputs,
    '-filter_complex',
    filterSteps.join(';'),
    '-map',
    `[${currentV}]`,
  ];

  if (audioRes.audioMapLabel) {
    ffmpegArgs.push('-map', audioRes.audioMapLabel, '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2');
  } else {
    ffmpegArgs.push('-an');
  }

  ffmpegArgs.push(
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath
  );

  onProgress(10, 'Encoding video with FFmpeg (H.264 / AAC)', null);

  const startedAt = Date.now();

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', ffmpegArgs);
      let stderrBuf = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('out_time_us=')) {
            const us = Number(line.split('=')[1] || 0);
            const curSec = us / 1_000_000;
            const pct = Math.min(97, Math.max(10, Math.round(10 + (curSec / totalDur) * 87)));
            const elapsedSec = (Date.now() - startedAt) / 1000;
            let eta: number | null = null;
            if (curSec > 0.5 && elapsedSec > 0.5) {
              const rate = curSec / elapsedSec;
              eta = Math.max(1, Math.round((totalDur - curSec) / rate));
            }
            onProgress(pct, 'Rendering video frames', eta);
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 8000) {
          stderrBuf = stderrBuf.slice(-4000);
        }
      });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg render failed (exit ${code}): ${stderrBuf.slice(-600)}`));
        }
      });
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('FFmpeg exited cleanly but no MP4 file was written.');
    }

    const stat = fs.statSync(outputPath);
    if (stat.size < 1024) {
      fs.unlinkSync(outputPath);
      throw new Error(`Exported MP4 file is invalid or empty (${stat.size} bytes).`);
    }

    // Verify rendered stream integrity with ffprobe
    const probed = await analyzeVideoFile(outputPath);
    if (!probed.videoCodec || probed.duration <= 0) {
      fs.unlinkSync(outputPath);
      throw new Error('Rendered MP4 failed stream verification (missing video track or zero duration).');
    }

    const outputUrl = `/media/exports/${outFilename}`;
    registerAsset({
      id: uuidv4(),
      projectId: project.id,
      kind: 'export',
      filename: outFilename,
      filePath: outputPath,
      url: outputUrl,
      mimeType: 'video/mp4',
      sizeBytes: stat.size,
    });

    onProgress(100, 'Export completed', 0);
    return { outputPath, outputUrl, outputSize: stat.size };
  } finally {
    for (const f of tempFilesToClean) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    }
  }
}
