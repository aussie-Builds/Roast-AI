#!/usr/bin/env node
require('dotenv').config({
  path: require('path').resolve(__dirname, '../server/.env')
});
console.log('[tune] OPENAI_API_KEY present=', !!process.env.OPENAI_API_KEY, 'len=', (process.env.OPENAI_API_KEY||'').length, 'prefix=', (process.env.OPENAI_API_KEY||'').slice(0,8));

/**
 * Roast Tuning Harness
 * Dev-only tool for measuring roast scoring behavior.
 *
 * Usage:
 *   npm run tune:nuclear          (default, Nuclear tier)
 *   npm run tune:savage           (Savage tier)
 *   node tools/tune_nuclear.js --tier savage
 *
 * Requires: images in ./tuning_images/
 */

// Prevent server from binding to port when imported
process.env.TUNING_MODE = '1';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ---------- CLI args ----------

const tierArg = process.argv.find((a, i) => i > 0 && process.argv[i - 1] === '--tier') || 'nuclear';
const tier = ['nuclear', 'savage'].includes(tierArg) ? tierArg : 'nuclear';

// ---------- Measurement regexes (local copies — stats only, do NOT alter scoring) ----------

const LIGHTING_MENTION_RE = /\b(lighting|dim|bright|overexposed|glaring|backlit|shadows?)\b/i;

const LIGHTING_LEAD_OPENERS = [
  'this lighting', 'dim lighting', 'the lighting', 'in this lighting',
];

