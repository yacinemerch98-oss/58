import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { v4 as uuidv4 } from 'uuid';
import {
  AUDIO_DIR,
  BACKGROUNDS_DIR,
  EXPORTS_DIR,
  FONTS_DIR,
  LOGOS_DIR,
  MASKS_DIR,
  STORAGE_DIR,
  THUMBS_DIR,
  UPLOADS_DIR,
  checkAssetAvailableByUrl,
  createPreset,
  createProject,
  deleteCustomFont,
  deletePreset,
  deleteProject,
  getAssetByUrl,
  getJob,
  getPreset,
  getProject,
  getSavedFishVoices,
  listAllJobs,
  listCustomFonts,
  listPresets,
  listProjectJobs,
  listProjects,
  registerCustomFont,
  saveSavedFishVoices,
  updatePreset,
  updateProject,
} from './server/db.ts';
import { isGeminiConfigured } from './server/services/gemini_client.ts';
import {
  analyzeVideoFile,
  checkFfmpegCapabilities,
  createDemoMovieRecapClip,
  extractWaveformPeaks,
  generateVideoThumbnail,
} from './server/services/video_analysis_service.ts';
import {
  finalizeChunkedUpload,
  getMaxUploadBytes,
  initChunkedUpload,
  saveCanvasBackgroundFile,
  saveFontFile,
  saveLogoFile,
  saveMusicFile,
  saveSegmentationMaskImage,
  saveUploadChunk,
} from './server/services/video_upload_service.ts';
import {
  extractAudioTrack,
  transcribeVideoWithGemini,
} from './server/services/transcription_service.ts';
import { translateCaptionsWithGemini } from './server/services/translation_service.ts';
import {
  generateSingleVoicePreview,
  generateSynchronizedVoiceover,
} from './server/services/voice_generation_service.ts';
import {
  generateSrtContent,
  generateVttContent,
  parseSrtOrVtt,
} from './server/services/subtitle_service.ts';
import {
  cleanupTempStorage,
  enqueueRenderJob,
} from './server/services/export_service.ts';
import {
  enqueueFishDubJob,
  generateDubDiagnosticReport,
  generateFishSynchronizedDub,
  generateFishVoicePreview,
  inspectFullDubTrackDiagnostics,
  isFishAudioConfigured,
  listFishVoices,
  regenerateFishSegments,
  resyncExistingFishClips,
  transcribeVideoWithFishAudio,
} from './server/services/fish_audio_service.ts';
import {
  clampContinuousPauseMs,
  normalizeSyncMode,
} from './server/services/timeline_sync_service.ts';
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_VIDEO_CANVAS,
  DEFAULT_VIDEO_EFFECTS,
  GeminiVoiceName,
  PresetCategory,
  Project,
  StudioPreset,
  StudioPresetAssetRef,
  SupportedLanguage,
  SyncMode,
} from './src/types/studio.ts';

const PORT = 3000;
const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '30mb' }));

