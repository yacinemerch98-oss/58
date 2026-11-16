import { ColorAdjustments, ColorFilterPreset, VideoEffectsConfig, VisualEffectItem } from '../../src/types/studio.ts';

export function buildVideoEffectsFilters(params: {
  config: VideoEffectsConfig;
  startLabel: string;
  outputLabel: string;
  duration?: number;
}): { filterSteps: string[]; currentLabel: string } {
  const { config, startLabel, outputLabel } = params;
  const filterSteps: string[] = [];
  let cur = startLabel;

  // If no adjustments, default filter preset, and no effects, just pass through or rename
  const hasAdjustments = Object.values(config.adjustments || {}).some((v) => v !== 0);
  const hasPreset = config.filterPreset && config.filterPreset !== 'none';
  const activeEffects = (config.effects || []).filter((e) => e.enabled);

  if (!hasAdjustments && !hasPreset && activeEffects.length === 0) {
    return { filterSteps: [], currentLabel: startLabel };
  }

  let stepIdx = 0;
  const nextLabel = (prefix: string) => `fx_${prefix}_${stepIdx++}`;

  // 1. Color Filter Presets
  if (hasPreset) {
    const presetLabel = nextLabel('preset');
    const filterStr = getFilterPresetString(config.filterPreset);
    if (filterStr) {
      filterSteps.push(`[${cur}]${filterStr}[${presetLabel}]`);
      cur = presetLabel;
    }
  }

  // 2. Color Adjustments (Brightness, Contrast, Saturation, Temperature, Tint, Sharpness, Vignette)
  const adj = config.adjustments;
  if (adj) {
    const eqFilters: string[] = [];

    // Brightness (-100..100) -> -0.4 .. 0.4
    // Exposure (-100..100) adds to brightness
    const totalBrightness = Math.max(-0.8, Math.min(0.8, (adj.brightness + adj.exposure * 0.7) / 250));
    if (totalBrightness !== 0) {
      eqFilters.push(`brightness=${totalBrightness.toFixed(3)}`);
    }

    // Contrast (-100..100) -> 0.4 .. 1.8 (default 1.0)
    const totalContrast = Math.max(0.2, Math.min(2.2, 1.0 + adj.contrast / 100));
    if (totalContrast !== 1.0) {
      eqFilters.push(`contrast=${totalContrast.toFixed(3)}`);
    }

    // Saturation (-100..100) -> 0.0 .. 2.5 (default 1.0)
    // Fade lifts shadows / reduces saturation
    let totalSat = Math.max(0.0, Math.min(3.0, 1.0 + adj.saturation / 100));
    if (adj.fade > 0) {
      totalSat *= Math.max(0.4, 1.0 - (adj.fade / 100) * 0.4);
    }
    if (totalSat !== 1.0) {
      eqFilters.push(`saturation=${totalSat.toFixed(3)}`);
    }

    if (eqFilters.length > 0) {
      const eqLabel = nextLabel('eq');
      filterSteps.push(`[${cur}]eq=${eqFilters.join(':')}[${eqLabel}]`);
      cur = eqLabel;
    }

    // Color Temperature & Tint via colorbalance
    // temp > 0: warm (red/yellow up, blue down), temp < 0: cool (blue up, red down)
    // tint > 0: magenta (green down, red/blue up), tint < 0: green (green up)
    const tempNorm = adj.temperature / 100; // -1..1
    const tintNorm = adj.tint / 100; // -1..1
    if (tempNorm !== 0 || tintNorm !== 0) {
      const rm = (tempNorm * 0.25 + tintNorm * 0.1).toFixed(3);
      const gm = (-tintNorm * 0.2).toFixed(3);
      const bm = (-tempNorm * 0.25 + tintNorm * 0.1).toFixed(3);
      const cbLabel = nextLabel('temp');
      filterSteps.push(`[${cur}]colorbalance=rm=${rm}:gm=${gm}:bm=${bm}[${cbLabel}]`);
      cur = cbLabel;
    }

    // Sharpness (0..100)
    if (adj.sharpness > 0) {
      const sharpAmt = Math.min(2.5, (adj.sharpness / 100) * 2.0).toFixed(2);
      const sharpLabel = nextLabel('sharp');
      filterSteps.push(`[${cur}]unsharp=5:5:${sharpAmt}:5:5:0.0[${sharpLabel}]`);
      cur = sharpLabel;
    }

    // Vignette (0..100)
    if (adj.vignette > 0) {
      const vigAngle = (0.2 + (adj.vignette / 100) * 0.6).toFixed(2);
      const vigLabel = nextLabel('vig');
      filterSteps.push(`[${cur}]vignette=PI*${vigAngle}[${vigLabel}]`);
      cur = vigLabel;
    }
  }

  // 3. Visual Effects
  for (const fx of activeEffects) {
    const fxSteps = getVisualEffectFilter(fx, cur, nextLabel);
    if (fxSteps) {
      filterSteps.push(...fxSteps.steps);
      cur = fxSteps.lastLabel;
    }
  }

  // Rename last label to requested outputLabel if different
  if (cur !== outputLabel) {
    filterSteps.push(`[${cur}]null[${outputLabel}]`);
    cur = outputLabel;
  }

  return { filterSteps, currentLabel: cur };
}

