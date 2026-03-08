#!/usr/bin/env node

/**
 * API Tuning Harness
 * Batch-tests POST /api/roast-v3 with real images over HTTP.
 *
 * Usage:
 *   node tools/tune_api.js                        (all tiers, 5 passes)
 *   node tools/tune_api.js --tier nuclear          (single tier)
 *   node tools/tune_api.js --passes 10             (10 passes per image)
 *   node tools/tune_api.js --url http://host:3000  (custom server)
 *
 * Requires: images in ./test_images/
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------- CLI args ----------
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  if (i === -1) return fallback;
  return args[i + 1] || fallback;
}

const TIER_FILTER = flag('tier', null);
const PASSES = parseInt(flag('passes', '5'), 10);
const BASE_URL = flag('url', 'http://localhost:3000');
const ENDPOINT = `${BASE_URL}/api/roast-v3`;

const ALL_TIERS = ['mild', 'medium', 'savage', 'nuclear'];
const tiers = TIER_FILTER ? [TIER_FILTER] : ALL_TIERS;

if (TIER_FILTER && !ALL_TIERS.includes(TIER_FILTER)) {
  console.error(`Invalid tier: ${TIER_FILTER}. Must be one of: ${ALL_TIERS.join(', ')}`);
  process.exit(1);
}

// ---------- Known fallbacks (to detect fallback usage) ----------
const FALLBACK_STRINGS = new Set([
  'You look like you peaked in a participation trophy ceremony.',
  'Even your camera tried to unfocus.',
  'You look like you Google "how to be cool" daily.',
  'You look like you got dressed in the dark during an earthquake.',
  'Your vibe says "I peaked in middle school and never recovered."',
  'That look screams "my personality is my Netflix queue."',
  'You look like a before photo that never got an after.',
  'Evolution really phoned it in with you.',
  'You look like you were assembled from spare parts at a clearance sale.',
  'If disappointment had a face, it would sue you for copyright.',
  'You look like a AI-generated image of "rock bottom."',
  'Your face is proof that God has a sense of humor and zero quality control.',
]);

// ---------- Load images once ----------
const IMG_DIR = path.resolve(__dirname, '..', 'test_images');

if (!fs.existsSync(IMG_DIR)) {
  console.error(`Missing directory: ${IMG_DIR}`);
  console.error('Add .jpg/.jpeg/.png images to test_images/ and retry.');
  process.exit(1);
}

const imageFiles = fs.readdirSync(IMG_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
if (imageFiles.length === 0) {
  console.error('No images found in test_images/. Add .jpg/.jpeg/.png files.');
  process.exit(1);
}

// Pre-load all base64 data
const imageData = new Map();
for (const file of imageFiles) {
  imageData.set(file, fs.readFileSync(path.join(IMG_DIR, file)).toString('base64'));
}

// ---------- Run plan ----------
const totalRuns = imageFiles.length * tiers.length * PASSES;

// ---------- API call ----------
async function callRoastV3(imageBase64, level) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, level }),
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();
  const roast = data.roasts?.[0] || '(empty)';
  const meta = data.meta || {};
  const isFallback = meta.usedFallback || FALLBACK_STRINGS.has(roast);
  const rejectReason = meta.rejectReason || null;
  return { roast, elapsed, isFallback, rejectReason };
}

// ---------- Main ----------
async function main() {
  console.log(`\n=== tune_api.js ===`);
  console.log(`Endpoint:  ${ENDPOINT}`);
  console.log(`Images:    ${imageFiles.length}`);
  console.log(`Tiers:     ${tiers.join(', ')}`);
  console.log(`Passes:    ${PASSES}`);
  console.log(`Total runs: ${totalRuns}\n`);

  const times = [];
  let completed = 0;
  let fallbackCount = 0;
  let errorCount = 0;
  const rejectCounts = {};

  for (const file of imageFiles) {
    const base64 = imageData.get(file);

    for (const tier of tiers) {
      for (let pass = 1; pass <= PASSES; pass++) {
        completed++;
        const progress = `[${completed}/${totalRuns}]`;

        try {
          const { roast, elapsed, isFallback, rejectReason } = await callRoastV3(base64, tier);
          times.push(elapsed);
          if (isFallback) {
            fallbackCount++;
            const key = rejectReason || 'unknown';
            rejectCounts[key] = (rejectCounts[key] || 0) + 1;
          }

          const fb = isFallback ? ` [FALLBACK: ${rejectReason || 'unknown'}]` : '';
          console.log(`${progress} Image: ${file}  Level: ${tier}  Pass: ${pass}/${PASSES}  Time: ${elapsed}ms${fb}`);
          console.log(`  Roast: "${roast}"\n`);
        } catch (err) {
          errorCount++;
          console.log(`${progress} Image: ${file}  Level: ${tier}  Pass: ${pass}/${PASSES}  ERROR`);
          console.log(`  ${err.message}\n`);
        }
      }
    }
  }

  // ---------- Summary ----------
  console.log('='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));

  console.log(`Total runs:     ${totalRuns}`);
  console.log(`Completed:      ${completed}`);
  console.log(`Errors:         ${errorCount}`);

  if (times.length > 0) {
    const sorted = [...times].sort((a, b) => a - b);
    const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);

    console.log(`Fallback count: ${fallbackCount}`);
    console.log(`Fallback rate:  ${((fallbackCount / times.length) * 100).toFixed(1)}%`);
    console.log(`Average time:   ${avg}ms`);
    console.log(`Fastest:        ${sorted[0]}ms`);
    console.log(`Slowest:        ${sorted[sorted.length - 1]}ms`);
    console.log(`P50:            ${sorted[Math.floor(sorted.length * 0.5)]}ms`);
    console.log(`P95:            ${sorted[Math.floor(sorted.length * 0.95)]}ms`);

    const reasons = Object.entries(rejectCounts).sort((a, b) => b[1] - a[1]);
    if (reasons.length > 0) {
      console.log(`\nReject reasons:`);
      for (const [reason, count] of reasons) {
        console.log(`  - ${reason}: ${count}`);
      }
    }
  } else {
    console.log('No successful calls.');
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