const SOCIAL_EXPOSURE_RE = /\b(hit post|pressed post|posted this|uploaded this|really posted|thought this was|this was the one|nobody asked|confidence like this|should've stayed|should have stayed|should've stayed in drafts|should've stayed private|try again|delete this|this isn't it|wasn't it|no recovery|in public|in private|group chat|story|feed|timeline|drafts|start over|bold of you)\b/i;

const CLICHE_COMPARISON_RE = /\b(more|less)\b[^.]{0,50}\b(than)\b[^.]{0,40}\b(you|your selfie|your face|your look|your expression)\b/i;
const CLICHE_GLOWING_RE = /\b(only|just)\b[^.]{0,25}\b(one|thing)\b[^.]{0,25}\b(glowing|alive|lively|awake|working)\b/i;
const CLICHE_MORE_ALIVE_RE = /\b(makes|making)\b[^.]{0,40}\b(look|seem)\b[^.]{0,20}\b(more)\b[^.]{0,20}\b(alive|lively|awake)\b/i;

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const RUNS_PER_IMAGE = 8;

// ---------- Helpers ----------

function isCliche(text) {
  return CLICHE_COMPARISON_RE.test(text) || CLICHE_GLOWING_RE.test(text) || CLICHE_MORE_ALIVE_RE.test(text);
}

function lightingLeadsS1(text) {
  const s1 = (text.split(/[.!?]/)[0] || '').toLowerCase().trim();
  for (const opener of LIGHTING_LEAD_OPENERS) {
    if (s1.startsWith(opener) || s1.startsWith('your ' + opener)) return true;
  }
  // Also catch lighting term in the first 4 words of S1
  const firstWords = s1.split(/\s+/).slice(0, 4).join(' ');
  return /\b(lighting|dim|backlit)\b/.test(firstWords);
}

function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function tokenSimilarity(a, b) {
  const tokensA = new Set(a.toLowerCase().split(/\s+/));
  const tokensB = new Set(b.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function rate(arr, predicate) {
  if (arr.length === 0) return 0;
  return arr.filter(predicate).length / arr.length;
}

function savageOpenerFamily(text) {
  const lower = text.toLowerCase().trimStart();
  if (lower.startsWith('nobody needed to see')) return 'FAMILY_NOBODY';
  if (lower.startsWith('even your') || lower.startsWith('even the')) return 'FAMILY_EVEN';
  if (lower.startsWith('your ')) return 'FAMILY_YOUR';
  if (lower.startsWith('that ')) return 'FAMILY_THAT';
  if (lower.startsWith('the ')) return 'FAMILY_THE';
  return 'FAMILY_MISC';
}

function savageQualityScore(text) {
  const wc = countWords(text);
  let score = 0;
  if (wc >= 11 && wc <= 12) score += 18;
  else if (wc === 10 || (wc >= 13 && wc <= 14)) score += 12;
  else if (wc === 9) score += 6;
  else if (wc <= 8) score -= 10;
  if (wc > 16) score -= 6;
  if (savageOpenerFamily(text) === 'FAMILY_NOBODY') score -= 6;
  return score;
}

function nuclearQualityScore(text) {
  const wc = countWords(text);
  let score = 0;
  if (wc >= 14 && wc <= 22) score += 12;
  else if (wc >= 10 && wc <= 13) score += 6;
  else if (wc >= 23 && wc <= 26) score += 4;
  else if (wc <= 9) score -= 10;
  if (wc > 30) score -= 8;
  if (isCliche(text)) score -= 6;
  if (SOCIAL_EXPOSURE_RE.test(text)) score += 4;
  if (lightingLeadsS1(text)) score -= 4;
  return score;
}

const SV2_STALE_RE = /\b(went through the motions|missed the memo|needs a second draft)\b/i;

function savageSpiceScore(text) {
  const lower = text.toLowerCase();
  const wc = countWords(text);
  let score = 0;
  if (lower.includes('buffering')) score += 6;
  if (lower.includes('in public')) score += 5;
  if (lower.includes('delete this')) score += 5;
  if (lower.includes('mid with confidence') || lower.includes('confidence without')) score += 4;
  if (text.includes('\u2014')) score += 3;
  if (wc >= 8 && wc <= 13 && /[.!?]$/.test(text.trim())) score += 2;
  if (SV2_STALE_RE.test(text)) score -= 6;
  return score;
}

function dupRate(texts) {
  let dupPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      totalPairs++;
      if (tokenSimilarity(texts[i], texts[j]) > 0.7) dupPairs++;
    }
  }
  return totalPairs > 0 ? dupPairs / totalPairs : 0;
}

// ---------- Main ----------

async function main() {
  const tuningDir = path.resolve('tuning_images');

  // Ensure directory exists
  if (!fs.existsSync(tuningDir)) {
    fs.mkdirSync(tuningDir, { recursive: true });
  }

  const files = (await fsp.readdir(tuningDir))
    .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.log('No images found in ./tuning_images/. Add images to begin tuning.');
    return;
  }

  console.log(`Found ${files.length} image(s) in ./tuning_images/ [tier=${tier}]\n`);

  // Import server module (ESM) — TUNING_MODE prevents app.listen
  const serverPath = pathToFileURL(path.resolve('server/index.js')).href;
  const { generateNuclearV2, generateSavageV2, nv2ExtractSceneNouns, extractSafeSelfieTags } = await import(serverPath);

  const allResults = [];

  for (const file of files) {
    const imagePath = path.join(tuningDir, file);
    const imageBuffer = await fsp.readFile(imagePath);
    const ext = path.extname(file).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    const mime = mimeMap[ext];
    if (!mime) {
      console.warn(`[tune] Skipping ${file}: unsupported format (${ext})`);
      continue;
    }
    const base64 = imageBuffer.toString('base64').replace(/\s+/g, '');
    const imageDataUrl = `data:${mime};base64,${base64}`;

    console.log(`--- ${file} ---`);

    // Extract tags once per image
    const [dynamicTargets, selfieTags] = await Promise.all([
      nv2ExtractSceneNouns(imageDataUrl),
      extractSafeSelfieTags(imageDataUrl),
    ]);
    console.log('[tune] selfieTags summary', {
      person_present: selfieTags?.person_present,
      face_visible: selfieTags?.face_visible,
      face_confidence: selfieTags?.face_confidence,
      lighting: selfieTags?.lighting,
      setting: selfieTags?.setting
    });

    const imageResults = [];

    for (let i = 0; i < RUNS_PER_IMAGE; i++) {
      process.stdout.write(`  Run ${i + 1}/${RUNS_PER_IMAGE} ... `);

      let result;
      if (tier === 'savage') {
        result = await generateSavageV2({
          clientId: 'tuning',
          imageBase64: imageDataUrl,
        });
      } else {
        result = await generateNuclearV2({
          clientId: 'tuning',
          imageBase64: imageDataUrl,
          dynamicTargets,
          selfieTags,
        });
      }
      const roast = result.roast;
      const meta = result.meta || null;
      if (meta) {
        console.log(`[${meta.tier}-v2 meta]`, {
          isUsableFace: meta.isUsableFace,
          detailPackWeak: meta.detailPackWeak,
          anchorsCount: meta.anchorsCount,
          candidatesCount: meta.candidatesCount,
          validCount: meta.validCount,
          rejectedReasons: meta.rejectedReasons,
          winnerScore: meta.winnerScore,
        });
      }

      const entry = {
        text: roast,
        words: countWords(roast),
        meta: meta,
      };
      if (tier === 'nuclear') {
        entry.lightingMentioned = LIGHTING_MENTION_RE.test(roast);
        entry.lightingLeads = lightingLeadsS1(roast);
        entry.socialExposure = SOCIAL_EXPOSURE_RE.test(roast);
        entry.cliche = isCliche(roast);
      }
      imageResults.push(entry);
      console.log(`"${roast}" (${entry.words}w)`);

      await new Promise(r => setTimeout(r, 250));
    }

    allResults.push({ file, results: imageResults });
  }

  // ---------- Summary ----------

  const allEntries = allResults.flatMap(img => img.results);
  const total = allEntries.length;
  const allTexts = allEntries.map(e => e.text);

  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

  console.log('\n==========================');
  console.log(`${tierLabel} Tuning Summary`);
  console.log('==========================\n');

  console.log(`Images tested: ${allResults.length}`);
  console.log(`Total runs: ${total}\n`);

  if (tier === 'nuclear') {
    console.log(`lightingMentionRate: ${rate(allEntries, e => e.lightingMentioned).toFixed(2)}`);
    console.log(`lightingLeadRate: ${rate(allEntries, e => e.lightingLeads).toFixed(2)}`);
    console.log(`socialExposureRate: ${rate(allEntries, e => e.socialExposure).toFixed(2)}`);
    console.log(`clicheRate: ${rate(allEntries, e => e.cliche).toFixed(2)}`);
  }
  if (tier === 'savage') {
    const MICRO_TEXT_RE = /mid with confidence|confidence without clearance|delete this|in public\?|in public\./i;
    const microCount = allEntries.filter(e =>
      (e.meta && (e.meta.structureId === 'MICRO' || e.meta.pickedStructureId === 'MICRO')) ||
      MICRO_TEXT_RE.test(e.text)
    ).length;
    console.log(`microHitRate: ${(microCount / total).toFixed(2)}`);
  }
  console.log(`duplicateRate: ${dupRate(allTexts).toFixed(2)}`);
  console.log(`avgWords: ${(allEntries.reduce((s, e) => s + e.words, 0) / total).toFixed(1)}`);

  // ---------- Per-image breakdown ----------

  console.log('\n--- Per-Image Breakdown ---\n');

  for (const { file, results } of allResults) {
    const texts = results.map(r => r.text);
    console.log(`${file}:`);
    if (tier === 'nuclear') {
      console.log(`  lightingMentionRate: ${rate(results, r => r.lightingMentioned).toFixed(2)}`);
      console.log(`  lightingLeadRate: ${rate(results, r => r.lightingLeads).toFixed(2)}`);
      console.log(`  socialExposureRate: ${rate(results, r => r.socialExposure).toFixed(2)}`);
      console.log(`  clicheRate: ${rate(results, r => r.cliche).toFixed(2)}`);
    }
    if (tier === 'nuclear') {
      const scored = results.map(r => ({
        text: r.text,
        words: r.words,
        score: nuclearQualityScore(r.text),
        family: savageOpenerFamily(r.text),
      })).sort((a, b) => b.score - a.score);

      const best = scored[0];
      console.log(`  best: "${best.text}" (score=${best.score} words=${best.words})`);

      const NV2_FALLBACK_RE = /^(that angle was a creative|bold strategy going with|you posed like this was|your confidence walked in|that effort was voluntary)/i;
      const ascending = [...scored].reverse();
      const worst = ascending.find(r => r.text && !NV2_FALLBACK_RE.test(r.text)) || ascending[0];
      console.log(`  worst: "${worst.text}" (score=${worst.score} words=${worst.words})`);

      const famCounts = { YOUR: 0, THAT: 0, THE: 0, NOBODY: 0, EVEN: 0, MISC: 0 };
      for (const r of scored) {
        const key = r.family.replace('FAMILY_', '');
        famCounts[key] = (famCounts[key] || 0) + 1;
      }
      const famStr = Object.entries(famCounts).map(([k, v]) => `${k}=${v}`).join(' ');
      console.log(`  families: ${famStr}`);
    }
    console.log(`  duplicateRate: ${dupRate(texts).toFixed(2)}`);
    console.log(`  avgWords: ${(results.reduce((s, r) => s + r.words, 0) / results.length).toFixed(1)}`);
    if (tier === 'savage') {
      const scored = results.map(r => ({
        text: r.text,
        words: r.words,
        score: savageQualityScore(r.text),
        spice: savageSpiceScore(r.text),
        family: savageOpenerFamily(r.text),
      })).sort((a, b) => b.score - a.score);

      const best = scored[0];
      console.log(`  best: "${best.text}" (score=${best.score} family=${best.family} words=${best.words})`);

      // Worst (lowest score, excluding fallbacks)
      const FALLBACK_RE = /^(that angle was a creative|bold strategy going with|you posed like this was|your confidence walked in|that effort was voluntary)/i;
      const ascending = [...scored].reverse();
      const worst = ascending.find(r => r.text && !FALLBACK_RE.test(r.text)) || ascending[0];
      console.log(`  worst: "${worst.text}" (score=${worst.score} family=${worst.family} words=${worst.words})`);

      // Spiciest
      const bySpice = [...scored].sort((a, b) => b.spice !== a.spice ? b.spice - a.spice : b.score - a.score);
      const spiciest = bySpice[0];
      console.log(`  spiciest: "${spiciest.text}" (spice=${spiciest.spice} family=${spiciest.family} words=${spiciest.words})`);

      // Family distribution
      const famCounts = { YOUR: 0, THAT: 0, THE: 0, NOBODY: 0, EVEN: 0, MISC: 0 };
      for (const r of scored) {
        const key = r.family.replace('FAMILY_', '');
        famCounts[key] = (famCounts[key] || 0) + 1;
      }
      const famStr = Object.entries(famCounts).map(([k, v]) => `${k}=${v}`).join(' ');
      console.log(`  families: ${famStr}`);
    }
  }
}

main().catch(err => {
  console.error('Tuning harness error:', err);
  process.exit(1);
});