const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Media streaming route with HTTP Range & HEAD support for video seeking and download disposition
app.get('/media/:bucket/:filename', (req, res) => {
  const { bucket, filename } = req.params;
  const safeName = path.basename(filename);
  const bucketMap: Record<string, string> = {
    uploads: UPLOADS_DIR,
    logos: LOGOS_DIR,
    backgrounds: BACKGROUNDS_DIR,
    fonts: FONTS_DIR,
    audio: AUDIO_DIR,
    masks: MASKS_DIR,
    exports: EXPORTS_DIR,
    thumbs: THUMBS_DIR,
  };
  const baseDir = bucketMap[bucket];
  if (!baseDir) {
    res.status(404).json({ error: 'Invalid media bucket' });
    return;
  }

  const filePath = path.join(baseDir, safeName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found' });
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.size <= 0) {
    res.status(404).json({ error: 'Media file is empty or incomplete' });
    return;
  }

  const ext = path.extname(safeName).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  if (bucket === 'exports') {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    res.end();
    return;
  }

  const range = req.headers.range;
  if (range && (ext === '.mp4' || ext === '.mov' || ext === '.mkv' || ext === '.wav' || ext === '.mp3')) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parts[0] ? parseInt(parts[0], 10) : 0;
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const end = Math.min(stat.size - 1, isNaN(rawEnd) ? stat.size - 1 : rawEnd);

    if (isNaN(start) || start < 0 || start >= stat.size || end < start) {
      res.writeHead(416, {
        'Content-Range': `bytes */${stat.size}`,
      });
      res.end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(filePath).pipe(res);
});

// System Diagnostics & Configuration Status
app.get('/api/system/status', async (_req, res) => {
  const caps = await checkFfmpegCapabilities();
  res.json({
    geminiConfigured: isGeminiConfigured(),
    fishConfigured: isFishAudioConfigured(),
    ffmpegAvailable: caps.ffmpegAvailable,
    ffprobeAvailable: caps.ffprobeAvailable,
    ffmpegVersion: caps.ffmpegVersion,
    storageDir: STORAGE_DIR,
    maxUploadSizeMb: Math.round(getMaxUploadBytes() / (1024 * 1024)),
    tempRetentionHours: Number(process.env.TEMP_RETENTION_HOURS || '24'),
    supportedVideoFormats: ['MP4', 'MOV', 'MKV'],
    supportedLogoFormats: ['PNG', 'SVG'],
  });
});

// Fish Audio Voice Library & Authorized Cloned Voices
app.get('/api/fish/voices', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const selfOnly = req.query.self === 'true';
    const language = typeof req.query.language === 'string' ? req.query.language : undefined;
    const result = await listFishVoices({ query, selfOnly, language });
    res.json(result);
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Saved Custom Fish Audio Voices CRUD (persisted globally in SQLite app_settings)
app.get('/api/fish/saved-voices', (_req, res) => {
  res.json({ voices: getSavedFishVoices() });
});

app.post('/api/fish/saved-voices', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const voiceId = String(req.body?.voiceId || '').trim();
  const setDefault = Boolean(req.body?.isDefault);

  if (!name) {
    res.status(400).json({ error: 'Voice display name is required.' });
    return;
  }
  if (!voiceId) {
    res.status(400).json({ error: 'Fish Audio Voice ID is required.' });
    return;
  }

  const now = new Date().toISOString();
  const existing = getSavedFishVoices();
  const newVoice = {
    id: uuidv4(),
    name,
    voiceId,
    isDefault: setDefault || existing.length === 0,
    createdAt: now,
    updatedAt: now,
  };

  const next = existing
    .map((v) => (newVoice.isDefault ? { ...v, isDefault: false } : v))
    .concat(newVoice);

  saveSavedFishVoices(next);
  res.status(201).json({ voice: newVoice, voices: next });
});

app.patch('/api/fish/saved-voices/:id', (req, res) => {
  const existing = getSavedFishVoices();
  const found = existing.find((v) => v.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Saved voice not found.' });
    return;
  }

  const name =
    req.body?.name !== undefined ? String(req.body.name).trim() : found.name;
  const voiceId =
    req.body?.voiceId !== undefined ? String(req.body.voiceId).trim() : found.voiceId;
  const isDefault =
    req.body?.isDefault !== undefined ? Boolean(req.body.isDefault) : found.isDefault;

  if (!name || !voiceId) {
    res.status(400).json({ error: 'Both voice name and voice ID are required.' });
    return;
  }

  const now = new Date().toISOString();
  const next = existing.map((v) => {
    if (v.id === req.params.id) {
      return { ...v, name, voiceId, isDefault, updatedAt: now };
    }
    return isDefault ? { ...v, isDefault: false } : v;
  });

  saveSavedFishVoices(next);
  const updated = next.find((v) => v.id === req.params.id)!;
  res.json({ voice: updated, voices: next });
});

app.delete('/api/fish/saved-voices/:id', (req, res) => {
  const existing = getSavedFishVoices();
  const next = existing.filter((v) => v.id !== req.params.id);
  if (next.length === existing.length) {
    res.status(404).json({ error: 'Saved voice not found.' });
    return;
  }
  if (next.length > 0 && !next.some((v) => v.isDefault)) {
    next[0] = { ...next[0], isDefault: true };
  }
  saveSavedFishVoices(next);
  res.json({ deleted: true, voices: next });
});

app.post('/api/system/cleanup', (_req, res) => {
  const hours = Number(process.env.TEMP_RETENTION_HOURS || '24');
  const result = cleanupTempStorage(hours);
  res.json(result);
});

// Custom Fonts Library CRUD
app.get('/api/fonts', (_req, res) => {
  res.json({ fonts: listCustomFonts() });
});

app.post('/api/fonts', uploadMem.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No font file uploaded.' });
      return;
    }
    const customFamily = typeof req.body?.family === 'string' ? req.body.family : undefined;
    const saved = saveFontFile(req.file.originalname, req.file.buffer, customFamily);
    const font = registerCustomFont({
      id: uuidv4(),
      family: saved.family,
      filename: saved.filename,
      filePath: saved.filePath,
      url: saved.url,
    });
    res.status(201).json({ font, fonts: listCustomFonts() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/fonts/:id', (req, res) => {
  const deleted = deleteCustomFont(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Custom font not found.' });
    return;
  }
  res.json({ deleted: true, fonts: listCustomFonts() });
});

// Unified Persistent Preset Library CRUD + Import/Export
app.get('/api/presets', (req, res) => {
  const cat = req.query.category as PresetCategory | undefined;
  const presets = listPresets(cat && ['caption', 'filter', 'editing'].includes(cat) ? cat : undefined);
  res.json({ presets });
});

app.get('/api/presets/export', (_req, res) => {
  const presets = listPresets();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="recap_studio_presets.json"');
  res.send(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), presets }, null, 2));
});

