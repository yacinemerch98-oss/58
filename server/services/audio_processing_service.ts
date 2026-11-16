import { VideoExtensionHold, VoiceConfig } from '../../src/types/studio.ts';
import { getAssetByUrl } from '../db.ts';
import { buildAudioHoldFilter } from './timeline_sync_service.ts';

export interface AudioFilterResult {
  extraInputs: string[];
  filterSteps: string[];
  audioMapLabel: string | null;
  nextInputIndex: number;
}

export function buildAudioMixFilters(params: {
  hasSourceAudio: boolean;
  duration: number;
  originalDuration?: number;
  holds?: VideoExtensionHold[];
  voice: VoiceConfig;
  applyDubbing: boolean;
  applyAudioMix: boolean;
  nextInputIndex: number;
}): AudioFilterResult {
  const extraInputs: string[] = [];
  const filterSteps: string[] = [];
  const mixBranches: string[] = [];
  let inputIdx = params.nextInputIndex;

  const useDub =
    params.applyDubbing &&
    params.voice.enabled &&
    params.voice.fullDubUrl &&
    getAssetByUrl(params.voice.fullDubUrl);

  const musicAsset =
    params.applyAudioMix && params.voice.bgMusicUrl
      ? getAssetByUrl(params.voice.bgMusicUrl)
      : null;

  const includeSource =
    params.hasSourceAudio &&
    (!useDub || params.voice.preserveOriginalAudio) &&
    params.voice.originalAudioVolume > 0.01;

  if (includeSource) {
    const vol = useDub ? params.voice.originalAudioVolume : 1.0;
    let chain = `[0:a]volume=${vol.toFixed(2)}`;
    if (params.applyAudioMix && params.voice.fadeInSec > 0) {
      chain += `,afade=t=in:st=0:d=${params.voice.fadeInSec.toFixed(2)}`;
    }
    if (params.applyAudioMix && params.voice.fadeOutSec > 0 && params.duration > params.voice.fadeOutSec) {
      const fadeStart = Math.max(0, params.duration - params.voice.fadeOutSec).toFixed(2);
      chain += `,afade=t=out:st=${fadeStart}:d=${params.voice.fadeOutSec.toFixed(2)}`;
    }

    if (params.holds && params.holds.length > 0) {
      const holdSteps = buildAudioHoldFilter({
        sourceAudioChainPrefix: chain,
        outputLabel: 'a_orig',
        originalDuration: params.originalDuration || params.duration,
        holds: params.holds,
      });
      filterSteps.push(...holdSteps);
    } else {
      filterSteps.push(`${chain}[a_orig]`);
    }
    mixBranches.push('[a_orig]');
  }

  if (useDub) {
    const dubAsset = getAssetByUrl(params.voice.fullDubUrl!)!;
    const dubIdx = inputIdx++;
    extraInputs.push('-i', dubAsset.file_path);

    const offsetSec = Number(params.voice.timingOffsetSec || 0);
    const filters: string[] = [];

    if (offsetSec > 0.02) {
      const delayMs = Math.round(offsetSec * 1000);
      filters.push(`adelay=${delayMs}|${delayMs}`);
    } else if (offsetSec < -0.02) {
      const trimStart = Math.abs(offsetSec).toFixed(2);
      filters.push(`atrim=start=${trimStart},asetpts=PTS-STARTPTS`);
    }

    filters.push(`volume=${Math.max(0.05, params.voice.voiceVolume).toFixed(2)}`);
    if (params.applyAudioMix && params.voice.fadeInSec > 0) {
      filters.push(`afade=t=in:st=0:d=${params.voice.fadeInSec.toFixed(2)}`);
    }
    if (params.applyAudioMix && params.voice.fadeOutSec > 0 && params.duration > params.voice.fadeOutSec) {
      const fadeStart = Math.max(0, params.duration - params.voice.fadeOutSec).toFixed(2);
      filters.push(`afade=t=out:st=${fadeStart}:d=${params.voice.fadeOutSec.toFixed(2)}`);
    }
    filters.push(`apad=whole_dur=${params.duration.toFixed(2)}`);
    filters.push(`atrim=0:${params.duration.toFixed(2)}`);

    const chain = `[${dubIdx}:a]${filters.join(',')}[a_dub]`;
    filterSteps.push(chain);
    mixBranches.push('[a_dub]');
  }

  if (musicAsset) {
    const musicIdx = inputIdx++;
    extraInputs.push('-stream_loop', '-1', '-i', musicAsset.file_path);
    const vol = Math.max(0.02, Math.min(1, params.voice.bgMusicVolume));
    let chain = `[${musicIdx}:a]atrim=0:${params.duration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${vol.toFixed(2)}`;
    if (params.voice.fadeInSec > 0) {
      chain += `,afade=t=in:st=0:d=${params.voice.fadeInSec.toFixed(2)}`;
    }
    if (params.voice.fadeOutSec > 0 && params.duration > params.voice.fadeOutSec) {
      const fadeStart = Math.max(0, params.duration - params.voice.fadeOutSec).toFixed(2);
      chain += `,afade=t=out:st=${fadeStart}:d=${params.voice.fadeOutSec.toFixed(2)}`;
    }
    chain += `[a_bgm]`;
    filterSteps.push(chain);
    mixBranches.push('[a_bgm]');
  }

  if (mixBranches.length === 0) {
    return {
      extraInputs,
      filterSteps,
      audioMapLabel: null,
      nextInputIndex: inputIdx,
    };
  }

  if (mixBranches.length === 1) {
    return {
      extraInputs,
      filterSteps,
      audioMapLabel: mixBranches[0],
      nextInputIndex: inputIdx,
    };
  }

  filterSteps.push(
    `${mixBranches.join('')}amix=inputs=${mixBranches.length}:duration=first:dropout_transition=2:normalize=0[a_final]`
  );

  return {
    extraInputs,
    filterSteps,
    audioMapLabel: '[a_final]',
    nextInputIndex: inputIdx,
  };
}
