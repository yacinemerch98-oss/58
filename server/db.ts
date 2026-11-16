import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_VIDEO_CANVAS,
  DEFAULT_VIDEO_EFFECTS,
  DEFAULT_VOICE_CONFIG,
  Project,
  PresetCategory,
  RenderJob,
  SavedFishVoice,
  SavedFontAsset,
  StudioPreset,
  StudioPresetAssetRef,
} from '../src/types/studio.ts';

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || './storage');
export const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
export const CHUNKS_DIR = path.join(STORAGE_DIR, 'chunks');
export const LOGOS_DIR = path.join(STORAGE_DIR, 'logos');
export const BACKGROUNDS_DIR = path.join(STORAGE_DIR, 'backgrounds');
export const FONTS_DIR = path.join(STORAGE_DIR, 'fonts');
export const AUDIO_DIR = path.join(STORAGE_DIR, 'audio');
export const MASKS_DIR = path.join(STORAGE_DIR, 'masks');
export const EXPORTS_DIR = path.join(STORAGE_DIR, 'exports');
export const THUMBS_DIR = path.join(STORAGE_DIR, 'thumbs');
export const TEMP_DIR = path.join(STORAGE_DIR, 'temp');

for (const dir of [
  STORAGE_DIR,
  UPLOADS_DIR,
  CHUNKS_DIR,
  LOGOS_DIR,
  BACKGROUNDS_DIR,
  FONTS_DIR,
  AUDIO_DIR,
  MASKS_DIR,
  EXPORTS_DIR,
  THUMBS_DIR,
  TEMP_DIR,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const dbPath = path.join(STORAGE_DIR, 'recap_studio.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaSql = fs.readFileSync(path.resolve('./db/schema.sql'), 'utf-8');
db.exec(schemaSql);

// Migrations for columns added after initial schema creation
try {
  db.exec("ALTER TABLE projects ADD COLUMN video_effects_json TEXT NOT NULL DEFAULT '{}'");
} catch {
  // column already present
}
try {
  db.exec("ALTER TABLE projects ADD COLUMN canvas_json TEXT NOT NULL DEFAULT '{}'");
} catch {
  // column already present
}
try {
  db.exec("ALTER TABLE projects ADD COLUMN workflow_json TEXT NOT NULL DEFAULT '{}'");
} catch {
  // column already present
}

interface ProjectRow {
  id: string;
  name: string;
  source_video_url: string | null;
  source_filename: string | null;
  thumbnail_url: string | null;
  metadata_json: string | null;
  waveform_json: string;
  captions_json: string;
  subtitle_style_json: string;
  translation_json: string;
  voice_json: string;
  blurs_json: string;
  logos_json: string;
  video_effects_json?: string;
  canvas_json?: string;
  workflow_json?: string;
  export_settings_json: string;
  last_export_url: string | null;
  last_export_size: number | null;
  last_exported_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  const parsedWorkflow = row.workflow_json ? JSON.parse(row.workflow_json) : undefined;
  return {
    id: row.id,
    name: row.name,
    sourceVideoUrl: row.source_video_url,
    sourceFilename: row.source_filename,
    thumbnailUrl: row.thumbnail_url,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    waveformPeaks: JSON.parse(row.waveform_json || '[]'),
    captions: JSON.parse(row.captions_json || '[]'),
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, ...JSON.parse(row.subtitle_style_json || '{}') },
    translation: JSON.parse(row.translation_json || '{"sourceLanguage":"Auto","targetLanguage":"Spanish","preserveProperNouns":true}'),
    voice: { ...DEFAULT_VOICE_CONFIG, ...JSON.parse(row.voice_json || '{}') },
    blurs: JSON.parse(row.blurs_json || '[]'),
    logos: JSON.parse(row.logos_json || '[]'),
    videoEffects: { ...DEFAULT_VIDEO_EFFECTS, ...JSON.parse(row.video_effects_json || '{}') },
    canvas: { ...DEFAULT_VIDEO_CANVAS, ...JSON.parse(row.canvas_json || '{}') },
    workflow:
      parsedWorkflow && Array.isArray(parsedWorkflow.visitedStages)
        ? parsedWorkflow
        : {
            visitedStages: ['dashboard'],
            completedStages: [],
            needsAttentionStages: [],
          },
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS, ...JSON.parse(row.export_settings_json || '{}') },
    lastExportUrl: row.last_export_url,
    lastExportSize: row.last_export_size,
    lastExportedAt: row.last_exported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function createProject(id: string, name: string): Project {
  const now = new Date().toISOString();
  const translation = {
    sourceLanguage: 'Auto',
    targetLanguage: 'Spanish',
    preserveProperNouns: true,
  };
  const savedVoices = getSavedFishVoices();
  const defaultVoice = savedVoices.find((v) => v.isDefault);
  const initialVoice = defaultVoice
    ? {
        ...DEFAULT_VOICE_CONFIG,
        fishReferenceId: defaultVoice.voiceId,
        fishVoiceTitle: defaultVoice.name,
      }
    : DEFAULT_VOICE_CONFIG;
  const initialWorkflow = {
    visitedStages: ['dashboard'],
    completedStages: [],
    needsAttentionStages: [],
  };

  db.prepare(`
    INSERT INTO projects (
      id, name, subtitle_style_json, translation_json, voice_json, video_effects_json, canvas_json, workflow_json, export_settings_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    JSON.stringify(DEFAULT_SUBTITLE_STYLE),
    JSON.stringify(translation),
    JSON.stringify(initialVoice),
    JSON.stringify(DEFAULT_VIDEO_EFFECTS),
    JSON.stringify(DEFAULT_VIDEO_CANVAS),
    JSON.stringify(initialWorkflow),
    JSON.stringify(DEFAULT_EXPORT_SETTINGS),
    now,
    now
  );
  return getProject(id)!;
}

export function updateProject(id: string, patch: Partial<Project>): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  const merged: Project = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(`
    UPDATE projects SET
      name = ?,
      source_video_url = ?,
      source_filename = ?,
      thumbnail_url = ?,
      metadata_json = ?,
      waveform_json = ?,
      captions_json = ?,
      subtitle_style_json = ?,
      translation_json = ?,
      voice_json = ?,
      blurs_json = ?,
      logos_json = ?,
      video_effects_json = ?,
      canvas_json = ?,
      workflow_json = ?,
      export_settings_json = ?,
      last_export_url = ?,
      last_export_size = ?,
      last_exported_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    merged.name,
    merged.sourceVideoUrl,
    merged.sourceFilename,
    merged.thumbnailUrl,
    merged.metadata ? JSON.stringify(merged.metadata) : null,
    JSON.stringify(merged.waveformPeaks || []),
    JSON.stringify(merged.captions || []),
    JSON.stringify(merged.subtitleStyle),
    JSON.stringify(merged.translation),
    JSON.stringify(merged.voice),
    JSON.stringify(merged.blurs || []),
    JSON.stringify(merged.logos || []),
    JSON.stringify(merged.videoEffects || DEFAULT_VIDEO_EFFECTS),
    JSON.stringify(merged.canvas || DEFAULT_VIDEO_CANVAS),
    JSON.stringify(
      merged.workflow || {
        visitedStages: ['dashboard'],
        completedStages: [],
        needsAttentionStages: [],
      }
    ),
    JSON.stringify(merged.exportSettings),
    merged.lastExportUrl,
    merged.lastExportSize,
    merged.lastExportedAt,
    merged.updatedAt,
    id
  );
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return info.changes > 0;
}

interface JobRow {
  id: string;
  project_id: string;
  type: RenderJob['type'];
  status: RenderJob['status'];
  progress: number;
  stage: string;
  eta_seconds: number | null;
  output_url: string | null;
  output_size: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): RenderJob {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    etaSeconds: row.eta_seconds,
    outputUrl: row.output_url,
    outputSize: row.output_size,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(job: Omit<RenderJob, 'createdAt' | 'updatedAt'>): RenderJob {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, project_id, type, status, progress, stage, eta_seconds, output_url, output_size, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.projectId,
    job.type,
    job.status,
    job.progress,
    job.stage,
    job.etaSeconds,
    job.outputUrl,
    job.outputSize,
    job.error,
    now,
    now
  );
  return getJob(job.id)!;
}

export function getJob(id: string): RenderJob | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function listProjectJobs(projectId: string): RenderJob[] {
  const rows = db.prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 30').all(projectId) as JobRow[];
  return rows.map(rowToJob);
}

export function listAllJobs(): RenderJob[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50').all() as JobRow[];
  return rows.map(rowToJob);
}

export function updateJob(id: string, patch: Partial<RenderJob>): RenderJob | null {
  const existing = getJob(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  db.prepare(`
    UPDATE jobs SET status = ?, progress = ?, stage = ?, eta_seconds = ?, output_url = ?, output_size = ?, error = ?, updated_at = ?
    WHERE id = ?
  `).run(
    merged.status,
    merged.progress,
    merged.stage,
    merged.etaSeconds,
    merged.outputUrl,
    merged.outputSize,
    merged.error,
    merged.updatedAt,
    id
  );
  return getJob(id);
}

export function registerAsset(asset: {
  id: string;
  projectId: string | null;
  kind: string;
  filename: string;
  filePath: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}) {
  db.prepare(`
    INSERT OR REPLACE INTO assets (id, project_id, kind, filename, file_path, url, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    asset.id,
    asset.projectId,
    asset.kind,
    asset.filename,
    asset.filePath,
    asset.url,
    asset.mimeType,
    asset.sizeBytes,
    new Date().toISOString()
  );
}

export function getAssetByUrl(url: string): { file_path: string; filename: string; mime_type: string } | null {
  const row = db.prepare('SELECT file_path, filename, mime_type FROM assets WHERE url = ?').get(url) as
    | { file_path: string; filename: string; mime_type: string }
    | undefined;
  return row ?? null;
}

export function getAppSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setAppSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

const SAVED_VOICES_KEY = 'saved_fish_voices';

export function getSavedFishVoices(): SavedFishVoice[] {
  try {
    const raw = getAppSetting(SAVED_VOICES_KEY, '[]');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedFishVoice[]) : [];
  } catch {
    return [];
  }
}

export function saveSavedFishVoices(voices: SavedFishVoice[]) {
  setAppSetting(SAVED_VOICES_KEY, JSON.stringify(voices));
}

export function checkAssetAvailableByUrl(url: string): boolean {
  if (!url) return false;
  const asset = getAssetByUrl(url);
  if (asset && fs.existsSync(asset.file_path)) {
    return true;
  }
  const fontRow = db.prepare('SELECT file_path FROM custom_fonts WHERE url = ?').get(url) as
    | { file_path: string }
    | undefined;
  if (fontRow && fs.existsSync(fontRow.file_path)) {
    return true;
  }
  return false;
}

interface PresetRow {
  id: string;
  category: PresetCategory;
  name: string;
  description: string;
  is_default: number;
  thumbnail_json: string;
  payload_json: string;
  asset_refs_json: string;
  created_at: string;
  updated_at: string;
}

function rowToPreset(row: PresetRow): StudioPreset {
  const assetRefs: StudioPresetAssetRef[] = JSON.parse(row.asset_refs_json || '[]');
  const missingAssets = assetRefs.filter((ref) => !checkAssetAvailableByUrl(ref.url));
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description || undefined,
    isDefault: Boolean(row.is_default),
    thumbnailStyle: JSON.parse(row.thumbnail_json || '{}'),
    payload: JSON.parse(row.payload_json || '{}'),
    assetRefs,
    missingAssets,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPresets(category?: PresetCategory): StudioPreset[] {
  const rows = category
    ? (db
        .prepare('SELECT * FROM presets WHERE category = ? ORDER BY is_default DESC, updated_at DESC')
        .all(category) as PresetRow[])
    : (db
        .prepare('SELECT * FROM presets ORDER BY category ASC, is_default DESC, updated_at DESC')
        .all() as PresetRow[]);
  return rows.map(rowToPreset);
}

export function getPreset(id: string): StudioPreset | null {
  const row = db.prepare('SELECT * FROM presets WHERE id = ?').get(id) as PresetRow | undefined;
  return row ? rowToPreset(row) : null;
}

export function createPreset(preset: {
  id: string;
  category: PresetCategory;
  name: string;
  description?: string;
  isDefault?: boolean;
  thumbnailStyle?: StudioPreset['thumbnailStyle'];
  payload: Record<string, unknown>;
  assetRefs?: StudioPresetAssetRef[];
}): StudioPreset {
  const now = new Date().toISOString();
  if (preset.isDefault) {
    db.prepare('UPDATE presets SET is_default = 0 WHERE category = ?').run(preset.category);
  }
  db.prepare(`
    INSERT INTO presets (id, category, name, description, is_default, thumbnail_json, payload_json, asset_refs_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    preset.id,
    preset.category,
    preset.name.trim(),
    preset.description || '',
    preset.isDefault ? 1 : 0,
    JSON.stringify(preset.thumbnailStyle || {}),
    JSON.stringify(preset.payload || {}),
    JSON.stringify(preset.assetRefs || []),
    now,
    now
  );
  return getPreset(preset.id)!;
}

export function updatePreset(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    isDefault: boolean;
    thumbnailStyle: StudioPreset['thumbnailStyle'];
    payload: Record<string, unknown>;
    assetRefs: StudioPresetAssetRef[];
  }>
): StudioPreset | null {
  const existing = getPreset(id);
  if (!existing) return null;
  if (patch.isDefault) {
    db.prepare('UPDATE presets SET is_default = 0 WHERE category = ?').run(existing.category);
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE presets SET
      name = ?,
      description = ?,
      is_default = ?,
      thumbnail_json = ?,
      payload_json = ?,
      asset_refs_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.name !== undefined ? patch.name.trim() : existing.name,
    patch.description !== undefined ? patch.description : existing.description || '',
    patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : existing.isDefault ? 1 : 0,
    JSON.stringify(patch.thumbnailStyle ?? existing.thumbnailStyle ?? {}),
    JSON.stringify(patch.payload ?? existing.payload ?? {}),
    JSON.stringify(patch.assetRefs ?? existing.assetRefs ?? []),
    now,
    id
  );
  return getPreset(id);
}

export function deletePreset(id: string): boolean {
  const info = db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  return info.changes > 0;
}

export function listCustomFonts(): SavedFontAsset[] {
  const rows = db
    .prepare('SELECT id, family, filename, url, created_at FROM custom_fonts ORDER BY created_at DESC')
    .all() as Array<{
    id: string;
    family: string;
    filename: string;
    url: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    family: r.family,
    filename: r.filename,
    url: r.url,
    createdAt: r.created_at,
  }));
}

export function registerCustomFont(font: {
  id: string;
  family: string;
  filename: string;
  filePath: string;
  url: string;
}): SavedFontAsset {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO custom_fonts (id, family, filename, file_path, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(font.id, font.family, font.filename, font.filePath, font.url, now);
  return {
    id: font.id,
    family: font.family,
    filename: font.filename,
    url: font.url,
    createdAt: now,
  };
}

export function deleteCustomFont(id: string): boolean {
  const row = db.prepare('SELECT file_path FROM custom_fonts WHERE id = ?').get(id) as
    | { file_path: string }
    | undefined;
  if (row && fs.existsSync(row.file_path)) {
    try {
      fs.unlinkSync(row.file_path);
    } catch {
      // ignore fs error
    }
  }
  const info = db.prepare('DELETE FROM custom_fonts WHERE id = ?').run(id);
  return info.changes > 0;
}