app.post('/api/presets/import', (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.presets)
      ? req.body.presets
      : Array.isArray(req.body)
      ? req.body
      : [];
    if (incoming.length === 0) {
      res.status(400).json({ error: 'Provide a valid presets array in the JSON payload.' });
      return;
    }
    const imported: StudioPreset[] = [];
    for (const raw of incoming) {
      if (!raw || !raw.name || !['caption', 'filter', 'editing'].includes(raw.category)) {
        continue;
      }
      const created = createPreset({
        id: uuidv4(),
        category: raw.category as PresetCategory,
        name: String(raw.name),
        description: typeof raw.description === 'string' ? raw.description : '',
        isDefault: Boolean(raw.isDefault),
        thumbnailStyle: raw.thumbnailStyle && typeof raw.thumbnailStyle === 'object' ? raw.thumbnailStyle : {},
        payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
        assetRefs: Array.isArray(raw.assetRefs) ? raw.assetRefs : [],
      });
      imported.push(created);
    }
    res.status(201).json({ importedCount: imported.length, imported, presets: listPresets() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/presets', (req, res) => {
  try {
    const category = req.body?.category as PresetCategory;
    const name = String(req.body?.name || '').trim();
    if (!['caption', 'filter', 'editing'].includes(category)) {
      res.status(400).json({ error: 'Valid preset category required (caption | filter | editing).' });
      return;
    }
    if (!name) {
      res.status(400).json({ error: 'Preset name is required.' });
      return;
    }
    const preset = createPreset({
      id: uuidv4(),
      category,
      name,
      description: typeof req.body?.description === 'string' ? req.body.description : '',
      isDefault: Boolean(req.body?.isDefault),
      thumbnailStyle: req.body?.thumbnailStyle || {},
      payload: req.body?.payload || {},
      assetRefs: Array.isArray(req.body?.assetRefs) ? req.body.assetRefs : [],
    });
    res.status(201).json({ preset, presets: listPresets() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch('/api/presets/:id', (req, res) => {
  const updated = updatePreset(req.params.id, {
    name: req.body?.name,
    description: req.body?.description,
    isDefault: req.body?.isDefault,
    thumbnailStyle: req.body?.thumbnailStyle,
    payload: req.body?.payload,
    assetRefs: req.body?.assetRefs,
  });
  if (!updated) {
    res.status(404).json({ error: 'Preset not found.' });
    return;
  }
  res.json({ preset: updated, presets: listPresets() });
});

app.delete('/api/presets/:id', (req, res) => {
  const ok = deletePreset(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Preset not found.' });
    return;
  }
  res.json({ deleted: true, presets: listPresets() });
});

function applyPresetIdsToProject(
  project: Project,
  opts: {
    captionPresetId?: string | null;
    filterPresetId?: string | null;
    editingPresetId?: string | null;
    applyDefaults?: boolean;
    preserveCaptionEnabledState?: boolean;
  }
): { patch: Partial<Project>; warnings: Array<{ presetName: string; missingAssets: StudioPresetAssetRef[] }> } {
  const allPresets = listPresets();
  const resolvePreset = (cat: PresetCategory, explicitId?: string | null): StudioPreset | undefined => {
    if (explicitId === 'none') return undefined;
    if (explicitId) return getPreset(explicitId) || undefined;
    if (opts.applyDefaults) {
      return allPresets.find((p) => p.category === cat && p.isDefault);
    }
    return undefined;
  };

  const capPreset = resolvePreset('caption', opts.captionPresetId);
  const filPreset = resolvePreset('filter', opts.filterPresetId);
  const edtPreset = resolvePreset('editing', opts.editingPresetId);

  const patch: Partial<Project> = {};
  const warnings: Array<{ presetName: string; missingAssets: StudioPresetAssetRef[] }> = [];

  if (capPreset) {
    const pStyle = (capPreset.payload?.subtitleStyle || capPreset.payload || {}) as Record<string, unknown>;
    const missingFont = (capPreset.missingAssets || []).filter((a) => a.kind === 'font');
    if (missingFont.length > 0) {
      warnings.push({ presetName: capPreset.name, missingAssets: missingFont });
    }
    const nextFontUrl =
      typeof pStyle.customFontUrl === 'string' && !checkAssetAvailableByUrl(pStyle.customFontUrl)
        ? undefined
        : (pStyle.customFontUrl as string | undefined);
    patch.subtitleStyle = {
      ...DEFAULT_SUBTITLE_STYLE,
      ...project.subtitleStyle,
      ...(pStyle as Partial<Project['subtitleStyle']>),
      customFontUrl: nextFontUrl,
      // Strict rule: never auto-enable captions when applying preset to a brand new video with 0 segments
      enabled: opts.preserveCaptionEnabledState
        ? Boolean(project.subtitleStyle.enabled)
        : Boolean(project.captions.length > 0 && (pStyle.enabled ?? project.subtitleStyle.enabled)),
    };
  }

  if (filPreset) {
    const pFx = (filPreset.payload?.videoEffects || filPreset.payload || {}) as Partial<Project['videoEffects']>;
    patch.videoEffects = {
      ...DEFAULT_VIDEO_EFFECTS,
      ...project.videoEffects,
      ...pFx,
    };
  }

  if (edtPreset) {
    const pEdt = edtPreset.payload as {
      canvas?: Partial<Project['canvas']>;
      exportSettings?: Partial<Project['exportSettings']>;
      logos?: Project['logos'];
    };
    const missing = edtPreset.missingAssets || [];
    if (missing.length > 0) {
      warnings.push({ presetName: edtPreset.name, missingAssets: missing });
    }
    if (pEdt.canvas) {
      const nextCanvas = {
        ...DEFAULT_VIDEO_CANVAS,
        ...(project.canvas || {}),
        ...pEdt.canvas,
      };
      if (nextCanvas.bgImageUrl && !checkAssetAvailableByUrl(nextCanvas.bgImageUrl)) {
        nextCanvas.bgImageUrl = undefined;
      }
      patch.canvas = nextCanvas;
    }
    if (pEdt.exportSettings) {
      patch.exportSettings = {
        ...project.exportSettings,
        ...pEdt.exportSettings,
      };
    }
    if (Array.isArray(pEdt.logos)) {
      const validLogos = pEdt.logos
        .filter((l) => l && l.url && checkAssetAvailableByUrl(l.url))
        .map((l) => ({ ...l, id: uuidv4() }));
      if (validLogos.length > 0) {
        patch.logos = [...project.logos, ...validLogos];
      }
    }
  }

  return { patch, warnings };
}

// Projects CRUD
app.get('/api/projects', (_req, res) => {
  res.json({ projects: listProjects() });
});

app.post('/api/projects', (req, res) => {
  const name = String(req.body?.name || '').trim() || `Recap Project ${new Date().toLocaleDateString()}`;
  const created = createProject(uuidv4(), name);
  const { patch, warnings } = applyPresetIdsToProject(created, {
    captionPresetId: req.body?.captionPresetId,
    filterPresetId: req.body?.filterPresetId,
    editingPresetId: req.body?.editingPresetId,
    applyDefaults: Boolean(req.body?.applyDefaults),
    preserveCaptionEnabledState: false,
  });
  const finalProject = Object.keys(patch).length > 0 ? updateProject(created.id, patch)! : created;
  res.status(201).json({ project: finalProject, presetWarnings: warnings });
});

app.post('/api/projects/:id/apply-presets', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const { patch, warnings } = applyPresetIdsToProject(project, {
    captionPresetId: req.body?.captionPresetId,
    filterPresetId: req.body?.filterPresetId,
    editingPresetId: req.body?.editingPresetId,
    applyDefaults: false,
    preserveCaptionEnabledState: true,
  });
  const updated = Object.keys(patch).length > 0 ? updateProject(project.id, patch)! : project;
  res.json({ project: updated, presetWarnings: warnings });
});

app.get('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ project });
});

app.patch('/api/projects/:id', (req, res) => {
  const updated = updateProject(req.params.id, req.body || {});
  if (!updated) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ project: updated });
});

app.delete('/api/projects/:id', (req, res) => {
  const ok = deleteProject(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ deleted: true });
});

// Generate a real FFmpeg-synthesized sample movie recap video for immediate pipeline testing
app.post('/api/projects/:id/sample-video', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const clip = await createDemoMovieRecapClip(project.id);
    const metadata = await analyzeVideoFile(clip.filePath);
    const thumbnailUrl = await generateVideoThumbnail(clip.filePath, project.id, 2);
    const waveformPeaks = await extractWaveformPeaks(clip.filePath, metadata.hasAudio);

    const updated = updateProject(project.id, {
      sourceVideoUrl: clip.url,
      sourceFilename: clip.filename,
      thumbnailUrl,
      metadata,
      waveformPeaks,
    });
    if (!updated) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Chunked Video Upload Flow
app.post('/api/uploads/init', (req, res) => {
  try {
    const { projectId, filename, totalSize, totalChunks } = req.body || {};
    if (!projectId || !filename || !totalSize || !totalChunks) {
      res.status(400).json({ error: 'Missing required chunk initialization parameters.' });
      return;
    }
    const project = getProject(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const session = initChunkedUpload({
      projectId,
      filename,
      totalSize: Number(totalSize),
      totalChunks: Number(totalChunks),
    });

    res.json({ uploadId: session.uploadId, totalChunks: session.totalChunks });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/uploads/:uploadId/chunk', (req, res) => {
  try {
    const chunkIndex = Number(req.query.index);
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Expected binary application/octet-stream chunk payload.' });
      return;
    }
    const progress = saveUploadChunk(req.params.uploadId, chunkIndex, req.body);
    res.json(progress);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/uploads/:uploadId/complete', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '');
    const uploaded = await finalizeChunkedUpload(req.params.uploadId);
    const metadata = await analyzeVideoFile(uploaded.filePath);
    const thumbnailUrl = await generateVideoThumbnail(
      uploaded.filePath,
      projectId,
      Math.min(2, Math.max(0.2, metadata.duration * 0.15))
    );
    const waveformPeaks = await extractWaveformPeaks(uploaded.filePath, metadata.hasAudio);

    const existingProj = getProject(projectId);

    const updated = updateProject(projectId, {
      sourceVideoUrl: uploaded.url,
      sourceFilename: uploaded.filename,
      thumbnailUrl,
      metadata,
      waveformPeaks,
      exportSettings: existingProj
        ? { ...existingProj.exportSettings, aspectRatio: existingProj.exportSettings.aspectRatio || 'original' }
        : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project: updated, metadata });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Logo PNG/SVG Upload
app.post('/api/projects/:id/logo', uploadMem.single('file'), (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No logo file uploaded' });
      return;
    }
    const saved = saveLogoFile(project.id, req.file.originalname, req.file.buffer);
    const newLogo = {
      id: uuidv4(),
      filename: saved.filename,
      url: saved.url,
      enabled: true,
      x: 0.78,
      y: 0.05,
      widthPct: 16,
      opacity: 0.9,
      permanent: true,
      startTime: 0,
      endTime: project.metadata?.duration || 30,
      presetPosition: 'top-right' as const,
      motion: {
        enabled: false,
        pattern: 'static' as const,
        speed: 1.0,
        endX: 0.78,
        endY: 0.8,
      },
    };
    const updated = updateProject(project.id, {
      logos: [...project.logos, newLogo],
    });
    res.json({ project: updated, logo: newLogo });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Canvas Background Image Upload (PNG/JPG/JPEG/WEBP)
app.post('/api/projects/:id/canvas-bg', uploadMem.single('file'), (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No background image file uploaded' });
      return;
    }
    const saved = saveCanvasBackgroundFile(
      project.id,
      req.file.originalname,
      req.file.buffer
    );
    const updated = updateProject(project.id, {
      canvas: {
        ...(project.canvas || {
          aspectRatio: 'original',
          customWidth: 1080,
          customHeight: 1920,
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
          cropLeft: 0,
          bgColor: '#09090B',
          bgImageScale: 1,
          bgImageOffsetX: 0,
          bgImageOffsetY: 0,
          bgBlurIntensity: 24,
          bgBlurBrightness: -15,
          bgBlurOpacity: 0.9,
        }),
        backgroundType: 'image',
        bgImageUrl: saved.url,
        bgImageFilename: saved.filename,
      },
    });
    res.json({ project: updated, url: saved.url, filename: saved.filename });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Background Music Upload
app.post('/api/projects/:id/music', uploadMem.single('file'), (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No audio file uploaded' });
      return;
    }
    const saved = saveMusicFile(project.id, req.file.originalname, req.file.buffer);
    const updated = updateProject(project.id, {
      voice: {
        ...project.voice,
        bgMusicFilename: saved.filename,
        bgMusicUrl: saved.url,
      },
    });
    res.json({ project: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Background Segmentation Mask PNG Upload
app.post('/api/projects/:id/mask', (req, res) => {
  try {
    const { blurId, maskBase64 } = req.body || {};
    if (!blurId || !maskBase64) {
      res.status(400).json({ error: 'blurId and maskBase64 are required' });
      return;
    }
    const saved = saveSegmentationMaskImage(req.params.id, blurId, maskBase64);
    res.json({ maskUrl: saved.url, assetId: saved.assetId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Audio Extraction
app.post('/api/projects/:id/audio/extract', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project || !project.sourceVideoUrl) {
      res.status(404).json({ error: 'Project video not found' });
      return;
    }
    if (!project.metadata?.hasAudio) {
      res.status(400).json({ error: 'Source video has no audio track' });
      return;
    }
    const asset = getAssetByUrl(project.sourceVideoUrl);
    if (!asset) {
      res.status(404).json({ error: 'Video asset missing on disk' });
      return;
    }
    const extractedPath = await extractAudioTrack(asset.file_path, project.id, 'wav');
    const filename = path.basename(extractedPath);
    res.json({
      audioUrl: `/media/audio/${filename}`,
      downloadUrl: `/media/audio/${filename}?download=1`,
      filename,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// AI Transcription (supports Fish Audio ASR or Gemini ASR)
app.post('/api/projects/:id/transcribe', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project || !project.sourceVideoUrl || !project.metadata) {
      res.status(404).json({ error: 'Upload a video before running AI transcription.' });
      return;
    }
    const asset = getAssetByUrl(project.sourceVideoUrl);
    if (!asset) {
      res.status(404).json({ error: 'Source video file not found.' });
      return;
    }

    const requestedProvider = req.body?.provider as 'fish' | 'gemini' | undefined;
    const useFish = requestedProvider === 'fish' || (!requestedProvider && isFishAudioConfigured());
    const sourceLanguage =
      typeof req.body?.sourceLanguage === 'string'
        ? req.body.sourceLanguage
        : project.translation.sourceLanguage;

    const result = useFish
      ? await transcribeVideoWithFishAudio({
          videoPath: asset.file_path,
          projectId: project.id,
          duration: project.metadata.duration,
          hasAudio: project.metadata.hasAudio,
          sourceLanguage,
        })
      : await transcribeVideoWithGemini({
          videoPath: asset.file_path,
          projectId: project.id,
          duration: project.metadata.duration,
          hasAudio: project.metadata.hasAudio,
        });

    const updated = updateProject(project.id, {
      captions: result.segments,
      translation: {
        ...project.translation,
        sourceLanguage: result.detectedLanguage,
      },
    });

    res.json({
      project: updated,
      detectedLanguage: result.detectedLanguage,
      segmentCount: result.segments.length,
    });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Dedicated Fish Audio ASR Transcription Route
app.post('/api/projects/:id/dubbing/transcribe', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project || !project.sourceVideoUrl || !project.metadata) {
      res.status(404).json({ error: 'Upload a video before running Fish Audio transcription.' });
      return;
    }
    const asset = getAssetByUrl(project.sourceVideoUrl);
    if (!asset) {
      res.status(404).json({ error: 'Source video file not found.' });
      return;
    }

    const sourceLanguage =
      typeof req.body?.sourceLanguage === 'string'
        ? req.body.sourceLanguage
        : project.translation.sourceLanguage;

    const result = await transcribeVideoWithFishAudio({
      videoPath: asset.file_path,
      projectId: project.id,
      duration: project.metadata.duration,
      hasAudio: project.metadata.hasAudio,
      sourceLanguage,
    });

    const updated = updateProject(project.id, {
      captions: result.segments,
      translation: {
        ...project.translation,
        sourceLanguage: result.detectedLanguage,
      },
    });

    res.json({
      project: updated,
      detectedLanguage: result.detectedLanguage,
      segmentCount: result.segments.length,
    });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Dedicated Fish Audio Voice Preview Route (s2.1-pro-free -> MP3)
app.post('/api/projects/:id/dubbing/preview', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const text = String(req.body?.text || '').trim();
    if (!text) {
      res.status(400).json({ error: 'Preview text is required' });
      return;
    }
    const referenceId =
      typeof req.body?.referenceId === 'string'
        ? req.body.referenceId
        : project.voice.fishReferenceId;
    const preview = await generateFishVoicePreview({
      projectId: project.id,
      text,
      referenceId,
      speakingSpeed: 1.0,
    });

    res.json({ audioUrl: preview.audioUrl });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Dedicated Fish Audio Full Synchronized Dubbing Route (Background Job: s2.1-pro-free -> segmented MP3s -> merged MP3)
app.post('/api/projects/:id/dubbing/generate', (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project || !project.metadata) {
      res.status(404).json({ error: 'Project video not found' });
      return;
    }

    const voiceConfig = {
      ...project.voice,
      ...(req.body?.voice || {}),
      provider: 'fish' as const,
      syncMode: normalizeSyncMode(req.body?.voice?.syncMode ?? project.voice.syncMode),
      continuousPauseMs: clampContinuousPauseMs(
        req.body?.voice?.continuousPauseMs ?? project.voice.continuousPauseMs
      ),
      speakingSpeed: 1.0,
      enabled: true,
    };

    const captions = Array.isArray(req.body?.captions) ? req.body.captions : project.captions;
    const useTranslated =
      req.body?.useTranslated !== undefined
        ? Boolean(req.body.useTranslated)
        : true;

    updateProject(project.id, {
      captions,
      voice: voiceConfig,
    });

    const job = enqueueFishDubJob({
      projectId: project.id,
      voiceConfig,
      captions,
      useTranslated,
    });

    res.status(202).json({ job });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Re-synchronize existing 1.0x MP3 clips under Continuous, Smart Gap Removal (Flexible), or Original duration mode
app.post('/api/projects/:id/dubbing/resync', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project || !project.metadata) {
      res.status(404).json({ error: 'Project video not found.' });
      return;
    }

    const syncMode: SyncMode = normalizeSyncMode(req.body?.syncMode ?? project.voice.syncMode);
    const continuousPauseMs = clampContinuousPauseMs(
      req.body?.continuousPauseMs ?? project.voice.continuousPauseMs
    );

    if (project.voice.generatedClips && project.voice.generatedClips.length > 0) {
      const resynced = await resyncExistingFishClips({
        projectId: project.id,
        captions: project.captions,
        voiceConfig: project.voice,
        originalDuration: project.metadata.duration,
        syncMode,
        continuousPauseMs,
      });

      const updated = updateProject(project.id, {
        voice: {
          ...project.voice,
          syncMode,
          continuousPauseMs,
          speakingSpeed: 1.0,
          generatedClips: resynced.clips,
          fullDubUrl: resynced.fullDubUrl,
          syncPlan: resynced.syncPlan,
        },
      });
      res.json({ project: updated });
      return;
    }

    const updated = updateProject(project.id, {
      voice: {
        ...project.voice,
        syncMode,
        continuousPauseMs,
        syncPlan: project.voice.syncPlan
          ? { ...project.voice.syncPlan, syncMode, pauseDurationMs: continuousPauseMs }
          : undefined,
      },
    });
    res.json({ project: updated });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Dubbing Diagnostic Report Route
app.get('/api/projects/:id/dubbing/diagnostic', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const report = generateDubDiagnosticReport(project);
    const fullTrackAudit = await inspectFullDubTrackDiagnostics(project).catch(() => null);
    res.json({ report, fullTrackAudit });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Selective Fish Audio Regeneration (Only regenerates specified corrected segment IDs, preserving passing clips & 1.0x speed)
app.post('/api/projects/:id/dubbing/regenerate-segments', async (req, res) => {
  try {
    const segmentIds = Array.isArray(req.body?.segmentIds) ? req.body.segmentIds : [];
    const result = await regenerateFishSegments({
      projectId: req.params.id,
      segmentIds,
      captions: Array.isArray(req.body?.captions) ? req.body.captions : undefined,
      voiceConfig: req.body?.voice,
      useTranslated:
        req.body?.useTranslated !== undefined ? Boolean(req.body.useTranslated) : undefined,
    });
    res.json(result);
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// AI Language Translation
app.post('/api/projects/:id/translate', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const targetLanguage = (req.body?.targetLanguage || project.translation.targetLanguage) as SupportedLanguage;
    const preserveProperNouns =
      req.body?.preserveProperNouns !== undefined
        ? Boolean(req.body.preserveProperNouns)
        : project.translation.preserveProperNouns;

    const translatedSegments = await translateCaptionsWithGemini({
      captions: project.captions,
      sourceLanguage: project.translation.sourceLanguage || 'Auto',
      targetLanguage,
      preserveProperNouns,
    });

    const updated = updateProject(project.id, {
      captions: translatedSegments,
      translation: {
        ...project.translation,
        targetLanguage,
        preserveProperNouns,
        lastTranslatedAt: new Date().toISOString(),
      },
      subtitleStyle: {
        ...project.subtitleStyle,
        useTranslated: true,
      },
    });

    res.json({ project: updated });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// SRT / VTT Subtitle Export
app.get('/api/projects/:id/subtitles/:format', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const format = req.params.format.toLowerCase();
  if (format === 'srt') {
    const srt = generateSrtContent(project.captions, project.subtitleStyle);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/\s+/g, '_')}.srt"`);
    res.send(srt);
    return;
  }
  if (format === 'vtt') {
    const vtt = generateVttContent(project.captions, project.subtitleStyle);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/\s+/g, '_')}.vtt"`);
    res.send(vtt);
    return;
  }
  res.status(400).json({ error: 'Supported formats: srt, vtt' });
});

// Import SRT / VTT Subtitle File
app.post('/api/projects/:id/captions/import', (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const rawContent = String(req.body?.content || '').trim();
    if (!rawContent) {
      res.status(400).json({ error: 'No subtitle content provided in request body' });
      return;
    }
    const parsed = parseSrtOrVtt(rawContent);
    if (parsed.length === 0) {
      res.status(400).json({ error: 'Could not parse any valid subtitle segments from file' });
      return;
    }
    const updated = updateProject(project.id, { captions: parsed });
    res.json({ project: updated, count: parsed.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// AI Voice Preview
app.post('/api/projects/:id/voice/preview', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const text = String(req.body?.text || '').trim();
    if (!text) {
      res.status(400).json({ error: 'Preview text is required' });
      return;
    }

    const preview = await generateSingleVoicePreview({
      projectId: project.id,
      text,
      voiceName: (req.body?.voiceName || project.voice.voiceName) as GeminiVoiceName,
      style: String(req.body?.style || project.voice.style),
      targetLanguage: (req.body?.targetLanguage || project.voice.targetLanguage) as SupportedLanguage,
      speakingSpeed: 1.0,
    });

    res.json({ audioUrl: preview.audioUrl });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// AI Voice Full Synchronized Dubbing
app.post('/api/projects/:id/voice/generate', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project || !project.metadata) {
      res.status(404).json({ error: 'Project video not found' });
      return;
    }

    const voiceConfig = {
      ...project.voice,
      ...(req.body?.voice || {}),
      enabled: true,
    };

    const useTranslated =
      req.body?.useTranslated !== undefined
        ? Boolean(req.body.useTranslated)
        : project.subtitleStyle.useTranslated;

    const generated = await generateSynchronizedVoiceover({
      projectId: project.id,
      captions: project.captions,
      voiceConfig,
      useTranslated,
      totalDuration: project.metadata.duration,
    });

    const updated = updateProject(project.id, {
      voice: {
        ...voiceConfig,
        generatedClips: generated.clips,
        fullDubUrl: generated.fullDubUrl,
      },
    });

    res.json({ project: updated, fullDubUrl: generated.fullDubUrl });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// One-Click Video Audio Language Change (Auto-Transcribe -> Translate -> Synchronized AI Dubbing)
app.post('/api/projects/:id/voice/auto-dub', async (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project || !project.sourceVideoUrl || !project.metadata) {
      res.status(404).json({ error: 'Upload a video before dubbing its audio.' });
      return;
    }

    const asset = getAssetByUrl(project.sourceVideoUrl);
    if (!asset) {
      res.status(404).json({ error: 'Source video file not found.' });
      return;
    }

    const voiceConfig = {
      ...project.voice,
      ...(req.body?.voice || {}),
      syncMode: normalizeSyncMode(req.body?.voice?.syncMode ?? project.voice.syncMode),
      continuousPauseMs: clampContinuousPauseMs(
        req.body?.voice?.continuousPauseMs ?? project.voice.continuousPauseMs
      ),
      speakingSpeed: 1.0,
      enabled: true,
    };
    const useFish = voiceConfig.provider === 'fish' || isFishAudioConfigured();
    const targetLanguage = voiceConfig.targetLanguage as SupportedLanguage;
    const preserveProperNouns =
      req.body?.preserveProperNouns !== undefined
        ? Boolean(req.body.preserveProperNouns)
        : project.translation.preserveProperNouns;

    let captions = project.captions;
    let sourceLanguage = project.translation.sourceLanguage || 'Auto';

    // Step 1: Transcribe original video audio if captions do not yet exist
    if (!captions || captions.length === 0) {
      const transcribed = useFish
        ? await transcribeVideoWithFishAudio({
            videoPath: asset.file_path,
            projectId: project.id,
            duration: project.metadata.duration,
            hasAudio: project.metadata.hasAudio,
            sourceLanguage,
          })
        : await transcribeVideoWithGemini({
            videoPath: asset.file_path,
            projectId: project.id,
            duration: project.metadata.duration,
            hasAudio: project.metadata.hasAudio,
          });
      captions = transcribed.segments;
      sourceLanguage = transcribed.detectedLanguage;
    }

    // Step 2: Translate segments into target language
    const translatedCaptions = await translateCaptionsWithGemini({
      captions,
      sourceLanguage,
      targetLanguage,
      preserveProperNouns,
    });

    // Step 3: Generate synchronized TTS voiceover in target language
    const generated = useFish
      ? await generateFishSynchronizedDub({
          projectId: project.id,
          captions: translatedCaptions,
          voiceConfig,
          useTranslated: true,
          totalDuration: project.metadata.duration,
        })
      : await generateSynchronizedVoiceover({
          projectId: project.id,
          captions: translatedCaptions,
          voiceConfig,
          useTranslated: true,
          totalDuration: project.metadata.duration,
        });

    const generatedSyncPlan = 'syncPlan' in generated ? generated.syncPlan : undefined;

    const updated = updateProject(project.id, {
      captions: translatedCaptions,
      translation: {
        sourceLanguage,
        targetLanguage,
        preserveProperNouns,
        lastTranslatedAt: new Date().toISOString(),
      },
      subtitleStyle: {
        ...project.subtitleStyle,
        useTranslated: true,
      },
      voice: {
        ...voiceConfig,
        generatedClips: generated.clips,
        fullDubUrl: generated.fullDubUrl,
        ...(generatedSyncPlan ? { syncPlan: generatedSyncPlan } : {}),
      },
    });

    res.json({
      project: updated,
      sourceLanguage,
      targetLanguage,
      fullDubUrl: generated.fullDubUrl,
    });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Professional 5-Option Thumbnail Generation from Real Video Frames
app.post('/api/projects/:id/thumbnails/generate', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project || !project.sourceVideoUrl) {
    res.status(404).json({ error: 'Project or source video not found.' });
    return;
  }
  try {
    const asset = getAssetByUrl(project.sourceVideoUrl);
    if (!asset || !fs.existsSync(asset.file_path)) {
      res.status(404).json({ error: 'Source video file not found on disk.' });
      return;
    }
    const duration = project.metadata?.duration || 10;
    const timestamps = [
      Math.max(0.5, duration * 0.1),
      Math.max(1.0, duration * 0.3),
      Math.max(1.5, duration * 0.5),
      Math.max(2.0, duration * 0.7),
      Math.max(2.5, duration * 0.9),
    ];
    const urls: string[] = [];
    for (const t of timestamps) {
      const thumbUrl = await generateVideoThumbnail(asset.file_path, project.id, t);
      urls.push(thumbUrl);
    }
    res.json({
      thumbnails: urls,
      suggestedTitle: project.name || 'Movie Recap Highlights',
      suggestedSubtitle: project.captions[0]?.text || 'Full Story Explained',
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Background Render / Export Jobs
app.post('/api/projects/:id/export', (req, res) => {
  try {
    if (req.body?.exportSettings) {
      updateProject(req.params.id, { exportSettings: req.body.exportSettings });
    }
    const job = enqueueRenderJob(req.params.id);
    res.status(202).json({ job });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/projects/:id/jobs', (req, res) => {
  res.json({ jobs: listProjectJobs(req.params.id) });
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ job });
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: listAllJobs() });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('./dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Schedule periodic temp file cleanup every 6 hours
  setInterval(() => {
    cleanupTempStorage(Number(process.env.TEMP_RETENTION_HOURS || '24'));
  }, 6 * 3600 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Recap Studio AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
