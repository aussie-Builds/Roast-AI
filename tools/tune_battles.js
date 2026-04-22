#!/usr/bin/env node

/**
 * Battle Tuning Harness
 * Dev-only tool for measuring /api/battle-v1 behavior and consistency.
 *
 * Usage:
 *   node tools/tune_battles.js                       (default: medium tier, default persona, 5 passes)
 *   node tools/tune_battles.js --tier nuclear
 *   node tools/tune_battles.js --persona butler
 *   node tools/tune_battles.js --passes 3
 *   node tools/tune_battles.js --limit 2             (only first 2 pairs)
 *   node tools/tune_battles.js --url http://host:3000
 *
 * Folder layout expected:
 *   tuning_battles/
 *     pair_01/
 *       A.jpg
 *       B.jpg
 *     pair_02/
 *       A.jpg
 *       B.jpg
 *
 * Files A and B can be .jpg / .jpeg / .png / .webp.
 *
 * Note: start your dev server with TUNING_MODE=1 to bypass cooldown / rate-limit
 *   TUNING_MODE=1 node server/index.js
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '../server/.env'),
});

const fs = require('node:fs');
const path = require('node:path');

// ---------- CLI args ----------
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  if (i === -1) return fallback;
  return args[i + 1] || fallback;
}

const TIER = flag('tier', 'medium');
const PERSONA = flag('persona', 'default');
const PASSES = parseInt(flag('passes', '5'), 10);
const LIMIT = parseInt(flag('limit', '0'), 10) || Infinity;
const BASE_URL = flag('url', 'http://localhost:3000');
const ENDPOINT = `${BASE_URL}/api/battle-v1`;

const ALL_TIERS = ['mild', 'medium', 'savage', 'nuclear'];
const ALL_PERSONAS = ['default', 'butler', 'mean_girl', 'gym_bro', 'anime_villain', 'therapist'];

if (!ALL_TIERS.includes(TIER)) {
  console.error(`Invalid tier: ${TIER}. Must be one of: ${ALL_TIERS.join(', ')}`);
  process.exit(1);
}
if (!ALL_PERSONAS.includes(PERSONA)) {
  console.error(`Invalid persona: ${PERSONA}. Must be one of: ${ALL_PERSONAS.join(', ')}`);
  process.exit(1);
}

// ---------- Discover pairs ----------
const PAIR_DIR = path.resolve(__dirname, '..', 'tuning_battles');

if (!fs.existsSync(PAIR_DIR)) {
  console.error(`Missing directory: ${PAIR_DIR}`);
  console.error('Create tuning_battles/pair_01/{A,B}.jpg etc. and retry.');
  process.exit(1);
}

const IMG_RX = /\.(jpe?g|png|webp)$/i;

function findSide(dir, side) {
  const entries = fs.readdirSync(dir);
  const match = entries.find(f => new RegExp(`^${side}\\.(jpe?g|png|webp)$`, 'i').test(f));
  return match ? path.join(dir, match) : null;
}

const pairs = fs.readdirSync(PAIR_DIR)
  .filter(name => fs.statSync(path.join(PAIR_DIR, name)).isDirectory())
  .sort()
  .map(name => {
    const dir = path.join(PAIR_DIR, name);
    const a = findSide(dir, 'A');
    const b = findSide(dir, 'B');
    return { name, dir, a, b };
  })
  .filter(p => {
    if (!p.a || !p.b) {
      console.warn(`[skip] ${p.name}: missing A or B image`);
      return false;
    }
    return true;
  })
  .slice(0, LIMIT);

if (pairs.length === 0) {
  console.error(`No usable pairs found in ${PAIR_DIR}.`);
  process.exit(1);
}

// Pre-load base64
for (const p of pairs) {
  p.base64A = fs.readFileSync(p.a).toString('base64');
  p.base64B = fs.readFileSync(p.b).toString('base64');
}

// ---------- API call ----------
// Server-side BATTLE_FALLBACK shape (server/index.js). Any 200 response that
// matches this exact tuple means the judge / roast pipeline failed and the
// server quietly substituted canned text — must NOT be mixed into dup metrics.
const BATTLE_FALLBACK_STRINGS = {
  roastA: "Even the camera couldn't pick a side.",
  roastB: 'Both photos showed up and still lost.',
  verdict: 'Close enough.',
  reason: 'One side still managed to lose harder.',
};

async function callBattle(base64A, base64B, level, persona) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64A: base64A, imageBase64B: base64B, level, persona }),
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();
  const isFallback =
    data.roastA === BATTLE_FALLBACK_STRINGS.roastA &&
    data.roastB === BATTLE_FALLBACK_STRINGS.roastB &&
    data.verdict === BATTLE_FALLBACK_STRINGS.verdict &&
    data.reason === BATTLE_FALLBACK_STRINGS.reason;
  return {
    elapsed,
    status: res.status,
    roastA: data.roastA || '(empty)',
    roastB: data.roastB || '(empty)',
    winner: data.winner || '?',
    verdict: data.verdict || '(empty)',
    reason: data.reason || '(empty)',
    error: data.error || null,
    isFallback,
  };
}

// ---------- Helpers ----------
function pct(n, d) {
  if (!d) return '0.0%';
  return ((n / d) * 100).toFixed(1) + '%';
}

function dupRate(arr) {
  // share of values that are not unique (i.e. appear at least once elsewhere)
  if (arr.length === 0) return 0;
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  let dup = 0;
  for (const [, c] of counts) if (c > 1) dup += c;
  return dup / arr.length;
}

function avg(nums) {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// ---------- Main ----------
async function main() {
  const totalRuns = pairs.length * PASSES;
  console.log(`\n=== tune_battles.js ===`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Pairs:    ${pairs.length}  (${pairs.map(p => p.name).join(', ')})`);
  console.log(`Tier:     ${TIER}`);
  console.log(`Persona:  ${PERSONA}`);
  console.log(`Passes:   ${PASSES}`);
  console.log(`Total:    ${totalRuns} runs\n`);

  const allTimes = [];
  const allRoastsA = [];
  const allRoastsB = [];
  const allVerdicts = [];
  const allReasons = [];
  let winsA = 0;
  let winsB = 0;
  let errorCount = 0;
  let fallbackCount = 0;
  const perPair = [];

  let completed = 0;
  for (const pair of pairs) {
    console.log('-'.repeat(60));
    console.log(`PAIR: ${pair.name}`);
    console.log('-'.repeat(60));

    const pairTimes = [];
    const pairRoastsA = [];
    const pairRoastsB = [];
    const pairVerdicts = [];
    const pairReasons = [];
    let pairWinsA = 0;
    let pairWinsB = 0;
    let pairFallbacks = 0;

    for (let pass = 1; pass <= PASSES; pass++) {
      completed++;
      const tag = `[${completed}/${totalRuns}] ${pair.name}  pass ${pass}/${PASSES}`;
      try {
        const r = await callBattle(pair.base64A, pair.base64B, TIER, PERSONA);
        if (r.error) {
          errorCount++;
          console.log(`${tag}  HTTP ${r.status}  ERROR: ${r.error}`);
          continue;
        }
        // Always show latency, but exclude fallback runs from the dup/winner pools
        // so a flaky pipeline doesn't masquerade as judge inconsistency.
        allTimes.push(r.elapsed);
        pairTimes.push(r.elapsed);
        if (r.isFallback) {
          fallbackCount++;
          pairFallbacks++;
          console.log(`${tag}  ${r.elapsed}ms  [FALLBACK — server returned canned response]`);
          console.log(`  roastA:  "${r.roastA}"`);
          console.log(`  roastB:  "${r.roastB}"`);
          console.log(`  verdict: "${r.verdict}"`);
          console.log(`  reason:  "${r.reason}"\n`);
          continue;
        }
        allRoastsA.push(r.roastA);
        allRoastsB.push(r.roastB);
        allVerdicts.push(r.verdict);
        allReasons.push(r.reason);
        pairRoastsA.push(r.roastA);
        pairRoastsB.push(r.roastB);
        pairVerdicts.push(r.verdict);
        pairReasons.push(r.reason);
        if (r.winner === 'A') { winsA++; pairWinsA++; }
        else if (r.winner === 'B') { winsB++; pairWinsB++; }

        console.log(`${tag}  ${r.elapsed}ms  winner=${r.winner}`);
        console.log(`  roastA:  "${r.roastA}"`);
        console.log(`  roastB:  "${r.roastB}"`);
        console.log(`  verdict: "${r.verdict}"`);
        console.log(`  reason:  "${r.reason}"\n`);
      } catch (err) {
        errorCount++;
        console.log(`${tag}  EXCEPTION: ${err.message}\n`);
      }
    }

    const pairTotal = pairWinsA + pairWinsB;
    const pairAWinRate = pairTotal ? pairWinsA / pairTotal : 0;
    const pairBWinRate = pairTotal ? pairWinsB / pairTotal : 0;
    const pairVerdictDup = dupRate(pairVerdicts);
    const pairReasonDup = dupRate(pairReasons);

    perPair.push({
      name: pair.name,
      runs: pairTimes.length,
      fallbacks: pairFallbacks,
      avgMs: avg(pairTimes),
      aRate: pairAWinRate,
      bRate: pairBWinRate,
      verdictDup: pairVerdictDup,
      reasonDup: pairReasonDup,
      roastADup: dupRate(pairRoastsA),
      roastBDup: dupRate(pairRoastsB),
    });
  }

  // ---------- Overall summary ----------
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const decided = winsA + winsB;
  console.log(`Total runs:       ${totalRuns}`);
  console.log(`Completed:        ${allTimes.length}`);
  console.log(`Errors:           ${errorCount}`);
  console.log(`Fallbacks:        ${fallbackCount}  (excluded from dup/winner stats)`);
  console.log(`Avg latency:      ${avg(allTimes)}ms`);
  if (allTimes.length) {
    const sorted = [...allTimes].sort((a, b) => a - b);
    console.log(`Fastest / Slowest: ${sorted[0]}ms / ${sorted[sorted.length - 1]}ms`);
    console.log(`P50 / P95:        ${sorted[Math.floor(sorted.length * 0.5)]}ms / ${sorted[Math.floor(sorted.length * 0.95)]}ms`);
  }
  console.log(`Winner A rate:    ${pct(winsA, decided)}  (${winsA}/${decided})`);
  console.log(`Winner B rate:    ${pct(winsB, decided)}  (${winsB}/${decided})`);
  console.log(`roastA dup rate:  ${pct(Math.round(dupRate(allRoastsA) * allRoastsA.length), allRoastsA.length)}`);
  console.log(`roastB dup rate:  ${pct(Math.round(dupRate(allRoastsB) * allRoastsB.length), allRoastsB.length)}`);
  console.log(`verdict dup rate: ${pct(Math.round(dupRate(allVerdicts) * allVerdicts.length), allVerdicts.length)}`);
  console.log(`reason dup rate:  ${pct(Math.round(dupRate(allReasons) * allReasons.length), allReasons.length)}`);

  // ---------- Per-pair table ----------
  console.log(`\nPer-pair breakdown:`);
  for (const p of perPair) {
    console.log(`  ${p.name}: n=${p.runs} avg=${p.avgMs}ms  A=${(p.aRate * 100).toFixed(0)}%  B=${(p.bRate * 100).toFixed(0)}%  verdictDup=${(p.verdictDup * 100).toFixed(0)}%  reasonDup=${(p.reasonDup * 100).toFixed(0)}%`);
  }

  // ---------- Warning flags ----------
  const warnings = [];
  if (fallbackCount > 0) warnings.push(`${fallbackCount}/${allTimes.length} runs returned the canned BATTLE_FALLBACK — judge or roast pipeline is failing`);
  for (const p of perPair) {
    if (p.fallbacks > 0) warnings.push(`pair ${p.name}: ${p.fallbacks}/${PASSES} runs were fallbacks`);
    if (p.aRate > 0.85) warnings.push(`pair ${p.name}: winner A ${(p.aRate * 100).toFixed(0)}% — possible A-bias`);
    if (p.bRate > 0.85) warnings.push(`pair ${p.name}: winner B ${(p.bRate * 100).toFixed(0)}% — possible B-bias`);
    if (p.verdictDup > 0.5) warnings.push(`pair ${p.name}: verdict dup rate ${(p.verdictDup * 100).toFixed(0)}% — verdict feels canned`);
    if (p.reasonDup > 0.5) warnings.push(`pair ${p.name}: reason dup rate ${(p.reasonDup * 100).toFixed(0)}% — reason feels canned`);
  }
  const overallVerdictDup = dupRate(allVerdicts);
  const overallReasonDup = dupRate(allReasons);
  if (overallVerdictDup > 0.4) warnings.push(`overall verdict dup ${(overallVerdictDup * 100).toFixed(0)}% — judge keeps recycling verdicts`);
  if (overallReasonDup > 0.4) warnings.push(`overall reason dup ${(overallReasonDup * 100).toFixed(0)}% — judge keeps recycling reasons`);

  if (warnings.length) {
    console.log(`\nWARNINGS:`);
    for (const w of warnings) console.log(`  ! ${w}`);
  } else {
    console.log(`\nNo warning flags raised.`);
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