function getFilterPresetString(preset: ColorFilterPreset): string | null {
  switch (preset) {
    case 'cinematic':
      // Teal and orange grade with rich cinematic shadows
      return 'colorbalance=rs=-0.08:gs=0.03:bs=0.12:rm=0.14:gm=0.04:bm=-0.08:rh=0.08:gh=0.02:bh=-0.06,eq=contrast=1.18:saturation=1.12,vignette=PI/4';
    case 'vintage':
      // Sepia tone, lifted blacks, warm mids
      return 'colorbalance=rm=0.18:gm=0.08:bm=-0.16,eq=contrast=0.92:brightness=0.04:saturation=0.75,vignette=PI/3.5';
    case 'film':
      // Film stock look with subtle curves
      return 'colorbalance=rm=0.06:gm=0.02:bm=-0.04:rs=-0.04:gs=-0.02:bs=0.06,eq=contrast=1.12:saturation=1.05';
    case 'warm':
      // Sunset golden warmth
      return 'colorbalance=rm=0.22:gm=0.06:bm=-0.18:rh=0.15:gh=0.04:bh=-0.12,eq=contrast=1.06';
    case 'cool':
      // Nordic icy blue tones
      return 'colorbalance=rm=-0.16:gm=-0.02:bm=0.22:rs=-0.08:gs=0.0:bs=0.14,eq=contrast=1.08';
    case 'black-white':
      // High-contrast noir black & white
      return 'hue=s=0,eq=contrast=1.28:brightness=-0.02';
    case 'high-contrast':
      // Punchy dynamic contrast
      return 'eq=contrast=1.35:brightness=-0.03:saturation=1.15';
    case 'moody':
      // Dark atmospheric thriller palette
      return 'colorbalance=rm=-0.06:gm=0.0:bm=0.12:rs=-0.12:gs=-0.04:bs=0.06,eq=contrast=1.22:brightness=-0.08:saturation=0.82';
    case 'faded':
      // Indie film matte faded shadows
      return 'eq=contrast=0.86:brightness=0.06:saturation=0.82';
    case 'vibrant':
      // Saturated pop social media look
      return 'eq=contrast=1.14:brightness=0.01:saturation=1.45';
    case 'natural':
      // Clean documentary enhancement
      return 'eq=contrast=1.05:saturation=1.12';
    default:
      return null;
  }
}

