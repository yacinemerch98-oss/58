import fs from 'fs';
import path from 'path';
import { CaptionSegment, SubtitleStyle, WordTiming } from '../../src/types/studio.ts';
import { TEMP_DIR } from '../db.ts';

function formatSrtTime(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatVttTime(sec: number): string {
  return formatSrtTime(sec).replace(',', '.');
}

function formatAssTime(sec: number): string {
  const totalCs = Math.max(0, Math.round(sec * 100));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function hexToAssColor(hex: string, alpha = 1): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2) || 'FF';
  const g = clean.slice(2, 4) || 'FF';
  const b = clean.slice(4, 6) || 'FF';
  // ASS alpha is inverted: 00 = opaque, FF = transparent
  const aByte = Math.max(0, Math.min(255, Math.round((1 - alpha) * 255)))
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
  return `&H${aByte}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

function hexToBgrTag(hex: string): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2) || 'FF';
  const g = clean.slice(2, 4) || 'FF';
  const b = clean.slice(4, 6) || 'FF';
  return `&H${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}&`;
}

function getSegmentText(seg: CaptionSegment, style: SubtitleStyle): string {
  const raw =
    (style.useTranslated && seg.translatedText
      ? seg.translatedText
      : seg.text || seg.translatedText) || '';
  return style.uppercase ? raw.toUpperCase() : raw;
}

export function resolveSegmentWordsForAss(seg: CaptionSegment, useTranslated: boolean): WordTiming[] {
  const rawSegText =
    (useTranslated && seg.translatedText ? seg.translatedText : seg.text || seg.translatedText) || '';
  const rawNormalized = rawSegText.trim().replace(/\s+/g, ' ');
  const existingJoined = (seg.words || []).map((w) => w.word).join(' ').trim();

  if (seg.words && seg.words.length > 0 && (!rawNormalized || existingJoined === rawNormalized)) {
    // Normalize contiguous boundaries so word-by-word never drops frames inside a segment
    return seg.words.map((w, idx) => {
      const next = seg.words![idx + 1];
      const start = idx === 0 ? Math.min(seg.start, w.start) : w.start;
      const end = next ? Math.max(w.end, next.start) : Math.max(seg.end, w.end);
      return {
        word: w.word,
        start,
        end: Math.max(start + 0.05, end),
      };
    });
  }

  const tokens = rawNormalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const safeStart = Math.max(0, seg.start);
  const safeEnd = Math.max(safeStart + 0.15, seg.end);
  const totalDur = safeEnd - safeStart;
  // Weight timing gently by word character count for natural speech cadence
  const weights = tokens.map((t) => Math.max(2, t.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').length));
  const weightSum = weights.reduce((a, b) => a + b, 0) || tokens.length;

  let cursor = safeStart;
  return tokens.map((word, idx) => {
    const share = (weights[idx] / weightSum) * totalDur;
    const start = cursor;
    const end = idx === tokens.length - 1 ? safeEnd : start + share;
    cursor = end;
    return {
      word,
      start: Number(start.toFixed(3)),
      end: Number(Math.max(start + 0.05, end).toFixed(3)),
    };
  });
}

export function generateSrtContent(captions: CaptionSegment[], style: SubtitleStyle): string {
  return captions
    .map((seg, idx) => {
      const text = getSegmentText(seg, style);
      return `${idx + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${text}`;
    })
    .join('\n\n');
}

export function generateVttContent(captions: CaptionSegment[], style: SubtitleStyle): string {
  const body = captions
    .map((seg) => {
      const text = getSegmentText(seg, style);
      return `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}

export function parseSrtOrVtt(content: string): CaptionSegment[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const segments: CaptionSegment[] = [];

  const timeRegex = /(?:(\d{2}):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[,.](\d{3})/;

  let curStart = 0;
  let curEnd = 0;
  let curTextLines: string[] = [];
  let inSegment = false;

  const pushCurrent = () => {
    if (inSegment && curEnd > curStart && curTextLines.length > 0) {
      const cleanText = curTextLines.join(' ').replace(/<[^>]+>/g, '').trim();
      if (cleanText) {
        segments.push({
          id: `cap_${Date.now()}_${segments.length}`,
          start: Number(curStart.toFixed(2)),
          end: Number(curEnd.toFixed(2)),
          text: cleanText,
        });
      }
    }
    curTextLines = [];
    inSegment = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
      if (!line) pushCurrent();
      continue;
    }

    const match = line.match(timeRegex);
    if (match) {
      pushCurrent();
      const h1 = Number(match[1] || 0);
      const m1 = Number(match[2] || 0);
      const s1 = Number(match[3] || 0);
      const ms1 = Number(match[4] || 0);
      curStart = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;

      const h2 = Number(match[5] || 0);
      const m2 = Number(match[6] || 0);
      const s2 = Number(match[7] || 0);
      const ms2 = Number(match[8] || 0);
      curEnd = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000;
      inSegment = true;
    } else if (inSegment && !/^\d+$/.test(line)) {
      curTextLines.push(line);
    }
  }
  pushCurrent();

  return segments;
}

export function normalizeDisplayMode(mode: SubtitleStyle['mode']): 'word-by-word' | 'karaoke' | 'phrase-chunk' | 'sentence' {
  if (mode === 'word' || mode === 'word-by-word') return 'word-by-word';
  if (mode === 'karaoke') return 'karaoke';
  if (mode === 'phrase-chunk') return 'phrase-chunk';
  return 'sentence';
}

export function generateAssFile(params: {
  projectId: string;
  captions: CaptionSegment[];
  style: SubtitleStyle;
  videoWidth: number;
  videoHeight: number;
}): string {
  const { style, videoWidth, videoHeight, captions } = params;

  // Determine base alignment
  let alignBase = 2; // Bottom Center
  if (style.position === 'top') alignBase = 8;
  else if (style.position === 'middle') alignBase = 5;

  if (style.textAlign === 'left') {
    alignBase = alignBase === 8 ? 7 : alignBase === 5 ? 4 : 1;
  } else if (style.textAlign === 'right') {
    alignBase = alignBase === 8 ? 9 : alignBase === 5 ? 6 : 3;
  }

  const globalOpacity = Math.max(0.05, Math.min(1, style.opacity ?? 1));
  const scaleFactor = Math.max(0.5, Math.min(2.5, style.scale ?? 1));

  const primaryCol = hexToAssColor(style.primaryColor, globalOpacity);
  const secondaryCol = hexToAssColor(style.highlightColor, globalOpacity);
  const outlineCol = hexToAssColor(style.outlineColor, globalOpacity);
  const backAlpha = (style.backgroundOpacity ?? 0.55) * globalOpacity;
  const backCol = hexToAssColor(style.backgroundColor, backAlpha);
  const borderStyle = (style.backgroundOpacity ?? 0) > 0.05 ? 3 : 1;
  const shadow = style.shadowEnabled ? Math.max(1, Math.round(style.shadowBlur || 2)) : 0;
  const fontSize = Math.max(14, Math.round(((style.fontSize * scaleFactor) / 720) * videoHeight));
  const marginV = Math.max(12, Math.round((style.marginV / 720) * videoHeight));
  const isBold = style.fontWeight === 'bold' || style.fontWeight === '900' ? -1 : 0;
  const isItalic = style.italic ? -1 : 0;
  const isUnderline = style.underline ? -1 : 0;
  const spacing = Math.round((style.letterSpacing || 0) * (videoHeight / 720));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily || 'DejaVu Sans'},${fontSize},${primaryCol},${secondaryCol},${outlineCol},${backCol},${isBold},${isItalic},${isUnderline},0,100,100,${spacing},0,${borderStyle},${style.outlineWidth},${shadow},${alignBase},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events: string[] = [];

  let animPrefix = '';
  if (style.animationPreset === 'fade') {
    animPrefix = '{\\fad(120,120)}';
  } else if (style.animationPreset === 'pop' || style.animationPreset === 'bounce' || style.animationPreset === 'word-popup') {
    animPrefix = '{\\t(0,85,\\fscx114\\fscy114)\\t(85,170,\\fscx100\\fscy100)}';
  } else if (style.animationPreset === 'scale') {
    animPrefix = '{\\fscx82\\fscy82\\t(0,130,\\fscx100\\fscy100)}';
  } else if (style.animationPreset === 'slide-up') {
    animPrefix = '{\\fad(80,60)}';
  }

  const rotDeg = style.rotation || 0;
  const rotTag = Math.abs(rotDeg) > 0.2 ? `{\\frz${(-rotDeg).toFixed(1)}}` : '';

  const hasCustomPos =
    style.position === 'custom' ||
    (style.posX !== 50 && style.posX !== undefined) ||
    (style.posY !== undefined && style.position !== 'bottom' && style.position !== 'middle' && style.position !== 'top');
  let posTag = '';
  if (hasCustomPos) {
    const px = Math.round(((style.posX ?? 50) / 100) * videoWidth);
    const py = Math.round(((style.posY ?? 84) / 100) * videoHeight);
    posTag = `{\\pos(${px},${py})\\an5}`;
  }

  const displayMode = normalizeDisplayMode(style.mode);
  const hlTag = hexToBgrTag(style.highlightColor || '#FACC15');
  const gradTag = style.gradientEnabled && style.gradientColor ? hexToBgrTag(style.gradientColor) : hlTag;
  const chunkSize = style.chunkSize === 2 ? 2 : 3;

  for (const seg of captions) {
    const segText = getSegmentText(seg, style).replace(/\n/g, '\\N');
    const startStr = formatAssTime(seg.start);
    const endStr = formatAssTime(seg.end);
    const activeWords = resolveSegmentWordsForAss(seg, Boolean(style.useTranslated));

    if (displayMode === 'word-by-word') {
      if (activeWords.length > 0) {
        for (let i = 0; i < activeWords.length; i++) {
          const w = activeWords[i];
          const wText = style.uppercase ? w.word.toUpperCase() : w.word;
          const wStartStr = formatAssTime(w.start);
          const wEndStr = formatAssTime(w.end);
          const wordCol =
            style.gradientEnabled || style.animationPreset === 'gradient-emphasis'
              ? i % 2 === 1
                ? gradTag
                : hlTag
              : hlTag;
          const wordTag =
            style.highlightBoxEnabled || style.animationPreset === 'box-highlight'
              ? `{\\1c${wordCol}\\3c${hexToBgrTag(style.highlightBoxColor || '#7C3AED')}\\bord${Math.max(4, style.outlineWidth + 2)}}`
              : `{\\1c${wordCol}}`;
          const popTag =
            style.animationPreset === 'none'
              ? ''
              : animPrefix || '{\\t(0,70,\\fscx115\\fscy115)\\t(70,140,\\fscx100\\fscy100)}';
          events.push(
            `Dialogue: 0,${wStartStr},${wEndStr},Default,,0,0,0,,${posTag}${rotTag}${popTag}${wordTag}${wText}`
          );
        }
      } else {
        events.push(
          `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${posTag}${rotTag}${animPrefix}${segText}`
        );
      }
    } else if (displayMode === 'karaoke') {
      if (activeWords.length > 0) {
        for (let i = 0; i < activeWords.length; i++) {
          const w = activeWords[i];
          const wStartStr = formatAssTime(w.start);
          const wEndStr = formatAssTime(w.end);
          const line = activeWords
            .map((item, relIdx) => {
              const label = style.uppercase ? item.word.toUpperCase() : item.word;
              if (relIdx === i) {
                const col = style.gradientEnabled && relIdx % 2 === 1 ? gradTag : hlTag;
                return `{\\1c${col}\\fscx114\\fscy114}${label}{\\r}`;
              }
              if (relIdx < i) {
                return `{\\1c${hlTag}}${label}{\\r}`;
              }
              return label;
            })
            .join(' ');
          events.push(
            `Dialogue: 0,${wStartStr},${wEndStr},Default,,0,0,0,,${posTag}${rotTag}${line}`
          );
        }
      } else {
        events.push(
          `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${posTag}${rotTag}${animPrefix}${segText}`
        );
      }
    } else if (displayMode === 'phrase-chunk') {
      if (activeWords.length > 0) {
        for (let i = 0; i < activeWords.length; i++) {
          const w = activeWords[i];
          const wStartStr = formatAssTime(w.start);
          const wEndStr = formatAssTime(w.end);
          const chunkStart = Math.floor(i / chunkSize) * chunkSize;
          const chunkEnd = Math.min(activeWords.length, chunkStart + chunkSize);
          const line = activeWords
            .slice(chunkStart, chunkEnd)
            .map((item, relIdx) => {
              const label = style.uppercase ? item.word.toUpperCase() : item.word;
              const absIdx = chunkStart + relIdx;
              if (absIdx === i) {
                const col = style.gradientEnabled && absIdx % 2 === 1 ? gradTag : hlTag;
                return `{\\1c${col}\\fscx114\\fscy114}${label}{\\r}`;
              }
              return label;
            })
            .join(' ');
          events.push(
            `Dialogue: 0,${wStartStr},${wEndStr},Default,,0,0,0,,${posTag}${rotTag}${animPrefix}${line}`
          );
        }
      } else {
        events.push(
          `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${posTag}${rotTag}${animPrefix}${segText}`
        );
      }
    } else {
      // Full Sentence Mode (including optional typewriter progressive reveal)
      if (style.animationPreset === 'typewriter' && activeWords.length > 1) {
        for (let i = 0; i < activeWords.length; i++) {
          const w = activeWords[i];
          const wStartStr = formatAssTime(w.start);
          const wEndStr = formatAssTime(w.end);
          const revealed = activeWords
            .slice(0, i + 1)
            .map((item) => (style.uppercase ? item.word.toUpperCase() : item.word))
            .join(' ');
          events.push(
            `Dialogue: 0,${wStartStr},${wEndStr},Default,,0,0,0,,${posTag}${rotTag}${revealed}`
          );
        }
      } else {
        events.push(
          `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${posTag}${rotTag}${animPrefix}${segText}`
        );
      }
    }
  }

  const assPath = path.join(TEMP_DIR, `subs_${params.projectId.slice(0, 8)}_${Date.now()}.ass`);
  fs.writeFileSync(assPath, `${header}\n${events.join('\n')}\n`, 'utf-8');
  return assPath;
}