function getVisualEffectFilter(
  fx: VisualEffectItem,
  inputLabel: string,
  nextLabel: (prefix: string) => string
): { steps: string[]; lastLabel: string } | null {
  const intensityNorm = Math.max(0.1, fx.intensity / 100);
  const steps: string[] = [];

  switch (fx.type) {
    case 'film-grain': {
      // Noise filter with uniform grain
      const grainAmt = Math.round(intensityNorm * 30);
      const out = nextLabel('grain');
      steps.push(`[${inputLabel}]noise=alls=${grainAmt}:allf=t+u[${out}]`);
      return { steps, lastLabel: out };
    }
    case 'glow': {
      // Split -> blur -> brighten -> blend screen
      const split0 = nextLabel('g0');
      const split1 = nextLabel('g1');
      const blurred = nextLabel('gb');
      const out = nextLabel('glow');
      const sigma = Math.max(3, Math.round(intensityNorm * 18));
      const opacity = Math.min(0.85, Number((intensityNorm * 0.7).toFixed(2)));
      steps.push(`[${inputLabel}]split[${split0}][${split1}]`);
      steps.push(`[${split1}]gblur=sigma=${sigma},eq=brightness=0.12[${blurred}]`);
      steps.push(`[${split0}][${blurred}]blend=all_mode=screen:all_opacity=${opacity}[${out}]`);
      return { steps, lastLabel: out };
    }
    case 'blur': {
      const sigma = Math.max(2, Math.round(intensityNorm * 24));
      const out = nextLabel('blur');
      steps.push(`[${inputLabel}]gblur=sigma=${sigma}[${out}]`);
      return { steps, lastLabel: out };
    }
    case 'vhs': {
      // Slight noise + color offset + saturation
      const out = nextLabel('vhs');
      const noiseAmt = Math.round(intensityNorm * 22);
      steps.push(
        `[${inputLabel}]noise=alls=${noiseAmt}:allf=t+u,eq=contrast=1.1:saturation=1.2,colorbalance=rm=0.08:bm=-0.08[${out}]`
      );
      return { steps, lastLabel: out };
    }
    case 'rgb-split':
    case 'glitch': {
      // RGB channel chromatic dispersion
      const out = nextLabel('rgb');
      const splitAmt = Math.round(intensityNorm * 18);
      steps.push(
        `[${inputLabel}]colorbalance=rs=${(intensityNorm * 0.2).toFixed(2)}:bs=${(
          -intensityNorm * 0.2
        ).toFixed(2)},noise=alls=${splitAmt}:allf=t[${out}]`
      );
      return { steps, lastLabel: out };
    }
    case 'light-leaks': {
      // Warm light leak burst on corners
      const out = nextLabel('leak');
      steps.push(
        `[${inputLabel}]colorbalance=rh=0.25:gh=0.12:bh=-0.15,eq=brightness=0.05:contrast=1.05[${out}]`
      );
      return { steps, lastLabel: out };
    }
    case 'film-burn': {
      const out = nextLabel('burn');
      steps.push(
        `[${inputLabel}]colorbalance=rm=0.28:gm=0.15:bm=-0.22,eq=contrast=1.2:brightness=0.06[${out}]`
      );
      return { steps, lastLabel: out };
    }
    case 'motion-blur': {
      const out = nextLabel('mblur');
      steps.push(`[${inputLabel}]tblend=all_mode=average[${out}]`);
      return { steps, lastLabel: out };
    }
    case 'camera-shake':
    case 'zoom': {
      // Subtle crop & scale
      const out = nextLabel('zoom');
      const scalePct = 1.0 + intensityNorm * 0.08;
      steps.push(
        `[${inputLabel}]scale=iw*${scalePct.toFixed(3)}:ih*${scalePct.toFixed(
          3
        )},crop=iw/${scalePct.toFixed(3)}:ih/${scalePct.toFixed(3)}[${out}]`
      );
      return { steps, lastLabel: out };
    }
    case 'background-blur': {
      // Radial center focus with blurred edge perimeter
      const s0 = nextLabel('bg0');
      const s1 = nextLabel('bg1');
      const blurred = nextLabel('bgb');
      const out = nextLabel('bgfocus');
      const sigma = Math.max(4, Math.round(intensityNorm * 24));
      steps.push(`[${inputLabel}]split[${s0}][${s1}]`);
      steps.push(`[${s1}]gblur=sigma=${sigma}[${blurred}]`);
      steps.push(
        `[${blurred}][${s0}]blend=all_expr='if(lte(hypot(X-W/2,Y-H/2),min(W,H)*0.38),B,A)'[${out}]`
      );
      return { steps, lastLabel: out };
    }
    default:
      return null;
  }
}
