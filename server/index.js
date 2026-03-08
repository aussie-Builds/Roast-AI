import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ limit: '35mb', extended: true }));

// Early error handler: catch body-parser errors before routes (prevents HTML 413 pages)
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'payload_too_large', message: 'Image is too large. Please use a smaller image.' });
  }
  if (err.status === 400 && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Request body could not be parsed as JSON.' });
  }
  next(err);
});

// Helper: always return JSON errors with correct Content-Type
function jsonError(res, status, error, message) {
  return res.status(status).type('application/json').json({ error, message });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Intensity configuration ---
const INTENSITY_CONFIG = {
  mild: {
    count: 1,
    minChars: 0,
    candidates: 8,
    maxSentences: 1,
    maxChars: 120,
    maxWords: 14,
    maxTokens: 60,
    temperature: 1.0,
    top_p: 0.92,
    presence_penalty: 0.5,
    frequency_penalty: 0.3,
    style: 'playful, light observational tease — "haha okay fair"',
    format: 'EXACTLY 1 sentence, 8–14 words, shareable without offense',
  },
  medium: {
    count: 1,
    minChars: 0,
    candidates: 12,
    maxSentences: 2,
    maxChars: 200,
    maxWords: 22,
    maxTokens: 80,
    temperature: 1.0,
    top_p: 0.92,
    presence_penalty: 0.6,
    frequency_penalty: 0.4,
    style: 'clever, social embarrassment, effort mismatch — an "oof" moment',
    format: 'EXACTLY 2 sentences, 14–22 words, screenshotable',
  },
  savage: {
    count: 1,
    minChars: 0,
    maxChars: 200,
    maxWords: 22,
    maxSentences: 2,
    maxTokens: 70,
    candidates: 12,
    temperature: 1.05,
    top_p: 0.9,
    presence_penalty: 0.8,
    frequency_penalty: 0.5,
    style: 'cold verdict + micdrop — tight, humiliating, screenshot-ready',
    format: 'TWO sentences, 11–22 words, s2 is organic short closer (1–4 words); no fixed list',
  },
  nuclear: {
    count: 1,
    minChars: 0,
    maxChars: 450,
    maxSentences: 3,
    maxTokens: 150,
    candidates: 10,
    temperature: 1.15,
    top_p: 0.95,
    presence_penalty: 0.6,
    frequency_penalty: 0.3,
    style: 'cold, direct, personal, cutting — significantly harsher than savage',
    format: 'ONE roast (2 sentences + appended mic-drop closer); no numbered list',
  },
};

const BANNED_CLICHES = [
  'touch grass', 'NPC', 'potential', 'shower arguments', 'main character',
  'existential dread', 'apathy', 'quiet desperation', 'monotony of existence',
  'monotony', 'existential', 'aesthetic', 'masterclass', 'indifference',
];

const BANNED_HEDGING = [
  'looks like', 'suggests', 'seems', 'you seem', 'you look like', "it's like",
  'this image', 'everything in this frame', 'this frame', 'a masterclass in',
  'the story this tells', 'what we see here',
];

const NUCLEAR_BANNED = [
  'lifeless', 'dead-eyed', 'invisible', 'utterly forgettable', 'forgotten instantly',
  'no one notices', 'nobody notices', 'pretends not to see', 'living ghost',
  'background extra', 'why bother', 'upgrade your presence',
  'lost cause', 'nobody respects', 'no one respects', "they shouldn't",
  'they shouldn\'t', 'nobody in that room', 'no one in that room',
  'invisible would be',
];

const NUCLEAR_BANNED_WORTHLESSNESS = [
  'irrelevant', "you're irrelevant", 'you are irrelevant',
  'nobody cares', 'no one cares', 'forgettable', 'forgotten',
  'living ghost', 'lost cause', 'unmissed',
  'nobody respects', 'no one respects',
];

const NUCLEAR_IMPERATIVES = [
  'upgrade', 'fix', 'try', 'go', 'get', 'start', 'learn',
];

const NUCLEAR_KO_LIST = [
  'Confidence sold separately.',
  'That pose begged.',
  'You tried. It shows.',
  'Delusion did the styling.',
  'Secondhand embarrassment.',
  'Nothing here lands.',
  "Your swagger's on layaway.",
  'The camera flinched.',
  'All noise, no presence.',
  'Even the mirror hesitates.',
  'Bravado with no backup.',
  'Peak mediocrity, documented.',
  'Audacity without the range.',
  'Style on life support.',
  'Charisma flatlined.',
  'That outfit gave a eulogy.',
  'Borrowed confidence.',
  'Self-awareness left the chat.',
  'The vibe expired.',
  'Effort detected. Impact missing.',
  'Presentation: rejected.',
  'Peak try-hard, zero payoff.',
  'Swagger buffering.',
  'Competence not pictured.',
  'The fit lied.',
  'Overconfident and underprepared.',
  'Performance reviewed. Denied.',
  'Ego wrote a check it can\'t cash.',
  'Whole aesthetic on clearance.',
  'That angle was a cry for help.',
];

const NUCLEAR_CLOSER_BANS = [
  'detected', 'confirmed', 'exposed', 'analyzed', 'analysis', 'evidence', 'diagnosed', 'warning',
];

const NUCLEAR_CLOSER_TEMPLATES = [
  'confidence: not found.', 'social battery: dead.', 'try again.', 'loading…',
  'buffering…', 'patch failed.', 'update required.', 'skill issue.',
  'refund pending.', 'error 404.', 'battery: dead.',
  'charisma: not installed.', 'presence: missing.', 'aura: offline.',
  'swagger: declined.', 'main character: denied.', 'self-awareness: offline.',
  'personality: trial expired.', 'rizz: discontinued.', 'cool: unverified.',
  'status: imaginary.', 'energy: refunded.', 'confidence: declined.',
  'respect: pending.', 'vibe: discontinued.', 'delusion: enabled.',
  'charm: revoked.', 'drip: recalled.', 'game: not detected.',
  'relevance: expired.', 'taste: denied.', 'effort: wasted.',
  'appeal: under review.', 'range: limited.', 'impact: none.',
  'clout: imaginary.', 'poise: missing.', 'edge: not found.',
];

// Lane-specific mic-drop closers (3 tiers: lite / medium / heavy, 12–16 per tier)
const NUCLEAR_MICDROPS = {
  'expression': {
    lite:   ["That's a choice.", 'Be serious.', 'Not the serve.', 'Read that back.', 'Bold of you.', 'Barely registered.', 'Swing and a miss.', "Didn't land.", 'Off-brand energy.', 'Work in progress.', 'Almost something.', 'Rough draft energy.'],
    medium: ['Not fooling anyone.', 'Read the room.', "This isn't landing.", 'Respectfully: no.', 'The room noticed.', 'Social experiment failed.', "Nobody asked.", 'Wrong audience.', 'Not the flex.', 'Timeline is watching.', 'Rent-free embarrassment.', 'Public record now.'],
    heavy:  ['Receipts are public.', 'Group chat verified.', 'Audience left early.', 'Crowd went silent.', 'Your confidence is a rumor.', 'Screenshot-worthy.', 'Exhibit A.', 'Posted and proven.', 'Trending for the wrong reasons.', 'Permanently archived.', 'Forwarded with context.', 'The jury rested.'],
  },
  'posture': {
    lite:   ['Be serious.', "That's a choice.", 'Read that back.', 'Bold move.', 'Barely counts.', 'Swing and a miss.', "Didn't land.", 'Not the serve.', 'Off-brand energy.', 'Rough draft energy.', 'Almost something.', 'Participation trophy.'],
    medium: ['Sit down.', 'Reality check.', 'Not fooling anyone.', "Nobody's buying it.", 'The room noticed.', 'Wrong energy.', "This isn't landing.", 'Try a different personality.', 'Not the flex.', 'Timeline is watching.', 'Rent-free embarrassment.', 'Public record now.'],
    heavy:  ['Group chat verified.', 'Crowd went silent.', 'Reality won.', 'Case closed.', 'Your confidence is a rumor.', 'Exhibit A.', 'Screenshot-worthy.', 'Evidence submitted.', 'Trending for the wrong reasons.', 'Forwarded with context.', 'Permanently archived.', 'The jury rested.'],
  },
  'grooming': {
    lite:   ["That's a choice.", 'Be serious.', 'Bold of you.', 'Read that back.', 'Not the serve.', 'Barely registered.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Almost something.', 'Rough draft energy.', 'Participation trophy.'],
    medium: ['Return to drafts.', "This isn't landing.", 'Not fooling anyone.', 'The room noticed.', 'Respectfully: no.', "Nobody asked.", 'Wrong audience.', 'Social experiment failed.', 'Not the flex.', 'Timeline is watching.', 'Public record now.', 'Rent-free embarrassment.'],
    heavy:  ['Receipts are public.', 'Evidence submitted.', 'Case closed.', 'Your confidence is a rumor.', 'Exhibit A.', 'Group chat verified.', 'Posted and proven.', 'Screenshot-worthy.', 'Trending for the wrong reasons.', 'Permanently archived.', 'Forwarded with context.', 'The jury rested.'],
  },
  'outfit': {
    lite:   ["That's a choice.", 'Be serious.', 'Bold of you.', 'Read that back.', 'Not the serve.', 'Swing and a miss.', 'Barely counts.', "Didn't land.", 'Off-brand energy.', 'Rough draft energy.', 'Work in progress.', 'Almost something.'],
    medium: ['Return to drafts.', "This isn't landing.", 'Not fooling anyone.', 'Try a different personality.', 'Respectfully: no.', 'The room noticed.', "Nobody asked.", 'Wrong audience.', 'Not the flex.', 'Public record now.', 'Timeline is watching.', 'Rent-free embarrassment.'],
    heavy:  ['Exhibit A.', 'Evidence submitted.', 'Group chat verified.', 'Reality won.', 'Your confidence is a rumor.', 'Screenshot-worthy.', 'Posted and proven.', 'Case closed.', 'Trending for the wrong reasons.', 'Forwarded with context.', 'Permanently archived.', 'The jury rested.'],
  },
  'setting/background': {
    lite:   ["That's a choice.", 'Be serious.', 'Bold move.', 'Read that back.', 'Barely registered.', 'Not the serve.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Rough draft energy.', 'Almost something.', 'Participation trophy.'],
    medium: ["Nobody's buying it.", "This isn't landing.", 'Reality check.', 'The room noticed.', 'Not fooling anyone.', 'Respectfully: no.', "Nobody asked.", 'Social experiment failed.', 'Not the flex.', 'Timeline is watching.', 'Public record now.', 'Rent-free embarrassment.'],
    heavy:  ['Scene of the crime.', 'Crowd went silent.', 'Receipts are public.', 'Case closed.', 'Your confidence is a rumor.', 'Exhibit A.', 'Screenshot-worthy.', 'Evidence submitted.', 'Trending for the wrong reasons.', 'Permanently archived.', 'Forwarded with context.', 'The jury rested.'],
  },
  'camera angle': {
    lite:   ['Be serious.', "That's a choice.", 'Bold of you.', 'Read that back.', 'Not the serve.', 'Barely registered.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Work in progress.', 'Almost something.', 'Rough draft energy.'],
    medium: ['Not fooling anyone.', "Nobody's buying it.", "This isn't landing.", 'Return to drafts.', 'The room noticed.', 'Respectfully: no.', 'Wrong audience.', 'Try a different personality.', 'Not the flex.', 'Timeline is watching.', 'Public record now.', 'Rent-free embarrassment.'],
    heavy:  ['Evidence submitted.', 'Receipts are public.', 'Reality won.', 'Your confidence is a rumor.', 'Exhibit A.', 'Group chat verified.', 'Screenshot-worthy.', 'Posted and proven.', 'Trending for the wrong reasons.', 'Forwarded with context.', 'Permanently archived.', 'The jury rested.'],
  },
  'effort level': {
    lite:   ["That's a choice.", 'Be serious.', 'Bold move.', 'Read that back.', 'Not the serve.', 'Barely counts.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Almost something.', 'Participation trophy.', 'Rough draft energy.'],
    medium: ["This isn't landing.", 'Not fooling anyone.', 'Main character: denied.', 'The room noticed.', 'Respectfully: no.', "Nobody asked.", 'Wrong energy.', 'Social experiment failed.', 'Not the flex.', 'Timeline is watching.', 'Rent-free embarrassment.', 'Public record now.'],
    heavy:  ['Crowd went silent.', 'Case closed.', 'Group chat verified.', 'Reality won.', 'Your confidence is a rumor.', 'Screenshot-worthy.', 'Exhibit A.', 'Posted and proven.', 'Trending for the wrong reasons.', 'Permanently archived.', 'Forwarded with context.', 'The jury rested.'],
  },
  'confidence gap': {
    lite:   ['Be serious.', "That's a choice.", 'Bold of you.', 'Read that back.', 'Not the serve.', 'Barely registered.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Rough draft energy.', 'Work in progress.', 'Almost something.'],
    medium: ['Main character: denied.', 'Not fooling anyone.', 'Reality check.', "Nobody's buying it.", 'Try a different personality.', 'The room noticed.', 'Wrong energy.', "This isn't landing.", 'Not the flex.', 'Timeline is watching.', 'Public record now.', 'Rent-free embarrassment.'],
    heavy:  ['Receipts are public.', 'Reality won.', 'Case closed.', 'Audience left early.', 'Your confidence is a rumor.', 'Exhibit A.', 'Group chat verified.', 'Screenshot-worthy.', 'Trending for the wrong reasons.', 'Posted and proven.', 'Forwarded with context.', 'The jury rested.'],
  },
  'social energy': {
    lite:   ["That's a choice.", 'Be serious.', 'Bold move.', 'Read that back.', 'Not the serve.', 'Barely registered.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Almost something.', 'Work in progress.', 'Participation trophy.'],
    medium: ["Nobody's buying it.", 'Not fooling anyone.', "This isn't landing.", 'The room noticed.', 'Social experiment failed.', 'Respectfully: no.', "Nobody asked.", 'Wrong audience.', 'Not the flex.', 'Timeline is watching.', 'Rent-free embarrassment.', 'Public record now.'],
    heavy:  ['Group chat verified.', 'Crowd went silent.', 'Evidence submitted.', 'Your confidence is a rumor.', 'Screenshot-worthy.', 'Posted and proven.', 'Exhibit A.', 'Reality won.', 'Trending for the wrong reasons.', 'Permanently archived.', 'Forwarded with context.', 'The jury rested.'],
  },
  'try-hard intensity': {
    lite:   ['Be serious.', "That's a choice.", 'Bold of you.', 'Read that back.', 'Not the serve.', 'Barely counts.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Almost something.', 'Rough draft energy.', 'Participation trophy.'],
    medium: ['Not fooling anyone.', 'Main character: denied.', "Nobody's buying it.", 'Try a different personality.', 'The room noticed.', 'Wrong energy.', "This isn't landing.", 'Social experiment failed.', 'Not the flex.', 'Timeline is watching.', 'Rent-free embarrassment.', 'Public record now.'],
    heavy:  ['Receipts are public.', 'Reality won.', 'Group chat verified.', 'Case closed.', 'Your confidence is a rumor.', 'Exhibit A.', 'Screenshot-worthy.', 'Posted and proven.', 'Trending for the wrong reasons.', 'Permanently archived.', 'Forwarded with context.', 'The jury rested.'],
  },
};

// Generic fallback mic-drops (tiered)
const NUCLEAR_MICDROPS_GENERIC = {
  lite:   ["That's a choice.", 'Be serious.', 'Bold of you.', 'Read that back.', 'Not the serve.', 'Barely registered.', "Didn't land.", 'Swing and a miss.', 'Off-brand energy.', 'Almost something.', 'Rough draft energy.', 'Participation trophy.'],
  medium: ['Not fooling anyone.', "This isn't landing.", 'Respectfully: no.', 'The room noticed.', "Nobody asked.", "Nobody's buying it.", 'Wrong audience.', 'Try a different personality.', 'Not the flex.', 'Timeline is watching.', 'Rent-free embarrassment.', 'Public record now.'],
  heavy:  ['Receipts are public.', 'Group chat verified.', 'Reality won.', 'Case closed.', 'Your confidence is a rumor.', 'Screenshot-worthy.', 'Exhibit A.', 'Posted and proven.', 'Trending for the wrong reasons.', 'Permanently archived.', 'Forwarded with context.', 'The jury rested.'],
};

// Mic-drop rotation: avoid repeating recent picks
const recentMicdrops = [];
const MAX_RECENT_MICDROPS = 14;
const last2Micdrops = []; // hard anti-repeat for last 2 calls

// Infer lane from roast text keywords
const MICDROP_LANE_INFERENCE = [
  { lane: 'camera angle', tokens: ['camera', 'angle', 'selfie', 'lens', 'tilt', 'framing'] },
  { lane: 'grooming', tokens: ['hair', 'ponytail', 'barber', 'groom', 'gel', 'frizz', 'trim', 'unkempt'] },
  { lane: 'outfit', tokens: ['hoodie', 'shirt', 't-shirt', 'jacket', 'plaid', 'outfit', 'clothes', 'wardrobe', 'robe', 'fit'] },
  { lane: 'setting/background', tokens: ['garage', 'background', 'room', 'lighting', 'setup', 'backdrop', 'scene', 'corner'] },
  { lane: 'posture', tokens: ['posture', 'slouch', 'stance', 'spine', 'hunched', 'lean'] },
  { lane: 'effort level', tokens: ['effort', 'try-hard', 'energy', 'lazy', 'barely', 'minimum', 'all-nighters'] },
  { lane: 'expression', tokens: ['expression', 'stare', 'smirk', 'pout', 'blank', 'glare', 'squint'] },
  { lane: 'confidence gap', tokens: ['confidence', 'swagger', 'ego', 'bold', 'front', 'delusion', 'main character'] },
  { lane: 'social energy', tokens: ['charisma', 'presence', 'awkward', 'social', 'rizz', 'vibe'] },
  { lane: 'try-hard intensity', tokens: ['rehearsed', 'desperate', 'overcompensate', 'forcing', 'performing'] },
];

function inferLaneFromText(text) {
  const lower = text.toLowerCase();
  let bestLane = null;
  let bestHits = 0;
  for (const { lane, tokens } of MICDROP_LANE_INFERENCE) {
    const hits = tokens.filter(t => lower.includes(t)).length;
    if (hits > bestHits) { bestHits = hits; bestLane = lane; }
  }
  return bestLane;
}

const SPICE_LANES = ['confidence gap', 'try-hard intensity', 'social energy'];

function pickMicdrop(lane, roastText, score) {
  const dev = process.env.NODE_ENV !== 'production';
  // Use inferred lane if lane is missing or not in NUCLEAR_MICDROPS
  let effectiveLane = lane;
  if (roastText && (!effectiveLane || !NUCLEAR_MICDROPS[effectiveLane])) {
    effectiveLane = inferLaneFromText(roastText) || effectiveLane;
  }
  // Also infer if text strongly suggests a different lane
  if (roastText && effectiveLane) {
    const inferred = inferLaneFromText(roastText);
    if (inferred && inferred !== effectiveLane && NUCLEAR_MICDROPS[inferred]) {
      effectiveLane = inferred;
    }
  }
  // Determine micdrop tier from candidate score
  let micdropTier = score >= 175 ? 'heavy' : score >= 135 ? 'medium' : 'lite';
  // Spice rule: 35% chance to bump to heavy for high-energy lanes
  let spiced = false;
  if (micdropTier === 'medium' && score >= 155 && SPICE_LANES.includes(effectiveLane) && Math.random() < 0.35) {
    micdropTier = 'heavy';
    spiced = true;
    if (dev) console.log(`[nuclear] micdrop spice-up -> heavy`);
  }
  const laneObj = NUCLEAR_MICDROPS[effectiveLane] || NUCLEAR_MICDROPS_GENERIC;
  // Combine recency + last2 for filtering
  const blocked = new Set([...recentMicdrops, ...last2Micdrops]);
  // Pick from target tier; fall back heavy → medium → lite
  const tierFallback = micdropTier === 'heavy' ? ['heavy', 'medium', 'lite']
    : micdropTier === 'medium' ? ['medium', 'heavy', 'lite']
    : ['lite', 'medium', 'heavy'];
  let pick = null;
  let usedTier = micdropTier;
  for (const t of tierFallback) {
    const tierList = laneObj[t] || [];
    const available = tierList.filter(m => !blocked.has(m));
    if (available.length) {
      pick = available[Math.floor(Math.random() * available.length)];
      usedTier = t;
      break;
    }
  }
  // Last resort: ignore recency
  if (!pick) {
    const allTier = laneObj[micdropTier] || laneObj['medium'] || laneObj['lite'] || [];
    pick = allTier[Math.floor(Math.random() * allTier.length)] || 'Be serious.';
    usedTier = micdropTier;
  }
  recentMicdrops.push(pick);
  if (recentMicdrops.length > MAX_RECENT_MICDROPS) recentMicdrops.shift();
  last2Micdrops.push(pick);
  if (last2Micdrops.length > 2) last2Micdrops.shift();
  return { text: pick, tier: usedTier, spiced };
}

const NUCLEAR_POETIC_CLOSER_BANS = [
  'drowned', 'shadows', 'invitation', 'beneath', 'echo', 'deserted', 'whisper',
];

const NUCLEAR_CLOSER_SOFT_BANS = [
  'non-existent', 'unavailable', 'took a break', 'forgot its invitation',
  'beneath shadows', 'drowned out', 'critically endangered',
  'extinct', 'deceased', 'dead', 'drowned', 'long extinct',
];

const NUCLEAR_VIRAL_BANS = [
  // Substance / intoxication
  'hungover', 'drunk', 'wasted', 'stoned', 'tweaking', 'coked', 'meth', 'weed',
  'sober up', 'rehab', 'detox', 'bender', 'blacked out', 'blackout',
  // Medical / diagnostic / therapy
  'warning sign', 'diagnosis', 'clinically', 'therapy', 'needs help', 'seek help',
  'personality warning sign', 'personality disorder', 'mental', 'unwell',
  'symptoms', 'condition', 'disorder', 'prescription',
  // Template crutches kept as hard bans (stronger AI-isms)
  "it's giving",
];

// Softened crutch words: scored down instead of hard-rejected
const NUCLEAR_SOFT_CRUTCHES = [
  'vibes', 'radiates',
  'clearly', 'you clearly', 'scream', 'screams', 'screaming',
];

// Stylistic connective verbs: mild scoring penalty, never hard-rejected
const NUCLEAR_CONNECTIVE_PENALTY = [
  'reads as', 'lands as', 'comes off as', 'registers as', 'signals',
];

const SAVAGE_IMPERATIVES = [
  'upgrade', 'fix', 'try', 'go', 'get', 'stop', 'start', 'learn',
];

const SAVAGE_CRUTCHES = [
  'giving off', 'major', 'vibes', 'that shirt says', 'that face says',
  'that smile says', 'that look says', 'that stare says', 'that pose says',
  'but your', "but it's",
];

const SAVAGE_ENV_TOKENS = ['garage', 'room', 'setup', 'lighting', 'background', 'wall', 'car'];
const SAVAGE_PERSONAL_ANCHORS = ['nose', 'eyes', 'jaw', 'hair', 'posture', 'stance', 'shirt', 'hoodie', 'outfit', 'smile', 'stare'];
const SAVAGE_BLEAK = ['defeated', 'tragic', 'gives up', 'give up', 'hopeless'];

const SAVAGE_BANNED_PHRASES = [
  // template openers GPT-4o loves
  "i've seen brighter", 'that face just called', 'with that lighting',
  'you look like', 'one bad audition', 'sleep-deprived extra',
  // scene/horror framing
  'dimly lit shed', 'warehouse', 'interrogated', 'interrogation',
  // advice framing
  "it's time to", 'time to', 'you should', 'you need to',
  'do better', 'fix that', 'upgrade both', 'try again', 'start over',
  // soft observational AI starters
  'screams', "it's like", 'your expression screams',
  "i've seen", 'in this photo', 'this image', "you're the type",
  // additional AI template openers
  'your vibe', "it's giving", 'energy of',
  'giving me', 'major', 'the aesthetic',
  // friendly filler
  'my friend', 'pal', 'buddy', 'champ', 'genius',
  // repeating templates
  'your enthusiasm', 'your motivation', "can't light up your",
  'brighter than your enthusiasm', 'update failures',
];

const SAVAGE_BANNED_WORDS = [
  'alive', 'lifeless', 'hollow', 'void', 'desperate', 'lonely',
  'dead-eyed', 'soulless', 'empty',
];

const SAVAGE_BANNED_WORTHLESSNESS = [
  'not worth', "you're not worth", 'you are not worth', 'worthless',
  'no value', 'value-less', 'no one cares', 'nobody cares',
  'irrelevant', 'unmissed', 'forgotten',
];

const SAVAGE_EXISTENTIAL_BANS = [
  'about life', 'life', 'hope', 'gave up hope', 'gave up', 'no hope',
  'regrets this decision', 'regret', 'meaning', 'existence', 'existential',
  'purpose', 'soul', 'soulless', 'dead inside', 'worth', 'worthless',
];

const SAVAGE_YOU_ANCHORS = [
  'face', 'eyes', 'smile', 'stare', 'posture', 'pose', 'hair', 'outfit',
  'shirt', 'hoodie', 'jacket', 'glasses', 'mouth', 'chin', 'jaw', 'stance',
];

const SAVAGE_ENV_OPENERS = [
  'that wall', 'that room', 'that garage', 'that setup', 'that background',
  'even your garage', 'even your room', 'even your setup', 'even this room',
  'your garage', 'your room', 'your setup', 'the wall', 'the room', 'the garage',
];

// Ego/effort signal: used as scoring preference (not hard reject)
const SAVAGE_EGO_TOKENS = [
  'effort', 'trying', 'try-hard', 'tryhard', 'trying too hard',
  'rehears', 'overconfident', 'confident', 'confidence',
  'pretend', 'posing', 'forced', 'audition', 'perform', 'cosplay',
  'delusion', 'cope', 'ego', 'validation', 'attention',
  'overcompensat', 'overcompens',
  'bored', 'unimpressed', 'poker face', 'unearned', 'delusional',
  'tough', 'intimidat', 'serious', 'chip on', 'trying to',
  'acting', 'fronting', 'bravado', 'swagger', 'thinks',
];

// Overused tokens: not hard-banned but heavily penalized in scoring
const SAVAGE_OVERUSED_TOKENS = [
  'expression', 'personality', 'lighting', 'energy', 'vibe',
  'aura', 'presence', 'effort', 'attempt',
];

// Punch ending words: reward when savage last word is one of these
const SAVAGE_PUNCH_ENDINGS = [
  'pathetic', 'tragic', 'embarrassing', 'cringe', 'weak', 'sad',
  'rough', 'brutal', 'painful', 'mid', 'unforgivable', 'criminal',
  'audacity', 'offensive', 'insulting', 'bleak', 'haunting',
  'disappointed', 'wrong', 'worse', 'bold', 'coward', 'fraud',
  // verdict / ego-exposure closers
  'delusion', 'tryhard', 'try-hard', 'awkward', 'budget', 'discount', 'expired',
  'unfinished', 'unconvincing', 'secondhand',
];

// Savage V2: strong closing words for organic micdrop scoring (sentence 2)
const SAVAGE_MICDROP_STRONG_WORDS = [
  'audience', 'drafts', 'private', 'enough', 'mistake',
  'embarrassing', 'serious', 'subtle', 'subtlety', 'convincing',
  'believable', 'bold', 'careful', 'awkward', 'unfortunate', 'choice',
  'pass', 'refund', 'declined', 'quiet', 'silence', 'visible',
  'noted', 'obvious', 'permanent', 'unrecoverable', 'tragic',
];
const SAVAGE_MICDROP_WEAK_WORDS = ['nice', 'okay', 'fine', 'maybe', 'perhaps', 'probably'];
// Imperative verbs banned from sentence 2 start (commands aren't micdrops)
const SAVAGE_S2_BANNED_IMPERATIVES = [
  'delete', 'log', 'stop', 'quit', 'try', 'go', 'leave', 'get', 'fix', 'change', 'do',
];

// --- Medium V2 constants ---
const MEDIUM_BANNED_OPENERS = [
  'try', 'fix', 'go', 'stop', 'get', 'change', 'should', 'need', 'learn',
];

const MEDIUM_TEMPLATE_CRUTCHES = [
  'your vibe', 'energy', 'aura', "it's giving", 'giving off', 'vibes', 'giving me',
];

const MEDIUM_EFFORT_WORDS = [
  'rehearsed', 'trying', 'flex', 'posed', 'staged', 'confident', 'glow-up',
  'comeback', 'thought this was', 'called this', 'effort', 'practice',
];

const MEDIUM_WEAK_WORDS = ['nice', 'okay', 'fine', 'kinda', 'maybe'];

// (MEDIUM_STYLE_HINTS removed — old 12-call LLM pipeline replaced by template engine)

// --- Mild V2 constants ---
const MILD_BANNED_OPENERS = [
  'try', 'fix', 'go', 'stop', 'get', 'change', 'should', 'need', 'learn',
];

const MILD_TEMPLATE_CRUTCHES = [
  'your vibe', 'energy', 'aura', "it's giving", 'giving off', 'vibes', 'giving me',
];

const MILD_WEAK_WORDS = ['nice', 'okay', 'fine', 'kinda', 'maybe'];

const MILD_HARSH_WORDS = [
  'pathetic', 'worthless', 'disgusting', 'hideous', 'ugly', 'repulsive',
  'loser', 'failure', 'disaster', 'hopeless', 'tragic', 'depressing',
  'nobody cares', 'existential', 'better days',
];

// Mild V2: style diversity hints (rotated per request)
// --- Mild V2 Structure Templates (1-sentence, {TARGET} + {OBSERVATION}) ---
// Each template has [singular, plural] variants for grammar correctness.
const MLV2_STRUCTURE_TEMPLATES = [
  // ── FAMILY: THAT (pointing out) ──
  { id: 'L01', tpl: ['That {TARGET} {OBSERVATION}.', 'Those {TARGET} {OBSERVATION}.'] },
  { id: 'L04', tpl: ['That {TARGET} is doing a little extra today.', 'Those {TARGET} are doing a little extra today.'] },
  { id: 'L09', tpl: ['That {TARGET} showed up early and the photo noticed.', 'Those {TARGET} showed up early and the photo noticed.'] },
  { id: 'L19', tpl: ['That {TARGET} made a quiet entrance and stayed.', 'Those {TARGET} made a quiet entrance and stayed.'] },
  { id: 'L22', tpl: ['That {TARGET} came with more confidence than support.', 'Those {TARGET} came with more confidence than support.'] },
  { id: 'L25', tpl: ['That {TARGET} had an idea and the camera caught it.', 'Those {TARGET} had an idea and the camera caught it.'] },
  { id: 'L28', tpl: ['That {TARGET} is not even trying to be subtle.', 'Those {TARGET} are not even trying to be subtle.'] },

  // ── FAMILY: THE (observational) ──
  { id: 'L02', tpl: ['The {TARGET} {OBSERVATION} and no one said a word.', 'The {TARGET} {OBSERVATION} and no one said a word.'] },
  { id: 'L05', tpl: ['The {TARGET} is running this whole photo.', 'The {TARGET} are running this whole photo.'] },
  { id: 'L10', tpl: ['The {TARGET} noticed the camera before you did.', 'The {TARGET} noticed the camera before you did.'] },
  { id: 'L15', tpl: ['The {TARGET} {OBSERVATION} quietly.', 'The {TARGET} {OBSERVATION} quietly.'] },
  { id: 'L20', tpl: ['The {TARGET} is doing the heavy lifting here.', 'The {TARGET} are doing the heavy lifting here.'] },
  { id: 'L26', tpl: ['The {TARGET} showed up and immediately took over.', 'The {TARGET} showed up and immediately took over.'] },

  // ── FAMILY: YOUR (gentle address) ──
  { id: 'L03', tpl: ['Your {TARGET} {OBSERVATION} and the photo kept it.', 'Your {TARGET} {OBSERVATION} and the photo kept it.'] },
  { id: 'L06', tpl: ['Your {TARGET} arrived with a whole plan.', 'Your {TARGET} arrived with a whole plan.'] },
  { id: 'L11', tpl: ['Your {TARGET} {OBSERVATION} a little.', 'Your {TARGET} {OBSERVATION} a little.'] },
  { id: 'L16', tpl: ['Your {TARGET} is giving you away just slightly.', 'Your {TARGET} are giving you away just slightly.'] },
  { id: 'L21', tpl: ['Your {TARGET} brought its own agenda to this.', 'Your {TARGET} brought their own agenda to this.'] },
  { id: 'L27', tpl: ['Your {TARGET} {OBSERVATION} and honestly good for it.', 'Your {TARGET} {OBSERVATION} and honestly good for it.'] },

  // ── FAMILY: INDIRECT (situation as subject) ──
  { id: 'L07', tpl: ['Something about the {TARGET} {OBSERVATION}.', 'Something about the {TARGET} {OBSERVATION}.'] },
  { id: 'L08', tpl: ['Not sure the {TARGET} got the memo.', 'Not sure the {TARGET} got the memo.'] },
  { id: 'L12', tpl: ['The photo almost worked and then the {TARGET} got involved.', 'The photo almost worked and then the {TARGET} got involved.'] },
  { id: 'L13', tpl: ['Everything else is cooperating except the {TARGET}.', 'Everything else is cooperating except the {TARGET}.'] },
  { id: 'L18', tpl: ['Somebody let that {TARGET} into the frame unsupervised.', 'Somebody let those {TARGET} into the frame unsupervised.'] },
  { id: 'L23', tpl: ['The rest of the photo is behaving and the {TARGET} is not.', 'The rest of the photo is behaving and the {TARGET} are not.'] },
  { id: 'L24', tpl: ['Nobody warned the {TARGET} this was a photo.', 'Nobody warned the {TARGET} this was a photo.'] },
];

const MLV2_TEMPLATE_FAMILY = {
  L01: 'FAMILY_THAT', L04: 'FAMILY_THAT', L09: 'FAMILY_THAT',
  L19: 'FAMILY_THAT', L22: 'FAMILY_THAT', L25: 'FAMILY_THAT',
  L28: 'FAMILY_THAT',
  L02: 'FAMILY_THE', L05: 'FAMILY_THE', L10: 'FAMILY_THE',
  L15: 'FAMILY_THE', L20: 'FAMILY_THE', L26: 'FAMILY_THE',
  L03: 'FAMILY_YOUR', L06: 'FAMILY_YOUR', L11: 'FAMILY_YOUR',
  L16: 'FAMILY_YOUR', L21: 'FAMILY_YOUR', L27: 'FAMILY_YOUR',
  L07: 'FAMILY_INDIRECT', L08: 'FAMILY_INDIRECT', L12: 'FAMILY_INDIRECT',
  L13: 'FAMILY_INDIRECT', L18: 'FAMILY_INDIRECT', L23: 'FAMILY_INDIRECT',
  L24: 'FAMILY_INDIRECT',
};

// --- Mild V2 Observations (gentle, playful — no judgments) ---
const MLV2_OBSERVATION_POOL = [
  // noticed
  'is trying its best', 'came with confidence', 'showed up uninvited',
  'is pulling focus', 'is doing a lot right now',
  // gentle surprise
  'took the spotlight', 'set the tone immediately',
  'got there first', 'stole the scene a little', 'made itself known',
  // light commentary
  'is on its own journey', 'is having a moment', 'chose to participate',
  'went for it', 'decided today was the day',
  'is working with what it has', 'picked a side',
  // soft contradiction
  'almost blended in', 'nearly went unnoticed', 'tried to be subtle',
  'wanted to cooperate but did not', 'was close to landing',
  // playful escalation
  'came in hot', 'is not reading the room', 'has opinions',
  'brought the whole performance', 'is freelancing',
];

// --- Mild V2 Targets (same visible features, lighter selection) ---
const MLV2_TARGET_POOL = [
  'smile', 'angle', 'expression', 'pose', 'background', 'lighting',
  'outfit', 'hair', 'stance', 'crop', 'head tilt', 'grin',
  'squint', 'shirt', 'hoodie', 'glasses', 'hat', 'collar',
  'eyebrows', 'jacket', 'shadow', 'posture', 'stare',
];

const MLV2_SAFE_FALLBACKS = [
  'That angle is doing something and honestly good for it.',
  'The lighting showed up with more confidence than expected.',
  'Something about this photo is working really hard.',
  'The background is minding its own business and thriving.',
  'That pose came with a plan and almost stuck the landing.',
];

const MLV2_LOCAL_CANDIDATES = 10;

// Savage V2: verdict framing starters for sentence 1 (scoring bonus)
const SAVAGE_VERDICT_STARTERS = [
  'you posted this', 'you framed this', 'you aimed for',
  "this isn't", 'not a flex', 'you thought this', 'you called this',
];

// Comparison templates that savage must never use (hard reject + selection filter)
const SAVAGE_COMPARISON_TEMPLATES = [
  /\beven your\b/i,
  /\btrying harder than\b/i,
  /\bmore\s+(lit|alive|interesting|animated)\s+than\s+(you|your)\b/i,
  /\bbrighter than your\b/i,
  /\bcan'?t\s+(light up|brighten)\b/i,
];

function hasSavageComparisonTemplate(text) {
  return SAVAGE_COMPARISON_TEMPLATES.some(re => re.test(text));
}

// Ego-exposure tokens for mini-nuclear structure detection
const SAVAGE_EGO_EXPOSURE_TOKENS = [
  'overcompensat', 'perform', 'performing', 'forced', 'fronting', 'bravado',
  'swagger', 'audition', 'delusion', 'delusional', 'try-hard', 'tryhard',
  'posing', 'validation', 'attention', 'rehearsed', 'pretending', 'staged',
];

const FALLBACKS = {
  mild: [
    "That angle was a creative choice but the lighting had other plans.",
    "The pose is giving main character in a very quiet movie.",
    "That smile took a few attempts and honestly it shows a little.",
    "The background is working harder than the outfit in this one.",
    "That expression landed somewhere between confident and confused.",
    "The lighting saved this photo and it deserves a thank you.",
    "That outfit committed to something but the pose did not follow.",
  ],
  medium: [
    "That angle took more planning than the outfit itself. The photo still chose violence anyway.",
    "You posed like this was going on a billboard. The background tells a different story.",
    "The confidence came through but the execution did not. Everyone can see the gap.",
    "You dressed for an occasion that clearly never arrived. The outfit is still waiting.",
    "This took multiple attempts and somehow this won the audition. The bar was underground.",
    "The lighting is carrying this entire photo on its back. Everything else showed up empty.",
    "That smile says rehearsed but the result says unrehearsed. The camera caught every bit of it.",
  ],
  savage: [
    "You posted this like it was a flex and it absolutely was not. Sit down.",
    "You framed this like a highlight reel but the footage disagrees. Delete it.",
    "You aimed for effortless and landed on aimless with that angle. Be serious.",
    "You called this your good side but that grin says otherwise. Try again.",
    "You thought this lighting would save you but it just exposed more. Log off.",
    "You posted this outfit like a statement but the statement is unclear. Wrong audience.",
    "You framed this smile like it was candid but it looks rehearsed. Stay in drafts.",
    "You aimed for intimidating but that posture tells a different story. Not today.",
    "You thought this pose was giving confidence but it gave the opposite. Case closed.",
    "You called this angle flattering but the camera saw through it. Be serious.",
  ],
  nuclear: [
    "Your expression is rehearsed but your eyes forgot the script. Nobody taught you how to be genuine.",
    "That posture says you've been performing confidence so long you forgot you don't have any. It shows.",
    "The background is more interesting than you are. You know that already.",
  ],
};

// Track recently used themes to avoid repetition across calls
const recentThemes = [];
const MAX_RECENT_THEMES = 15;

// Track recent savage roasts to penalize repetition across calls
const recentSavageRoasts = [];
const MAX_RECENT_SAVAGE = 20;

// Track recent savage anchors to penalize anchor repetition
const recentSavageAnchors = [];
const MAX_RECENT_ANCHORS = 12;

// Token overlap score: 0–1 Jaccard similarity (shared / union), stopwords removed
const OVERLAP_STOPWORDS = new Set(['a','an','the','and','or','but','you','your','youre','youve','youll','that','this','with','for','from','its','are','was','were','has','have','had','not','just','like','than','too','very','into','about','been','they','them','their','would','could','should','even','also','still','only']);
function tokenOverlap(a, b) {
  const tokenize = (s) => new Set(
    s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
      .filter(w => w.length > 2 && !OVERLAP_STOPWORDS.has(w))
  );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) { if (setB.has(w)) shared++; }
  const union = new Set([...setA, ...setB]).size;
  return shared / union;
}

function normalizeForOverlap(s) {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Detect model refusal / policy text that should never be returned as a roast
function isRefusalLike(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  return (
    t.includes("i'm sorry") ||
    t.includes("i am sorry") ||
    t.includes("i can't assist") ||
    t.includes("i cannot assist") ||
    t.includes("can't help with that") ||
    t.includes("cannot help with that") ||
    t.includes("unable to help") ||
    t.includes("unable to comply") ||
    t.includes("as an ai") ||
    t.includes("i can't comply") ||
    t.includes("i cannot comply") ||
    t.includes("i can't do that") ||
    t.includes("i cannot do that") ||
    t.includes("request goes against") ||
    t.includes("violates policy") ||
    t.includes("policy") ||
    t.includes("guidelines")
  );
}

// Detect identity-uncertainty / assistanty phrasing that should never appear in a roast
function isIdentityUncertainty(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return (
    t.includes("who this is") ||
    t.includes("who that is") ||
    t.includes("i can't tell") ||
    t.includes("i cannot tell") ||
    t.includes("i don't know who") ||
    t.includes("i do not know who") ||
    t.includes("i'm not sure") ||
    t.includes("i am not sure") ||
    t.includes("i'll focus on") ||
    t.includes("i will focus on") ||
    t.includes("i can help") ||
    t.includes("i'm here to help") ||
    t.includes("i am here to help") ||
    t.includes("but it looks like") ||
    t.includes("but i'll focus") ||
    t.includes("let me focus")
  );
}

// Fast-path check: can we skip the expensive LLM polish call for this skeleton?
function canSkipPolish(text, tier) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  // Must end with punctuation
  if (!/[.!?]$/.test(trimmed)) return false;
  // No refusal / identity uncertainty / banned patterns
  if (isRefusalLike(trimmed) || isIdentityUncertainty(trimmed)) return false;
  if (nv2HasBannedPatterns(trimmed)) return false;
  if (!isPlaySafe(trimmed)) return false;
  // Must not contain raw template markers
  if (trimmed.includes('{') || trimmed.includes('}')) return false;

  const wc = trimmed.split(/\s+/).length;
  if (tier === 'mild') {
    // Sweet spot: 8–13 words, 1 sentence
    if (wc < 8 || wc > 13) return false;
    const sents = trimmed.match(/[.!?]+/g);
    if (!sents || sents.length !== 1) return false;
  } else if (tier === 'medium') {
    // Sweet spot: 9–16 words, 1 sentence
    if (wc < 9 || wc > 16) return false;
    const sents = trimmed.match(/[.!?]+/g);
    if (!sents || sents.length !== 1) return false;
  } else if (tier === 'savage') {
    // Sweet spot: 11–22 words, 1–2 sentences
    if (wc < 11 || wc > 22) return false;
    const sents = trimmed.match(/[.!?]+/g);
    if (!sents || sents.length < 1 || sents.length > 2) return false;
  } else {
    return false;
  }
  return true;
}

// Replace any refusal-like roasts in an array with a tier-appropriate fallback
function filterRefusals(roasts, tierName) {
  const tierFallbacks = FALLBACKS[tierName] || FALLBACKS.medium;
  return roasts.map(r => {
    if (isRefusalLike(r)) {
      console.log(`[roast] refusalRejected=true`, { tier: tierName, text: r.slice(0, 80) });
      return tierFallbacks[Math.floor(Math.random() * tierFallbacks.length)];
    }
    return r;
  });
}

// Extract sentence 2 from a roast (second non-empty sentence, or "" if <2 sentences)
function getSentence2(text) {
  const sents = text.match(/[^.!?]*[.!?]+/g);
  if (!sents || sents.length < 2) return '';
  const s2 = sents[1].trim();
  return s2 || '';
}

// Normalize roast text for deduplication (strips punctuation, collapses whitespace)
function normalizeRoast(text) {
  return text.toLowerCase().trim().replace(/[.,!?:;"'()\[\]{}\-—]/g, '').replace(/\s+/g, ' ').trim();
}

function pushRecentSavage(text) {
  if (!text) return;
  recentSavageRoasts.push(text.toLowerCase());
  while (recentSavageRoasts.length > MAX_RECENT_SAVAGE) recentSavageRoasts.shift();
}

// Track recent nuclear roasts to penalize repetition across calls
const recentNuclearRoasts = [];
const MAX_RECENT_NUCLEAR = 20;

function pushRecentNuclear(text) {
  if (!text) return;
  recentNuclearRoasts.push(text.toLowerCase());
  while (recentNuclearRoasts.length > MAX_RECENT_NUCLEAR) recentNuclearRoasts.shift();
}

// Track recent medium roasts to penalize repetition across calls
const recentMediumRoasts = [];
const MAX_RECENT_MEDIUM = 25;

function pushRecentMedium(text) {
  if (!text) return;
  recentMediumRoasts.push(text.toLowerCase());
  while (recentMediumRoasts.length > MAX_RECENT_MEDIUM) recentMediumRoasts.shift();
}

// Track recent mild roasts to penalize repetition across calls
const recentMildRoasts = [];
const MAX_RECENT_MILD = 20;

function pushRecentMild(text) {
  if (!text) return;
  recentMildRoasts.push(text.toLowerCase());
  while (recentMildRoasts.length > MAX_RECENT_MILD) recentMildRoasts.shift();
}

// Nuclear-v2 global anti-repeat helpers (reuse recentNuclearRoasts pool)
function getRecentNuclearNormSet() {
  return new Set(recentNuclearRoasts.map(r => normalizeRoast(r)));
}
function maxRecentOverlap(candidate) {
  let max = 0;
  for (const prev of recentNuclearRoasts) {
    const o = tokenOverlap(candidate, prev);
    if (o > max) max = o;
  }
  return max;
}
function isRecentNuclearRepeat(candidate) {
  if (!candidate || recentNuclearRoasts.length === 0) return false;
  if (getRecentNuclearNormSet().has(normalizeRoast(candidate))) return true;
  if (maxRecentOverlap(candidate) >= 0.60) return true;
  // Sentence-1 overlap: block if sentence 1 is too similar to any recent roast's sentence 1
  const candS1 = getSentence1(candidate);
  if (candS1) {
    for (const prev of recentNuclearRoasts) {
      const prevS1 = getSentence1(prev);
      if (prevS1 && tokenOverlap(candS1, prevS1) >= 0.55) return true;
    }
  }
  return false;
}

// Extract sentence 1 from a roast (first non-empty sentence)
function getSentence1(text) {
  if (!text) return '';
  const sents = text.match(/[^.!?]*[.!?]+/g);
  return sents ? sents[0].trim() : text.trim();
}

// Check if sentence 1 contains at least one anchor token from candidates
function nv2HasAnyAnchorToken(sentence, anchorCandidates) {
  if (!sentence || !anchorCandidates || anchorCandidates.length === 0) return true; // no candidates = pass
  const sLower = sentence.toLowerCase();
  for (const cand of anchorCandidates) {
    if (!cand) continue;
    // Split multi-word candidates into individual tokens; match if ANY token appears
    const tokens = cand.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    for (const tok of tokens) {
      if (sLower.includes(tok)) return true;
    }
  }
  return false;
}

// Detect soft/hedging language in sentence 1 of a nuclear-v2 result
const NV2_SOFT_PATTERNS = [
  'your vibe', 'your energy', 'your aura', "it's giving", "its giving",
  'giving me', 'with that', 'not sure if', 'when your',
];
const NV2_SOFT_REGEX = /\bmajor\s+\S+\s+energy\b/i;
function s1IsSoft(result) {
  if (!result) return false;
  const sents = result.match(/[^.!?]*[.!?]+/g);
  const s1 = sents ? sents[0].trim().toLowerCase() : result.toLowerCase();
  return NV2_SOFT_PATTERNS.some(p => s1.includes(p)) || NV2_SOFT_REGEX.test(s1);
}

// Nuclear lane rotation: force varied topical anchors across calls
const NUCLEAR_LANES = [
  'expression', 'posture', 'grooming', 'outfit', 'setting/background',
  'camera angle', 'effort level', 'confidence gap', 'social energy', 'try-hard intensity',
];
let recentNuclearLanes = [];
const MAX_RECENT_LANES = 4;

// Outfit cooldown: track last 4 nuclear winners for shirt/outfit saturation
const recentNuclearOutfitFlags = []; // true/false per recent winner
const MAX_OUTFIT_TRACK = 4;

// (Nuclear anchor keywords removed — anchors are now built dynamically from the detail pack)

// Module-level: track last target category for graphic-tee rotation
let lastNuclearTargetCategory = null;
let lastNuclearFinalText = '';

// Normalize text for anchor matching: lowercase, strip quotes/punctuation, collapse spaces
function _normAnchor(s) {
  if (!s || typeof s !== 'string') return '';
  return s.toLowerCase()
    .replace(/[\u201C\u201D"]/g, '')                   // double quotes only (keep apostrophes)
    .replace(/[^\w\s-]/g, ' ')                        // punctuation -> space (keep hyphens)
    .replace(/\s+/g, ' ')
    .trim();
}

const _RAW_ANCHOR_STOPLIST = new Set([
  'dim', 'bright', 'mixed', 'centered', 'straight on', 'straight-on',
  'office', 'garage', 'outdoors', 'unknown',
]);
const _RAW_ANCHOR_FALLBACKS = [
  'graphic tee', 'blank', 'deadpan', 'flat hair', 'parted',
  'clean-shaven', 'unshaved', 'lived-in', 'bare',
];

// Check if raw GPT output is already valid nuclear (skip downstream rewrites)
function isRawAcceptableNuclear(text, { tags, target, selfieAttrTargets, sceneTargets, modifierPhrase }) {
  const dbg = process.env.DEBUG_NUCLEAR_RAW === '1';
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    if (dbg) console.log('[nuclear-v2] rawAccepted=false reason=empty');
    return false;
  }
  const sents = text.trim().match(/[^.!?]*[.!?]+/g);
  if (!sents || sents.length !== 2) {
    if (dbg) console.log(`[nuclear-v2] rawAccepted=false reason=sentenceCount(${sents ? sents.length : 0})`);
    return false;
  }
  const wc = text.trim().split(/\s+/).length;
  if (wc < 10 || wc > 24) {
    if (dbg) console.log(`[nuclear-v2] rawAccepted=false reason=wordCount(${wc})`);
    return false;
  }
  const lower = text.toLowerCase();
  if (/\b(sorry|can't assist|cannot help|i apologize|as an ai)\b/.test(lower)) {
    if (dbg) console.log('[nuclear-v2] rawAccepted=false reason=refusalPattern');
    return false;
  }

  // Build anchor candidates from all available sources
  const rawCandidates = [
    target,
    tags.hair, tags.expression, tags.grooming, tags.lighting,
    tags.setting, tags.bg_vibe, tags.outfit, tags.pose,
    ...(selfieAttrTargets || []),
    ...((sceneTargets || []).slice(0, 4)),
  ];
  if (modifierPhrase) rawCandidates.push(modifierPhrase);
  // Normalize and filter
  const normRaw = _normAnchor(text);
  const candidates = rawCandidates
    .filter(Boolean)
    .map(c => _normAnchor(c))
    .filter(c => c.length >= 4 && !_RAW_ANCHOR_STOPLIST.has(c));
  // Deduplicate
  const uniqueCandidates = [...new Set(candidates)];

  // Check candidates
  let matchedAnchor = null;
  for (const c of uniqueCandidates) {
    if (normRaw.includes(c)) { matchedAnchor = c; break; }
  }
  // Fallback: check known selfie-tag anchors
  if (!matchedAnchor) {
    for (const fb of _RAW_ANCHOR_FALLBACKS) {
      if (normRaw.includes(_normAnchor(fb))) { matchedAnchor = fb; break; }
    }
  }

  if (dbg) console.log(`[nuclear-v2] rawAnchorCandidates=[${uniqueCandidates.join(', ')}] matched=${matchedAnchor || 'none'}`);
  if (!matchedAnchor) {
    if (dbg) console.log('[nuclear-v2] rawAccepted=false reason=noAnchorToken');
    return false;
  }
  if (dbg) console.log(`[nuclear-v2] rawAccepted=true anchor="${matchedAnchor}"`);
  return true;
}

function pickNuclearLane() {
  let available = NUCLEAR_LANES.filter(l => !recentNuclearLanes.includes(l));
  // Outfit cooldown: if >=2 of last 4 winners were outfit-flagged, exclude outfit
  const outfitCount = recentNuclearOutfitFlags.filter(Boolean).length;
  if (outfitCount >= 2) {
    const withoutOutfit = available.filter(l => l !== 'outfit');
    if (withoutOutfit.length > 0) available = withoutOutfit;
  }
  const pool = available.length ? available : NUCLEAR_LANES;
  const lane = pool[Math.floor(Math.random() * pool.length)];
  recentNuclearLanes.push(lane);
  if (recentNuclearLanes.length > MAX_RECENT_LANES) recentNuclearLanes.shift();
  return lane;
}

// Lane compliance keyword map
const LANE_KEYWORDS = {
  'posture': ['posture','slouch','stance','spine','shoulders','back','hunched','sag','lean'],
  'expression': ['expression','stare','face','eyes','smirk','pout','blank','glare'],
  'grooming': ['hair','ponytail','grooming','trim','barber','gel','unkempt','frizz'],
  'outfit': ['shirt','t-shirt','fit','outfit','clothes','look','style','wardrobe'],
  'camera angle': ['angle','camera','lens','selfie','tilt','framing'],
  'setting/background': ['garage','background','backdrop','room','lighting','scene','corner'],
  'social energy': ['energy','charisma','presence','awkward','social','rizz','vibe'],
  'confidence gap': ['confidence','swagger','ego','bold','brave','try','front'],
  'try-hard intensity': ['try-hard','trying','effort','forcing','rehearsed','desperate','overcompensate'],
  'effort level': ['effort','lazy','half','barely','minimum','work','practice'],
};

// Detect the primary anchor category of a savage roast
function detectSavageAnchor(text) {
  const lower = text.toLowerCase();
  const categories = [
    { name: 'face', tokens: ['nose', 'jaw', 'teeth', 'eyes', 'forehead', 'face', 'chin', 'mouth', 'cheek', 'brow'] },
    { name: 'hair', tokens: ['hair', 'hairline', 'bald', 'beard', 'mustache', 'bangs'] },
    { name: 'expression', tokens: ['expression', 'smile', 'smirk', 'grin', 'frown', 'stare', 'squint'] },
    { name: 'posture', tokens: ['posture', 'pose', 'stance', 'standing', 'sitting', 'leaning', 'arms', 'hands'] },
    { name: 'outfit', tokens: ['outfit', 'shirt', 'hoodie', 'jacket', 'glasses', 'hat', 'clothes', 'dressed'] },
    { name: 'setup', tokens: ['setup', 'monitor', 'screen', 'keyboard', 'desk', 'pc', 'computer', 'rgb'] },
    { name: 'lighting', tokens: ['lighting', 'shadow', 'glow', 'led', 'light'] },
    { name: 'car/garage', tokens: ['car', 'garage', 'hood', 'engine', 'tire', 'wheel', 'wrench', 'workshop', 'toolbox'] },
  ];
  for (const cat of categories) {
    if (cat.tokens.some(t => lower.includes(t))) return cat.name;
  }
  return 'other';
}

function pushRecentSavageAnchor(text) {
  const anchor = detectSavageAnchor(text);
  recentSavageAnchors.push(anchor);
  while (recentSavageAnchors.length > MAX_RECENT_ANCHORS) recentSavageAnchors.shift();
}

// Detect structural template fingerprint of a savage roast
function detectSavageStructure(text) {
  const lower = text.toLowerCase();
  const trimmed = lower.trim();
  if (/^even (your|the)\b/.test(trimmed)) return 'even-your-X';
  if (/more\s+\w+\s+than\s+(you|your)\b/.test(lower)) return 'X-more-than-you';
  if (/trying harder than (you|your)\b/.test(lower)) return 'X-trying-harder';
  if (/can'?t (light up|brighten)/.test(lower)) return 'cant-light-up';
  if (/your\s+\w+\s+is\s+\w+/.test(lower)) return 'your-X-is-doing';
  return 'direct-verdict';
}

// Track recent savage structures to penalize structural repetition
const recentSavageStructures = [];
const MAX_RECENT_STRUCTURES = 12;

function pushRecentSavageStructure(text) {
  const structure = detectSavageStructure(text);
  recentSavageStructures.push(structure);
  while (recentSavageStructures.length > MAX_RECENT_STRUCTURES) recentSavageStructures.shift();
}

function buildPrompt(config, tierName, avoidThemes) {
  let tierRules = '';
  if (tierName === 'medium') {
    tierRules = `
MEDIUM RULES:
- Write EXACTLY two sentences. Sentence 1 MUST end with a period. Sentence 2 MUST end with a period. No third sentence.
- 14–22 words total.
- Sentence 1: reference ONE visible detail (outfit, hair, pose, angle, background, expression, lighting).
- Sentence 2: escalate with social embarrassment or effort mismatch — the "oof" moment. NOT a short 2–3 word micdrop. Both sentences carry weight. Sentence 2 must be at least 4 words.
- Attack the decision or effort, not existence.
- No "you look like", no "looks like", no "vibe/energy/aura/it's giving/giving me".
- No questions. No advice or commands. No "you should".
- No emojis, no quote marks of any kind.
- End on the joke. Screenshotable.`;
  } else if (tierName === 'mild') {
    tierRules = `
MILD RULES:
- Write EXACTLY one sentence. It MUST end with a period. No second sentence.
- 8–14 words total.
- Reference ONE visible detail (outfit, hair, pose, angle, background, expression, lighting).
- Tone: light, playful, friendly tease. "Haha okay fair" energy.
- No "you look like", no "looks like", no "vibe/energy/aura/it's giving/giving me".
- No questions. No advice or commands.
- No emojis, no quote marks of any kind.
- No harsh or bleak language. Keep it Google Play safe.
- End on the joke. Shareable.`;
  } else if (tierName === 'savage') {
    tierRules = `
SAVAGE RULES (cold verdict + organic closer):
- EXACTLY 2 sentences. 11–22 words total.
- Sentence 1: cold verdict about their decision-making or self-perception, referencing ONE visible detail (outfit, posture, expression, hair, angle, lighting, background, etc.). Use "you" statements.
- Sentence 2: short decisive closer (1–4 words). Ends with a period. NOT a question, NOT a command, NOT advice. Must NOT contain "you" or "your". Should be specific to what's visible in the photo. Think verdict fragments like "Hard pass." "Not convincing." "Room went quiet." "Payment declined." — but write your own, do not copy these examples.
- No questions. No advice. No imperatives in sentence 1.
- No emojis, no quotes (no ' or "), no hashtags.
- NEVER use the phrase "you look like" or "looks like". These are banned.
- Do not use the phrases "screams" or "your expression".
- Sentence 1 should preferably start with one of these verdict-framing starters: "You posted this like …", "You framed this like …", "You aimed for …", "This isn't …", "That [detail] isn't …", "Not a flex …", "You called this …"
- Do NOT imply the person has no value, is forgotten, invisible, or hopeless.
- No existential despair or worthlessness language.
- Tone: cold, direct, humiliating. Screenshot-ready.`;
  } else if (tierName === 'nuclear') {
    tierRules = `
NUCLEAR RULES:
- Exactly 2 sentences. Output EXACTLY 2 sentences.
- Sentence 1: Call out a visible mistake or choice in the photo. Speak confidently as if the decision was deliberate. Be decisive and direct.
- Sentence 2: 2–4 words. Cold, final micdrop. Declarative. No emojis. No quotes.
- Roast presentation and visible choices only — NOT identity.
- No protected traits. No violence. No threats.
- No advice, commands, or imperatives.
- Humiliate effort, not existence.
- Do NOT imply the person has no value, is forgotten, invisible, or hopeless.
- Do NOT imply the subject should disappear, die, or not exist.
- Avoid existential despair or worthlessness language.
- NEVER use: ${BANNED_HEDGING.join(', ')}
- This must feel like the harshest thing someone could say while looking at this photo.`;
  }

  return `You are generating a roast based on a selfie image.

Tier: ${tierName}
Count: ${config.count}

GENERAL RULES (ALL MODES):
${tierName === 'nuclear'
    ? '- Start from visible details (expression, lighting, pose, background, hair, clothing), then escalate into character/personality/life-failure hits INFERRED from what you see.'
    : '- Base the roast ONLY on visible details (expression, lighting, pose, background, hair, clothing).'}
- Do NOT give advice. Do NOT give encouragement. Do NOT psychoanalyze.
- Do NOT explain the joke. Do NOT add emojis. Do NOT soften the insult.
- No moral commentary. No life coaching.
- No "you seem like". No "maybe". No therapy tone.
- Be confident. Be direct.
- Avoid these themes: ${avoidThemes}
- No hate speech, protected trait attacks, or illegal content.
- BANNED phrases (never use): ${BANNED_CLICHES.join(', ')}${tierRules}

OUTPUT FORMAT:
Respond with ONLY a valid JSON object — no markdown, no code fences, no extra text:
{"roasts": ["roast one", ...], "themes": ["theme1", ...]}

The "roasts" array must contain exactly ${config.count} string(s).
The "themes" array must contain one short theme tag per roast.
Output ONLY the JSON. No labels. No explanations.`;
}

// --- Hard enforcement: clamp roast to sentence + word + character limits ---
function clampRoast(text, maxSentences, maxChars, maxWords) {
  // Normalize whitespace
  let r = text.replace(/\s+/g, ' ').trim();
  // Enforce sentence limit
  if (maxSentences) {
    const sentences = r.match(/[^.!?]*[.!?]+/g);
    if (sentences && sentences.length > maxSentences) {
      r = sentences.slice(0, maxSentences).join('').trim();
    }
  }
  // Enforce word limit
  if (maxWords) {
    const words = r.split(/\s+/);
    if (words.length > maxWords) {
      r = words.slice(0, maxWords).join(' ');
      // Try to end on sentence boundary
      const lastPunct = r.search(/[.!?][^.!?]*$/);
      if (lastPunct > r.length * 0.4) r = r.slice(0, lastPunct + 1);
      r = r.trim();
      // Add period if trimmed text doesn't end with punctuation
      if (r.length > 0 && !/[.!?]$/.test(r)) r += '.';
    }
  }
  // Enforce character limit — trim at word boundary, never mid-word
  if (maxChars && r.length > maxChars) {
    r = r.slice(0, maxChars);
    // If we cut mid-word (last char is a letter and original was longer), back up to last space
    if (/[a-zA-Z]$/.test(r)) {
      const lastSpace = r.lastIndexOf(' ');
      if (lastSpace > 0) r = r.slice(0, lastSpace);
    }
    // End on sentence boundary if possible
    const lastPunct = r.search(/[.!?][^.!?]*$/);
    if (lastPunct > r.length * 0.4) r = r.slice(0, lastPunct + 1);
    r = r.trim();
    // Ensure ends with punctuation
    if (r.length > 0 && !/[.!?]$/.test(r)) r += '.';
  }
  return r;
}

// --- Parse model output into roasts + themes ---
function parseModelOutput(rawOutput, config) {
  let roasts = [];
  let themes = [];
  const cleaned = rawOutput.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  let jsonParsed = false;
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        roasts = parsed;
      } else if (parsed && Array.isArray(parsed.roasts)) {
        roasts = parsed.roasts;
        themes = Array.isArray(parsed.themes) ? parsed.themes : [];
      }
      jsonParsed = true;
    } catch {
      // fall through
    }
  }

  if (!jsonParsed) {
    roasts = cleaned
      .split('\n')
      .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(line => line.length > 0)
      .slice(0, config.count);
  }

  // Discard anything that looks like raw JSON
  roasts = roasts
    .map(r => String(r).trim())
    .filter(r => r.length > 0)
    .filter(r => !r.startsWith('{"roasts"') && !r.startsWith('{"themes"'));

  return { roasts, themes, jsonParsed };
}

// --- Salvage roast text from malformed model output ---
function extractRoastText(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Attempt 1: standard JSON parse
  try {
    const obj = JSON.parse(trimmed.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim());
    if (obj && typeof obj.roast === 'string' && obj.roast.trim()) return obj.roast.trim();
    if (obj && typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim();
    if (obj && Array.isArray(obj.roasts) && obj.roasts[0]) return String(obj.roasts[0]).trim();
  } catch { /* fall through */ }
  // Attempt 2: regex for "roast": "..."
  const quoted = trimmed.match(/"roast"\s*:\s*"([^"]+)"/);
  if (quoted && quoted[1].trim()) return quoted[1].trim();
  // Attempt 3: roast: ... or roast = ...
  const unquoted = trimmed.match(/roast\s*[:=]\s*(.+)/i);
  if (unquoted && unquoted[1].trim()) {
    return unquoted[1].trim().replace(/^["']|["']$/g, '').trim();
  }
  // Attempt 4: raw text with quotes/braces stripped
  const stripped = trimmed.replace(/^[{[\s"']+|[}\]\s"']+$/g, '').trim();
  if (stripped.length >= 30 && !stripped.startsWith('{')) return stripped;
  // Attempt 5: if raw contains 2+ sentences, return first two joined
  const rawSents = trimmed.match(/[^.!?]*[.!?]+/g);
  if (rawSents && rawSents.length >= 2) {
    const joined = rawSents.slice(0, 2).map(s => s.trim()).join(' ').trim();
    if (joined.length >= 30) return joined;
  }
  return null;
}

// --- Roast validator: returns { valid, reasons } ---
const JSON_MARKERS = ['{', '}', '[', ']', '":', 'roasts', 'output:', 'response:'];
const BANNED_SOFT = [
  'at what cost', "it's as if", 'perhaps', 'maybe',
  'in a way', 'seems like', 'you should', 'could help', 'try to', 'as an ai',
  'your machines',
];
const VISUAL_KEYWORDS = [
  'hair', 'lighting', 'expression', 'background', 'pose', 'eyes', 'smile',
  'outfit', 'shirt', 'face', 'look', 'jaw', 'glasses', 'hat', 'hoodie',
  'posture', 'arms', 'hands', 'standing', 'sitting', 'leaning', 'staring',
  'grin', 'smirk', 'frown', 'squint', 'selfie', 'angle', 'shadow',
  'pc', 'computer', 'setup', 'monitor', 'screen', 'keyboard', 'desk',
  'rgb', 'led', 'camera', 'phone', 'headphones',
  'car', 'hood', 'bonnet', 'engine', 'tire', 'tyre', 'wheel', 'wrench',
  'tools', 'oil', 'workshop', 'toolbox', 'jack', 'garage',
];

function validateRoast(text, tierName) {
  const reasons = [];
  const lower = text.toLowerCase();

  // JSON contamination (skip for mild/medium — plain text pipelines)
  if (tierName !== 'medium' && tierName !== 'mild') {
    for (const m of JSON_MARKERS) {
      if (text.includes(m)) { reasons.push(`json-marker:${m}`); break; }
    }
  }

  // Banned soft/therapy language
  for (const phrase of BANNED_SOFT) {
    if (lower.includes(phrase)) { reasons.push(`banned:${phrase}`); break; }
  }

  // Length limits
  if (tierName === 'savage' && text.length > 200) reasons.push(`too-long:${text.length}/200`);
  if (tierName === 'nuclear' && text.length > 400) reasons.push(`too-long:${text.length}/400`);

  // Must reference a visible detail (hard-fail for savage, scoring penalty for nuclear)
  const hasVisual = VISUAL_KEYWORDS.some(kw => lower.includes(kw));
  // Savage gets an expanded visual check: base VISUAL_KEYWORDS + extra scene/attribute tokens
  if (tierName === 'savage') {
    const savageExtraVisual = [
      'lighting', 'shadow', 'dim', 'dark', 'glare', 'flash',
      'frame', 'crop', 'angle', 'background', 'garage', 'palm',
      'kitchen', 'room', 'grin', 'smile', 'teeth',
    ];
    const hasSavageVisual = hasVisual || savageExtraVisual.some(kw => lower.includes(kw));
    if (!hasSavageVisual) reasons.push('no-visual-detail');
  } else if (tierName !== 'nuclear') {
    if (!hasVisual) reasons.push('no-visual-detail');
  }

  // Savage-v2 validation (cold verdict + micdrop — 2-sentence contract)
  if (tierName === 'savage') {
    const savageWordCount = text.trim().split(/\s+/).length;
    const sSentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    // Exactly 2 sentences
    if (sSentences.length !== 2) reasons.push(`savage-sentenceCount:${sSentences.length}/2`);
    // 12–22 words total
    if (savageWordCount > 22) reasons.push(`savage-too-many-words:${savageWordCount}/22`);
    if (savageWordCount < 11) reasons.push(`savage-too-few-words:${savageWordCount}/11`);
    // Sentence 2: organic closer — 1–4 words, ends with period, no commands, no "you"/"your"
    if (sSentences.length === 2) {
      const s2 = sSentences[1].trim();
      const s2Lower = s2.toLowerCase();
      const s2Wc = s2.split(/\s+/).length;
      if (s2Wc < 1 || s2Wc > 4) reasons.push(`savage-s2-wordCount:${s2Wc}/1-4`);
      if (!s2.endsWith('.')) reasons.push('savage-s2-no-period');
      if (s2.includes('?')) reasons.push('savage-s2-question');
      if (/["\u201C\u201D\u2018\u2019]/.test(s2)) reasons.push('savage-s2-quotes');
      if (/\byou(r|'re|'ve|'ll)?\b/i.test(s2)) reasons.push('savage-s2-you');
      const s2FirstWord = s2.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
      if (SAVAGE_S2_BANNED_IMPERATIVES.includes(s2FirstWord)) reasons.push(`savage-s2-imperative:${s2FirstWord}`);
    }
    // No questions
    if (text.includes('?')) reasons.push('savage-question');
    // No quotes (double straight + all curly — straight apostrophe ' allowed for contractions)
    if (/["\u201C\u201D\u2018\u2019]/.test(text)) reasons.push('savage-quotes');
    // No emojis
    if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}]/u.test(text)) reasons.push('savage-emoji');
    // Template crutch bans
    if (sSentences.length >= 1 && /^\s*you look like\b/i.test(sSentences[0])) reasons.push('savage-you-look-like');
    if (sSentences.length >= 1 && /\blooks like\b/i.test(sSentences[0])) reasons.push('savage-looks-like');
    if (/\bscreams\b/i.test(text)) reasons.push('savage-screams');
    if (/\byour expression\b/i.test(text)) reasons.push('savage-expression-template');
    // No imperative openers in sentence 1 only
    if (sSentences.length >= 1) {
      const fw = sSentences[0].trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (SAVAGE_IMPERATIVES.includes(fw)) reasons.push(`savage-imperative:${fw}`);
    }
    // Nuclear-level safety: worthlessness bans
    for (const phrase of NUCLEAR_BANNED_WORTHLESSNESS) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) { reasons.push(`savage-worthlessness:${phrase}`); break; }
    }
    // Nuclear-level safety: identity-erasure bans
    for (const phrase of NUCLEAR_BANNED) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) { reasons.push(`savage-nuclear-banned:${phrase}`); break; }
    }
    // Crutch phrases: moved from hard-reject to score penalty (see scoreRoast)
    // Bleak/defeated language
    for (const term of SAVAGE_BLEAK) {
      if (lower.includes(term)) { reasons.push(`savage-bleak:${term}`); break; }
    }
  }

  // --- Medium-v2 validation ---
  if (tierName === 'medium') {
    const mSentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    const mWordCount = text.trim().split(/\s+/).length;
    // EXACTLY 2 sentences
    if (mSentences.length !== 2) reasons.push(`medium-sentenceCount:${mSentences.length}/2`);
    // 14–22 words total
    if (mWordCount > 22) reasons.push(`medium-too-many-words:${mWordCount}/22`);
    if (mWordCount < 14) reasons.push(`medium-too-few-words:${mWordCount}/14`);
    // Max 200 chars
    if (text.length > 200) reasons.push(`medium-too-long:${text.length}/200`);
    // No questions
    if (text.includes('?')) reasons.push('medium-question');
    // No quotes (double straight + all curly — straight apostrophe ' allowed for contractions) / emojis
    if (/["\u201C\u201D\u2018\u2019]/.test(text)) reasons.push('medium-quotes');
    if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}]/u.test(text)) reasons.push('medium-emoji');
    // "you look like" / "looks like" ban
    if (/\byou look like\b/i.test(text)) reasons.push('medium-you-look-like');
    if (/\blooks like\b/i.test(text)) reasons.push('medium-looks-like');
    // "you should" phrase ban
    if (/\byou should\b/i.test(text)) reasons.push('medium-imperative:you-should');
    // Advice/command ban: check first word of each sentence against MEDIUM_BANNED_OPENERS
    for (const sent of mSentences) {
      const fw = sent.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
      if (MEDIUM_BANNED_OPENERS.includes(fw)) { reasons.push(`medium-imperative:${fw}`); break; }
    }
    // Template crutch ban (hard reject)
    for (const crutch of MEDIUM_TEMPLATE_CRUTCHES) {
      if (lower.includes(crutch)) { reasons.push(`medium-crutch:${crutch}`); break; }
    }
    // Short micdrop ban: sentence 2 must be >3 words (reserve short closers for savage/nuclear)
    if (mSentences.length === 2) {
      const s2 = mSentences[1].trim();
      const s2Wc = s2.split(/\s+/).length;
      if (s2Wc <= 3) reasons.push(`medium-short-micdrop:${s2Wc}`);
    }
    // Worthlessness/identity-erasure safety bans (reuse nuclear lists)
    for (const phrase of NUCLEAR_BANNED_WORTHLESSNESS) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) { reasons.push(`medium-worthlessness:${phrase}`); break; }
    }
    for (const phrase of NUCLEAR_BANNED) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) { reasons.push(`medium-nuclear-banned:${phrase}`); break; }
    }
    // Bleak/existential drift ban (medium should be "oof" not "damn")
    const MEDIUM_BLEAK_PHRASES = ['about life', 'better days', 'existential', 'depressing', 'nobody cares'];
    for (const phrase of MEDIUM_BLEAK_PHRASES) {
      if (lower.includes(phrase)) { reasons.push(`medium-bleak:${phrase}`); break; }
    }
    // Visual detail check (same expanded check as savage)
    const mediumExtraVisual = [
      'lighting', 'shadow', 'dim', 'dark', 'glare', 'flash',
      'frame', 'crop', 'angle', 'background', 'garage', 'palm',
      'kitchen', 'room', 'grin', 'smile', 'teeth',
    ];
    const hasMediumVisual = hasVisual || mediumExtraVisual.some(kw => lower.includes(kw));
    if (!hasMediumVisual) reasons.push('medium-no-visual-detail');
  }

  // --- Mild-v2 validation ---
  if (tierName === 'mild') {
    const mlSentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    const mlWordCount = text.trim().split(/\s+/).length;
    // EXACTLY 1 sentence
    if (mlSentences.length !== 1) reasons.push(`mild-sentenceCount:${mlSentences.length}/1`);
    // 8–14 words total
    if (mlWordCount > 14) reasons.push(`mild-too-many-words:${mlWordCount}/14`);
    if (mlWordCount < 8) reasons.push(`mild-too-few-words:${mlWordCount}/8`);
    // Max 120 chars
    if (text.length > 120) reasons.push(`mild-too-long:${text.length}/120`);
    // No questions
    if (text.includes('?')) reasons.push('mild-question');
    // No quotes (double straight + all curly) / emojis
    if (/["\u201C\u201D\u2018\u2019]/.test(text)) reasons.push('mild-quotes');
    if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}]/u.test(text)) reasons.push('mild-emoji');
    // "you look like" / "looks like" ban
    if (/\byou look like\b/i.test(text)) reasons.push('mild-you-look-like');
    if (/\blooks like\b/i.test(text)) reasons.push('mild-looks-like');
    // Advice/command ban: check first word against MILD_BANNED_OPENERS
    const mlFw = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
    if (MILD_BANNED_OPENERS.includes(mlFw)) reasons.push(`mild-imperative:${mlFw}`);
    // Template crutch ban
    for (const crutch of MILD_TEMPLATE_CRUTCHES) {
      if (lower.includes(crutch)) { reasons.push(`mild-crutch:${crutch}`); break; }
    }
    // Harsh language ban
    for (const phrase of MILD_HARSH_WORDS) {
      if (lower.includes(phrase)) { reasons.push(`mild-harsh:${phrase}`); break; }
    }
    // Visual detail check
    const mildExtraVisual = [
      'lighting', 'shadow', 'dim', 'dark', 'glare', 'flash',
      'frame', 'crop', 'angle', 'background', 'garage', 'palm',
      'kitchen', 'room', 'grin', 'smile', 'teeth',
    ];
    const hasMildVisual = hasVisual || mildExtraVisual.some(kw => lower.includes(kw));
    if (!hasMildVisual) reasons.push('mild-no-visual-detail');
  }

  // Nuclear-only: banned identity-erasure phrases (word-boundary regex)
  if (tierName === 'nuclear') {
    for (const phrase of NUCLEAR_BANNED) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) { reasons.push(`nuclear-banned:${phrase}`); break; }
    }
    // Nuclear-only: banned worthlessness/erasure closers (word-boundary regex)
    for (const phrase of NUCLEAR_BANNED_WORTHLESSNESS) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) { reasons.push(`banned-nuclear:${phrase}`); break; }
    }
    // Nuclear-only: viral/Play Store safety bans (substance, diagnostic, template crutches)
    // Single-word terms use word-boundary match to avoid false positives (e.g. "high" in "highlights")
    for (const term of NUCLEAR_VIRAL_BANS) {
      const isPhrase = term.includes(' ');
      if (isPhrase) {
        if (lower.includes(term)) { reasons.push(`nuclear-viral-ban:${term}`); break; }
      } else {
        if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) { reasons.push(`nuclear-viral-ban:${term}`); break; }
      }
    }
  }

  // Too short / empty
  if (text.length < 15) reasons.push('too-short');

  return { valid: reasons.length === 0, reasons };
}

// --- Score a roast candidate (higher = better) ---
const CAUGHT_YOU_PATTERNS = [
  "you're the type", "this is someone who", "this is the face of",
  "you look like the type", "you didn't choose", "you didn't",
  "you just", "you've been", "you never", "you always",
  "you probably", "you still", "you think you", "nobody taught you",
  "no one ever told you", "you forgot", "you stopped",
  "you gave up", "you settled", "you convinced yourself",
];

const NUCLEAR_ABSTRACT_ADJECTIVES = [
  'blank', 'lifeless', 'empty', 'indifferent', 'hollow',
  'apathy', 'monotony', 'existential', 'aesthetic', 'void',
  'nothingness', 'soulless', 'vapid',
];

// Common nuclear openers for soft variety penalty (not hard reject)
const NUCLEAR_COMMON_OPENERS = [
  'when your',
  'you look like',
  'looking at',
  'looking like',
  'staring into',
  'this lighting',
  'dim lighting',
  'the lighting',
  'in this lighting',
];
// Lighting-first opener phrases (subset of above, extra penalty)
const NUCLEAR_LIGHTING_OPENERS = ['this lighting', 'dim lighting', 'the lighting', 'in this lighting'];

// Escalation patterns: social-consequence phrasing scored as bonus in Nuclear
const NUCLEAR_ESCALATION_PATTERNS = [
  /\b(posted|uploaded|shared)\b/i,
  /\bgroup chat\b/i,
  /\bstory\b/i,
  /\bprofile pic\b/i,
  /\bresume\b/i,
  /\bjob interview\b/i,
  /\bHR\b/i,
  /\bfamily group\b/i,
  /\bLinkedIn\b/i,
  /\bpublic\b/i,
  /\bpermanent\b/i,
  /\bnever recover\b/i,
  /\bcareer\b/i,
];

function scoreRoast(text, tierName, lane = null, { requiredExposure = null, clientState = null } = {}) {
  let score = 50;
  const lower = text.toLowerCase();

  // Reward: contains visual keyword (capped lower for nuclear — anchor matters, shouldn't dominate)
  const visualHits = VISUAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
  score += Math.min(visualHits, 2) * (tierName === 'nuclear' ? 5 : 10);

  // Reward: brevity (closer to target = better)
  if (tierName === 'nuclear') {
    // Nuclear uses word-count bands matching the 2-sentence output contract
    const nucWc = text.trim().split(/\s+/).length;
    if (nucWc >= 14 && nucWc <= 20) score += 20;
    else if (nucWc >= 21 && nucWc <= 22) score += 10;
    else if (nucWc >= 23 && nucWc <= 24) score -= 5;
    else if (nucWc > 24) score -= 20;
    else if (nucWc < 14) score -= 15;

    // Soft opener penalty: variety pressure for common openers
    const s1 = (text.match(/[^.!?]*[.!?]+/) || [text])[0].trim().toLowerCase();
    const matchedOpener = NUCLEAR_COMMON_OPENERS.find(o => s1.startsWith(o));
    if (matchedOpener) {
      score -= 14;
      // Extra penalty if same opener stem used in last 3 nuclear outputs for this client
      if (clientState && clientState.recentNuclearTexts) {
        const recent3 = clientState.recentNuclearTexts.slice(-3);
        const openerUsedRecently = recent3.some(prev => {
          const prevS1 = (prev.match(/[^.!?]*[.!?]+/) || [prev])[0].trim().toLowerCase();
          return prevS1.startsWith(matchedOpener);
        });
        if (openerUsedRecently) score -= 20;
      }
    }
    // Lighting-first penalty: discourage leading with lighting unless detail pack is thin
    if (NUCLEAR_LIGHTING_OPENERS.some(lo => s1.startsWith(lo))) {
      score -= 8;
    }
    // Cold micdrop bonus: reward short, clean sentence 2
    const nucSents = text.match(/[^.!?]*[.!?]+/g);
    if (nucSents && nucSents.length >= 2) {
      const nucS2 = nucSents[nucSents.length - 1].trim();
      const nucS2Lower = nucS2.toLowerCase();
      const nucS2Wc = nucS2.split(/\s+/).length;
      if (nucS2Wc >= 2 && nucS2Wc <= 5
        && !/\b(even|and|because|while|looks?)\b/.test(nucS2Lower)) {
        score += 10;
      }
    }
  } else {
    const targetLen = tierName === 'savage' ? 80 : 250;
    const lenDiff = Math.abs(text.length - targetLen);
    score -= Math.floor(lenDiff / 15);
  }

  // Reward: ends with punctuation (punchline indicator)
  if (/[.!]$/.test(text.trim())) score += 10;

  // Penalize: banned cliches present
  for (const c of BANNED_CLICHES) {
    if (lower.includes(c)) score -= 15;
  }

  // Penalize: hedging language
  for (const h of BANNED_HEDGING) {
    if (lower.includes(h)) score -= 10;
  }

  // Penalize: therapy language
  for (const s of BANNED_SOFT) {
    if (lower.includes(s)) score -= 20;
  }

  // Penalize: too many sentences for tier
  const sentenceCount = (text.match(/[.!?]+/g) || []).length;
  if (tierName === 'nuclear' && sentenceCount > 2) score -= 25;

  // --- Savage-v2 scoring (cold verdict + micdrop) ---
  if (tierName === 'savage') {
    const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    const wordCount = text.trim().split(/\s+/).length;

    // Reward: exactly 2 sentences
    if (sentences.length === 2) score += 25;
    else score -= 20;

    // Organic closer scoring for s2
    if (sentences.length === 2) {
      const s2 = sentences[1].trim();
      const s2Lower = s2.toLowerCase();
      const s2Wc = s2.split(/\s+/).length;
      // Reward: sweet-spot closer (2–3 words)
      if (s2Wc >= 2 && s2Wc <= 3) score += 20;
      // Reward: acceptable closer (1 or 4 words)
      else if (s2Wc === 1 || s2Wc === 4) score += 10;
      // Reward: strong closing words (nouns/adjectives)
      if (SAVAGE_MICDROP_STRONG_WORDS.some(w => s2Lower.includes(w))) score += 20;
      // Extra bonus: 2–3 words AND contains strong word (ideal closer shape)
      if (s2Wc >= 2 && s2Wc <= 3 && SAVAGE_MICDROP_STRONG_WORDS.some(w => s2Lower.includes(w))) score += 10;
      // Penalize: weak filler
      if (SAVAGE_MICDROP_WEAK_WORDS.some(w => s2Lower.includes(w))) score -= 15;
      // Penalize: s2 contains "you" / "your" (closer should be impersonal)
      if (/\byou(r|'re|'ve|'ll)?\b/i.test(s2)) score -= 15;
    }

    // Reward: s1 starts with verdict framing
    if (sentences.length >= 1) {
      const s1Lower = sentences[0].trim().toLowerCase();
      const startsWithVerdict = SAVAGE_VERDICT_STARTERS.some(st => s1Lower.startsWith(st));
      if (startsWithVerdict) score += 20;
      // Soft penalty: "You …" opener that isn't a verdict starter
      else if (/^\s*you\s/i.test(sentences[0]) && !startsWithVerdict) score -= 10;
    }

    // Reward: visual detail present in s1
    if (sentences.length >= 1) {
      const s1Lower = sentences[0].trim().toLowerCase();
      if (VISUAL_KEYWORDS.some(kw => s1Lower.includes(kw))) score += 10;
    }

    // Reward: direct address ("you" / "your") in s1
    if (sentences.length >= 1 && /\byou(r|'re|'ve|'ll)?\b/.test(sentences[0].toLowerCase())) score += 10;

    // Word count sweet spot
    if (wordCount >= 14 && wordCount <= 18) score += 5;
    else if (wordCount < 14 || wordCount > 18) score -= 5;

    // Penalize: template crutches (hard-banned in validation stay harsh here too)
    if (/\byou look like\b/i.test(text)) score -= 40;
    if (/\bscreams\b/i.test(text)) score -= 40;
    // Soft penalty: "but the" in sentence 1
    if (sentences.length >= 1 && sentences[0].toLowerCase().includes('but the')) score -= 15;

    // Penalize: crutch phrases (moved from hard-reject to scoring)
    if (lower.includes('but your')) score -= 20;
    if (/\bvibes?\b/.test(lower)) score -= 20;
    {
      let crutchPenalty = 0;
      for (const crutch of SAVAGE_CRUTCHES) {
        if (crutch === 'but your' || crutch === 'vibes') continue; // already penalized above
        if (lower.includes(crutch)) crutchPenalty += 10;
      }
      score -= Math.min(crutchPenalty, 30);
    }

    // Penalize: overused tokens
    let overusedPenalty = 0;
    for (const tok of SAVAGE_OVERUSED_TOKENS) {
      if (lower.includes(tok)) overusedPenalty += 10;
    }
    score -= Math.min(overusedPenalty, 20);

    // Penalize: too similar to recent savage outputs
    for (const prev of recentSavageRoasts) {
      if (tokenOverlap(text, prev) > 0.5) { score -= 30; break; }
    }

    // Anchor tracking: force rotation across last 5
    const anchor = detectSavageAnchor(text);
    const last5Anchors = recentSavageAnchors.slice(-5);
    const last2Anchors = last5Anchors.slice(-2);
    if (last2Anchors.includes(anchor)) score -= 40;
    if (last5Anchors.filter(a => a === anchor).length >= 3) score -= 60;

    // Structure tracking: penalize repeated structures
    const structure = detectSavageStructure(text);
    const last2Structs = recentSavageStructures.slice(-2);
    if (structure !== 'direct-verdict' && last2Structs.includes(structure)) score -= 20;

    // Tie-breaker
    score -= text.length % 7;
  }

  // --- Medium-v2 scoring ---
  if (tierName === 'medium') {
    const mSentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    const mWordCount = text.trim().split(/\s+/).length;

    // Reward: exactly 2 sentences
    if (mSentences.length === 2) score += 25;

    // Reward: s1 contains visual anchor
    if (mSentences.length >= 1) {
      const s1Lower = mSentences[0].trim().toLowerCase();
      const mediumExtraVisualScore = [
        'lighting', 'shadow', 'dim', 'dark', 'glare', 'flash',
        'frame', 'crop', 'angle', 'background', 'garage', 'palm',
        'kitchen', 'room', 'grin', 'smile', 'teeth',
      ];
      if (VISUAL_KEYWORDS.some(kw => s1Lower.includes(kw)) || mediumExtraVisualScore.some(kw => s1Lower.includes(kw))) {
        score += 15;
      }
    }

    // Reward: s2 contains effort-mismatch language
    if (mSentences.length >= 2) {
      const s2Lower = mSentences[1].trim().toLowerCase();
      if (MEDIUM_EFFORT_WORDS.some(w => s2Lower.includes(w))) score += 10;
    }

    // Word count sweet spot (16–20)
    if (mWordCount >= 16 && mWordCount <= 20) score += 10;

    // Penalize: crutch tokens (vibe/energy/aura/giving), capped -30
    {
      let crutchPenalty = 0;
      for (const c of MEDIUM_TEMPLATE_CRUTCHES) {
        if (lower.includes(c)) crutchPenalty += 20;
      }
      score -= Math.min(crutchPenalty, 30);
    }

    // Penalize: high token overlap with recentMediumRoasts (>0.5)
    for (const prev of recentMediumRoasts) {
      if (tokenOverlap(text, prev) > 0.5) { score -= 30; break; }
    }

    // Penalize: s2 is <=3 words (short micdrop — reserve for savage/nuclear)
    if (mSentences.length >= 2) {
      const s2Wc = mSentences[1].trim().split(/\s+/).length;
      if (s2Wc <= 3) score -= 20;
    }

    // Penalize: generic filler words
    for (const w of MEDIUM_WEAK_WORDS) {
      if (lower.includes(w)) { score -= 15; break; }
    }

    // Tie-breaker
    score += text.length % 7;
  }

  // --- Mild-v2 scoring ---
  if (tierName === 'mild') {
    const mlWordCount = text.trim().split(/\s+/).length;

    // Reward: word count sweet spot (10–12)
    if (mlWordCount >= 10 && mlWordCount <= 12) score += 20;

    // Reward: visual anchor token in sentence
    const mlLower = text.toLowerCase();
    const mildVisualScore = [
      'lighting', 'shadow', 'dim', 'dark', 'glare', 'flash',
      'frame', 'crop', 'angle', 'background', 'garage', 'palm',
      'kitchen', 'room', 'grin', 'smile', 'teeth',
    ];
    if (VISUAL_KEYWORDS.some(kw => mlLower.includes(kw)) || mildVisualScore.some(kw => mlLower.includes(kw))) {
      score += 15;
    }

    // Reward: ends with a light punch (not a savage micdrop)
    const mlLastWord = text.trim().replace(/[.!?]+$/, '').split(/\s+/).pop()?.toLowerCase() || '';
    const lightPunchTokens = ['though', 'honestly', 'apparently', 'almost', 'barely', 'somehow', 'anyway'];
    if (lightPunchTokens.some(t => mlLastWord.includes(t) || mlLower.endsWith(t + '.'))) score += 10;

    // Penalize: high token overlap with recentMildRoasts (>0.5)
    for (const prev of recentMildRoasts) {
      if (tokenOverlap(text, prev) > 0.5) { score -= 30; break; }
    }

    // Penalize: generic filler words
    for (const w of MILD_WEAK_WORDS) {
      if (mlLower.includes(w)) { score -= 20; break; }
    }

    // Penalize: harsh language (even if not banned outright)
    for (const w of MILD_HARSH_WORDS) {
      if (mlLower.includes(w)) { score -= 20; break; }
    }

    // Penalize: template starters
    if (/^when your\b/i.test(text)) score -= 25;
    if (/^nothing says\b/i.test(text)) score -= 25;
    if (/^pov\b/i.test(text)) score -= 25;
    if (/^this is what happens\b/i.test(text)) score -= 25;

    // Penalize: praise/compliment tokens (mild should tease, not motivate)
    const MILD_PRAISE_TOKENS = [
      'greatness', 'amazing', 'flawless', 'perfect', 'winning', 'legend',
      'iconic', 'champion', 'impressive', 'proud', 'mean business', 'and life',
    ];
    for (const p of MILD_PRAISE_TOKENS) {
      if (mlLower.includes(p)) { score -= 25; break; }
    }

    // Reward: gentle deflation tokens (light tease energy)
    const MILD_DEFLATION_TOKENS = ['trying', 'almost', 'doing a lot', 'working overtime', 'carrying', 'in spirit', 'holding on'];
    if (MILD_DEFLATION_TOKENS.some(t => mlLower.includes(t))) score += 10;

    // Reward: starts with direct visual anchor
    if (/^(that |the )?(lighting|angle|background|outfit|smile|grin|shirt|pose|expression|hair|hoodie|hat|glasses|shadow|framing)\b/i.test(text)) score += 10;

    // Tie-breaker
    score += text.length % 5;
  }

  // --- Nuclear-specific scoring ---
  if (tierName === 'nuclear') {
    const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    const wordCount = text.trim().split(/\s+/).length;

    // Reward: 2 sentences (model writes 2, mic-drop appended post-selection)
    if (sentences.length === 2) score += 20;
    else if (sentences.length === 3) score += 5;
    // Penalize: single sentence (feels like savage)
    if (sentences.length < 2) score -= 15;
    // Penalize: too many sentences (model should write only 2)
    if (sentences.length > 3) score -= 15;

    // Reward: has at least one visual keyword (anchor only — capped to +10 total for nuclear)
    const nuclearVisualHits = VISUAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
    if (nuclearVisualHits >= 1) score += 5;
    if (nuclearVisualHits >= 2) score += 5;
    if (nuclearVisualHits === 0) score -= 10;

    // Penalize: theatrical "setting horror" words (each -10, capped -30)
    const theatricalWords = [
      'warehouse', 'basement', 'alley', 'dungeon', 'horror', 'scene from',
      'straight out of', 'gloomy', 'dingy', 'industrial lighting', 'garage',
      'shed', 'exiled', 'habitat', 'shadow is', "hope isn't", 'hope isn\'t',
      'abandoned', 'condemned', 'desolate', 'lair',
    ];
    let theatricalPenalty = 0;
    for (const tw of theatricalWords) {
      if (lower.includes(tw)) theatricalPenalty += 10;
    }
    score -= Math.min(theatricalPenalty, 30);

    // Penalize: simile density (2+ " like " or " as " comparisons = poetry)
    const likeCount = (lower.match(/\blike\b/g) || []).length;
    const asCount = (lower.match(/\bas\s+a\b/g) || []).length;
    if (likeCount + asCount >= 2) score -= 10;

    // Reward: personal dismantling language (no overlap with banned worthlessness — removed "nobody"/"no one")
    const personalWords = ['everyone', 'people', "that's why", "that's what"];
    const personalHits = personalWords.filter(p => lower.includes(p)).length;
    if (personalHits >= 1) score += 10;

    // Reward: strong direct assertions anywhere (no always/never — causes template loops)
    const strongAssertions = ['you are', "you're"];
    const strongHits = strongAssertions.filter(a => lower.includes(a)).length;
    if (strongHits >= 1) score += 10;

    // Reward: competence/status hit words (no overlap with banned worthlessness)
    const statusWords = ['serious', 'confidence', 'competence', 'embarrassing', 'pathetic', 'delusional', 'overconfident'];
    const statusHits = statusWords.filter(w => lower.includes(w)).length;
    if (statusHits >= 1) score += 10;

    // Reward: contains accusation / personality attack
    const hasCaughtYou = CAUGHT_YOU_PATTERNS.some(p => lower.includes(p));
    if (hasCaughtYou) score += 15;

    // Reward: second-person directness — more "you" in later sentences = more escalation
    if (sentences.length >= 3) {
      const latterHalf = sentences.slice(Math.floor(sentences.length / 2)).join(' ').toLowerCase();
      const youCount = (latterHalf.match(/\byou\b/g) || []).length;
      if (youCount >= 2) score += 10;
      if (youCount >= 4) score += 5;
    }

    // Reward: sentences 2+ start with "You" — direct escalation
    const youStarters = sentences.slice(1).filter(s => /^\s*you\b/i.test(s)).length;
    if (youStarters >= 1) score += 10;
    if (youStarters >= 2) score += 5;

    // Reward: strong direct assertions in middle sentences (no always/never)
    const directAssertions = ['you are', "you're", "you've", "that's why", "that's what"];
    const midSentences = sentences.slice(1, -1).join(' ').toLowerCase();
    const assertionHits = directAssertions.filter(a => midSentences.includes(a)).length;
    score += Math.min(assertionHits, 3) * 5;

    // Last sentence refs (used for overlap and structure scoring — closer scoring removed, mic-drop appended post-selection)
    const lastSentence = sentences[sentences.length - 1] || '';
    const lastWordCount = lastSentence.trim().split(/\s+/).length;
    const lastLower = lastSentence.toLowerCase();

    // Penalize: worthlessness language anywhere in text (word-boundary, -80 per hit, capped -160)
    let worthlessPenalty = 0;
    for (const wp of NUCLEAR_BANNED_WORTHLESSNESS) {
      const re = new RegExp(`\\b${wp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) worthlessPenalty += 80;
    }
    score -= Math.min(worthlessPenalty, 160);

    // Reward: in target word range (15–50 for 2-sentence format)
    if (wordCount >= 15 && wordCount <= 50) score += 10;

    // Penalize: too short for nuclear (feels like savage)
    if (wordCount < 12) score -= 15;

    // Penalize: nuclear-specific hedging (weaker language)
    const nuclearHedges = ['kinda', 'sort of', 'a little', 'a bit', 'slightly', 'almost'];
    for (const h of nuclearHedges) {
      if (lower.includes(h)) score -= 10;
    }

    // Penalize: generic comparisons
    const genericPatterns = ['horror movie', 'horror basement', 'looks like a scene from', 'straight out of'];
    for (const g of genericPatterns) {
      if (lower.includes(g)) score -= 15;
    }

    // Penalize: low-energy language clustering (reduce sad-guy drift)
    const lowEnergyTerms = ['exhausted', 'drained', 'dim lighting', 'low energy', 'half-smile'];
    for (const le of lowEnergyTerms) {
      if (lower.includes(le)) { score -= 10; break; }
    }

    // Reward: ego fraud / try-hard exposure language (+15 for any match)
    const egoFraudTerms = [
      'rehearse', 'rehearsed', 'perform', 'performing', 'audition',
      'overcompensate', 'trying too hard', 'try-hard', 'pretending', 'fronting',
      'fake serious', 'acting tough', 'main character', 'thinks you', "think you're",
      'convinced yourself', 'posture like', 'pose like', 'you practice',
      'validation', 'attention',
    ];
    if (egoFraudTerms.some(t => lower.includes(t))) score += 15;

    // Reward: social delusion exposure (+18 for direct "you think/act/believe" framing)
    const delusionExposure = [
      'you think', 'you really think', 'you convinced yourself', 'you act like',
      'you pose like', 'you practice', 'you rehearse', "you're trying to",
      'you try to', 'you believe this', 'you believe that', 'you call this',
      'you consider this', 'you mistake', 'you confuse',
    ];
    if (delusionExposure.some(t => lower.includes(t))) score += 18;

    // Reward: sentence 2 challenges audience perception (+10)
    if (sentences.length >= 3) {
      const sent2Lower = (sentences[1] || '').toLowerCase();
      if (delusionExposure.some(p => sent2Lower.includes(p))) score += 10;
      if (/impress(es)? (anyone|people)/i.test(sent2Lower)) score += 10;
      if (/intimidat(es)? (anyone|people)/i.test(sent2Lower)) score += 10;
      if (/take(s)? you seriously/i.test(sent2Lower)) score += 10;
      if (/nobody.*(impressed|fooled)/i.test(sent2Lower)) score += 10;
      if (/this.*work(s)?($|\b)/i.test(sent2Lower)) score += 10;
      if (/this.*land(s)?($|\b)/i.test(sent2Lower)) score += 10;
    }

    // Reward: sentence 2 audience-facing + delusion verb combo (+12)
    if (sentences.length >= 3) {
      const s2Lower = (sentences[1] || '').toLowerCase();
      const hasAudienceToken = /\b(anyone|people|everyone|nobody|they|somebody)\b/.test(s2Lower);
      const hasDelusionWord = /\b(think|act|pose|pretend|rehearse|practice|convinced)\b/.test(s2Lower);
      if (hasAudienceToken && hasDelusionWord) score += 12;
    }

    // Penalize: trait-only commentary without delusion exposure (flat description)
    const traitOnlyTokens = ['lighting', 'hair', 'energy', 'dim', 'tired', 'drained'];
    const hasTraitOnly = traitOnlyTokens.some(t => lower.includes(t));
    const hasDelusionVerb = delusionExposure.some(t => lower.includes(t)) || egoFraudTerms.some(t => lower.includes(t));
    if (hasTraitOnly && !hasDelusionVerb) score -= 8;

    // Penalize: existential vibe drift ("life called it quits" etc.)
    if (/life called it|life quit/i.test(lower)) score -= 8;

    // Penalize: abstract adjectives
    for (const t of NUCLEAR_ABSTRACT_ADJECTIVES) {
      if (lower.includes(t)) score -= 20;
    }

    // Penalize: existential despair language (Play Store safety — each -20, capped -60)
    const despairPhrases = [
      'no one would miss', 'nobody would miss', 'better off gone',
      'should disappear', 'no reason to exist', 'worthless',
      "hope isn't coming", 'hope isn\'t coming', 'no hope',
      'nothing will ever change', 'nothing will change',
    ];
    let despairPenalty = 0;
    for (const dp of despairPhrases) {
      if (lower.includes(dp)) despairPenalty += 20;
    }
    score -= Math.min(despairPenalty, 60);

    // Penalize: identity-erasure / worthlessness framing (backup for NUCLEAR_BANNED — each -20, capped -80)
    const erasurePhrases = [
      'lifeless', 'invisible', 'forgettable', 'nobody notices', 'no one notices',
      'background extra', 'living ghost', 'why bother', 'upgrade your presence',
      'forgotten forever', 'nobody would notice', 'unmissed', 'no one remembers',
      'dead-eyed', 'utterly forgettable', 'forgotten instantly', 'pretends not to see',
      'lost cause', 'nobody respects', 'no one respects', "they shouldn't",
      'nobody in that room', 'no one in that room', 'invisible would be',
    ];
    let erasurePenalty = 0;
    for (const ep of erasurePhrases) {
      if (lower.includes(ep)) erasurePenalty += 20;
    }
    score -= Math.min(erasurePenalty, 80);

    // Penalize: "nobody/no one" + negative framing (worthlessness pattern)
    if (/\b(nobody|no one)\b/.test(lower) && /\b(would|will|could|should|ever|cares|wants|asked)\b/.test(lower)) score -= 40;
    // Penalize: standalone worthlessness signals
    if (lower.includes('lost cause')) score -= 40;
    if (lower.includes("shouldn't")) score -= 20;

    // Penalize: imperative / advice sentences (each -15, capped -45)
    const nSents = sentences;
    let imperativePenalty = 0;
    for (const s of nSents) {
      const fw = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (NUCLEAR_IMPERATIVES.includes(fw)) imperativePenalty += 15;
    }
    score -= Math.min(imperativePenalty, 45);

    // Mild penalty for imperative verb patterns anywhere in text
    if (/\b(try|get|stop|go|just)\b/i.test(text)) score -= 6;

    // Reward: awkward presence / try-hard / ego humiliation language
    const egoHumiliationWords = [
      'try-hard', 'awkward', 'overcompensate', 'desperate', 'out of place',
      'secondhand embarrassment', 'trying too hard', 'tough guy',
      'main character energy',
    ];
    const egoHits = egoHumiliationWords.filter(w => lower.includes(w)).length;
    if (egoHits >= 1) score += 15;

    // Penalize: generic nuclear crutch phrases
    if (lower.includes('wasted potential')) score -= 15;
    if (lower.includes('life achievements')) score -= 10;
    if (lower.includes('personality')) score -= 10;
    if (lower.includes('warning sign')) score -= 20;

    // Penalize: softened crutch words (scored not rejected)
    for (const sc of NUCLEAR_SOFT_CRUTCHES) {
      if (lower.includes(sc)) { score -= 8; break; }
    }

    // Mild penalty for stylistic connective verbs (not banned, just nudged)
    if (NUCLEAR_CONNECTIVE_PENALTY.some(c => lower.includes(c))) score -= 3;

    // Extra nudge against overused connective verbs
    if (/(reads as|registers as|lands as|suggests)/i.test(text)) score -= 3;
    if (/(looks like|isn't|that's|you've got|it's giving)/i.test(text)) score += 3;

    // Mild penalty for softened viral-ban words (moved from hard rejection)
    if (/\bexudes\b|\bhigh\b/i.test(text)) score -= 6;
    if (/\bgives off\b/i.test(text)) score -= 4;

    // Penalize: AI-written phrases (each -15, capped -45)
    const aiPhrases = ['your expression matches', 'you project', "it's like", 'you radiate'];
    let aiPhrasePenalty = 0;
    for (const ap of aiPhrases) {
      if (lower.includes(ap)) aiPhrasePenalty += 15;
    }
    score -= Math.min(aiPhrasePenalty, 45);

    // Penalize: "you convinced yourself" repetition
    if (/you convinced yourself/i.test(text)) score -= 10;
    if (/^\s*you convinced yourself/i.test(text)) score -= 14;

    // --- Sentence 2 delusion verb variety penalties & rewards ---
    const sent2 = getSentence2(text);
    if (sent2) {
      const s2Lower = sent2.toLowerCase();
      // Penalize: overused delusion verbs in sentence 2
      if (/\byou (think|act|believe)\b/i.test(sent2)) score -= 6;
      if (/\byou convinced yourself\b/i.test(sent2)) score -= 10;
      // Extra penalty: sentence 2 starts with overused opener
      if (/^\s*you (think|act)\b/i.test(sent2)) score -= 14;
      if (/^\s*you convinced yourself\b/i.test(sent2)) score -= 14;
      // Reward: alternative exposure verbs in sentence 2
      const hasAltVerb = /\byou (assume|figure|imagine|expect|pretend|swear|insist|claim)\b/i.test(sent2);
      const hasAsIf = /\b(as if|like you)\b/i.test(sent2);
      const hasAudienceKw = /\b(anyone|people|everybody|nobody|serious|buys?|impressed|fooled)\b/i.test(sent2);
      if (hasAltVerb || (hasAsIf && hasAudienceKw)) score += 8;
      // Bonus: requiredExposure phrase in sentence 2 (preferred, not required)
      if (requiredExposure && new RegExp(`\\b${requiredExposure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sent2)) score += 12;
      // Penalty: no exposure/delusion verb at all in sentence 2
      const hasAnyExposure = hasAltVerb || /\byou (think|act|believe)\b/i.test(sent2) || /\byou convinced yourself\b/i.test(sent2)
        || /\b(impress|fool|buy|buying|who told you)\b/i.test(sent2);
      if (!hasAnyExposure) score -= 6;
      // Reward: sentence 2 starts with audience-framing opener (+8)
      if (/^\s*(Nobody|People|Everyone|The internet|Your friends|Strangers|The camera|Your mirror)\b/i.test(sent2)) score += 8;
      // Reward: sentence 2 contains room-reaction token (+6)
      if (/\b(group chat|comments|timeline|the room|the internet)\b/i.test(sent2)) score += 6;

      // --- Cold micdrop scoring (sentence 2 brevity & tone) ---
      const s2WordCount = sent2.trim().split(/\s+/).length;

      // Reward: blunt declarative second sentences (highest applicable only, no stacking)
      const comparativePhrases = ['than', 'even', 'as', 'more', 'because', 'while'];
      if (s2WordCount <= 3 && !comparativePhrases.some(p => s2Lower.includes(p))) score += 25;
      else if (s2WordCount <= 5 && !comparativePhrases.some(p => s2Lower.includes(p))) score += 20;

      // Penalize: explanatory/comparative micdrop openers
      if (/^\s*(even|that|your|because|while)\b/i.test(sent2)) score -= 8;

      // Penalize: "Even " opener in sentence 2
      if (s2Lower.startsWith('even ')) score -= 18;

      // Reward: decisive declarative tone (no hedging, no comparisons, ends with period)
      const s2NoLooks = !/\b(looks|seems)\b/i.test(sent2);
      const s2NoThan = !/\bthan\b/i.test(sent2);
      const s2NoBecause = !/\bbecause\b/i.test(sent2);
      const s2Declarative = /\.\s*$/.test(sent2);
      if (s2NoLooks && s2NoThan && s2NoBecause && s2Declarative) score += 12;
    }

    // Penalize: comparative phrasing anywhere in nuclear text (-15)
    if (/\b(more than|less than|wider than|brighter than)\b/i.test(text) || /\bas\s/i.test(text) || /\bthan\s/i.test(text) || /\beven\s/i.test(text)) {
      score -= 15;
    }

    // Penalize: "When" opener on sentence 1
    if (/^\s*when\s/i.test(text)) score -= 18;

    // Nuclear-only hard penalties for formulaic/crutch patterns
    if (/\bYou (imagine|expect|insist|assume|pretend)\b/i.test(text)) score -= 40;
    if (/\b(do(es)?|is(n't)?|is not) (doing )?you (any )?favors\b/i.test(text)) score -= 25;
    if (/\byour expression\b/i.test(text)) score -= 20;
    if (/\bthe lighting\b/i.test(text)) score -= 15;

    // Reward: social-perception language (no overlap with banned worthlessness)
    const socialPerceptionWords = ['tolerate', 'taken seriously', 'second choice', 'last pick', 'talked over'];
    const socialHits = socialPerceptionWords.filter(w => lower.includes(w)).length;
    if (socialHits >= 1) score += 15;

    // Reward: sentences starting with social-reaction openers (only "everyone"/"people" — NOT "nobody"/"no one")
    const socialOpeners = sentences.filter(s => /^\s*(everyone|people)\b/i.test(s)).length;
    if (socialOpeners >= 1) score += 15;

    // Reward: sentences referencing how "people" or "everyone" reacts
    const socialSentences = sentences.filter(s => {
      const sl = s.toLowerCase();
      return sl.includes('people') || sl.includes('everyone');
    }).length;
    if (socialSentences >= 1) score += 10;

    // Penalize: soft/reflective/philosophical tone
    const safePatterns = ['hiding from', 'narrative', 'canvas', 'tapestry', 'journey', 'wake up', 'maybe you', 'one day'];
    for (const p of safePatterns) {
      if (lower.includes(p)) score -= 15;
    }

    // Penalize: questions (no questions allowed)
    if (text.includes('?')) score -= 10;

    // Penalize: sentence opener repetition (e.g., "You... You... You...")
    const openers = sentences.map(s => s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '');
    const openerCounts = {};
    for (const o of openers) { openerCounts[o] = (openerCounts[o] || 0) + 1; }
    const maxOpenerRepeat = Math.max(...Object.values(openerCounts));
    if (maxOpenerRepeat >= 3) score -= 30;
    else if (maxOpenerRepeat >= 2) score -= 20;
    // Reward: varied openers (all unique)
    const uniqueOpeners = new Set(openers).size;
    if (uniqueOpeners === openers.length && openers.length >= 3) score += 8;
    // Reward: sentence 2 starts with "You" but sentence 1 does not (delayed directness)
    if (openers.length >= 2 && openers[1] === 'you' && openers[0] !== 'you') score += 8;

    // Penalize: cross-call overlap with recent nuclear roasts (exact match = hard block)
    let maxNuclearOverlap = 0;
    const candNorm = normalizeForOverlap(text);
    for (const prev of recentNuclearRoasts) {
      if (normalizeForOverlap(prev) === candNorm) {
        maxNuclearOverlap = 1;
        break;
      }
      const overlap = tokenOverlap(text, prev);
      if (overlap > maxNuclearOverlap) maxNuclearOverlap = overlap;
    }
    if (maxNuclearOverlap >= 0.99) score -= 250;
    else if (maxNuclearOverlap > 0.6) score -= 80;
    else if (maxNuclearOverlap > 0.55) score -= 35;
    else if (maxNuclearOverlap > 0.45) score -= 8;

    // Penalize: final sentence too similar to recent final sentences
    const lastSentenceLower = lastSentence.trim().toLowerCase().replace(/[^a-z\s]/g, '');
    for (const prev of recentNuclearRoasts) {
      const prevSents = prev.match(/[^.!?]*[.!?]+/g) || [prev];
      const prevLast = (prevSents[prevSents.length - 1] || '').trim().replace(/[^a-z\s]/g, '');
      if (prevLast && tokenOverlap(lastSentenceLower, prevLast) > 0.5) { score -= 25; break; }
    }

    // Lane compliance scoring: reward on-lane, penalize off-lane drift
    if (lane) {
      const laneKws = LANE_KEYWORDS[lane] || [];
      let laneHits = 0;
      for (const kw of laneKws) {
        const re = new RegExp(`\\b${kw.replace(/[-/]/g, '\\$&')}\\b`, 'gi');
        const m = lower.match(re);
        if (m) laneHits += m.length;
      }
      if (laneHits === 0) score -= 25;
      if (laneHits >= 2) score += 10;

      // Penalize shirt/t-shirt when lane is not outfit
      if (lane !== 'outfit' && /(shirt|t-shirt)/i.test(text)) score -= 20;

      // Penalize deep/profound/philosoph overuse (more than once)
      const deepMatches = text.match(/\b(deep|profound|philosoph\w*)\b/gi);
      if (deepMatches && deepMatches.length >= 2) score -= 12;
    }

  }

  return score;
}

// ============================================================
// NUCLEAR V2 — Hybrid skeleton + GPT-polish system
// ============================================================

// --- Structure Templates (36+) ---
// Each template has slots: {TARGET}, {CRITIQUE}, {ESCALATION}
// Rhythm-diverse: not all start with Your/That/The
const NV2_STRUCTURE_TEMPLATES = [
  // Verb-forward accusation starters (all contain you/your + {TARGET} + {SOCIAL} consequence)
  { id: 'S01', tpl: 'You posted your {TARGET} and {SOCIAL} went quiet.' },
  { id: 'S02', tpl: 'You showed up with that {TARGET} and {SOCIAL} went silent.' },
  { id: 'S03', tpl: 'You really posted your {TARGET} like {SOCIAL} wouldn\'t notice.' },
  { id: 'S04', tpl: 'You walked in with that {TARGET} and {SOCIAL} archived you instantly.' },
  { id: 'S05', tpl: 'You led with your {TARGET} and {SOCIAL} ratio\'d you on sight.' },
  { id: 'S06', tpl: 'You brought that {TARGET} — {SOCIAL} still recovering.' },
  { id: 'S07', tpl: 'Showed up with your {TARGET} and got reported by {SOCIAL}.' },
  { id: 'S08', tpl: 'You let your {TARGET} do the talking and {SOCIAL} hit mute.' },
  { id: 'S09', tpl: 'You tried posting your {TARGET} but {SOCIAL} already archived you.' },
  { id: 'S10', tpl: 'Got caught flexing your {TARGET} and {SOCIAL} went quiet.' },
  // "Served / Acting / Looking like" starters
  { id: 'S11', tpl: 'Serving rejected-draft energy with that {TARGET} — {SOCIAL} moved on.' },
  { id: 'S12', tpl: 'Acting like your {TARGET} would carry you but {SOCIAL} said otherwise.' },
  { id: 'S13', tpl: 'Looking like your {TARGET} {CRITIQUE} — {SOCIAL} kept receipts.' },
  { id: 'S14', tpl: 'Pulled up with your {TARGET} like {SOCIAL} wouldn\'t screenshot this.' },
  { id: 'S15', tpl: 'Tried to flex your {TARGET} but {SOCIAL} hit mute.' },
  // Social consequence emphasis
  { id: 'S16', tpl: 'You posted your {TARGET} and {SOCIAL} reported you for spam.' },
  { id: 'S17', tpl: 'You chose that {TARGET} on purpose and {SOCIAL} chose to archive you.' },
  { id: 'S18', tpl: 'You walked in rocking your {TARGET} and {SOCIAL} clocked out.' },
  { id: 'S19', tpl: 'You uploaded your {TARGET} and {SOCIAL} unfollowed in real time.' },
  { id: 'S20', tpl: 'Showed your {TARGET} and {SOCIAL} blocked you on sight.' },
  // Platform-action starters
  { id: 'S21', tpl: 'Posted your {TARGET} and {SOCIAL} went silent within seconds.' },
  { id: 'S22', tpl: 'You gave your {TARGET} a close-up and {SOCIAL} turned off notifications.' },
  { id: 'S23', tpl: 'Brought your {TARGET} out and {SOCIAL} ratio\'d you before loading.' },
  { id: 'S24', tpl: 'You committed to that {TARGET} and {SOCIAL} committed to muting you.' },
  { id: 'S25', tpl: 'You showed your {TARGET} and {SOCIAL} archived you mid-scroll.' },
  // Escalation combos (still accusation-first)
  { id: 'S26', tpl: 'You hit upload on your {TARGET} and {SOCIAL} {CRITIQUE}.' },
  { id: 'S27', tpl: 'You doubled down on your {TARGET} — even {SOCIAL} {CRITIQUE}.' },
  { id: 'S28', tpl: 'Got caught posting your {TARGET} and {SOCIAL} went quiet.' },
  { id: 'S29', tpl: 'You made your {TARGET} everyone\'s problem — {SOCIAL} noticed.' },
  { id: 'S30', tpl: 'Walked in with your {TARGET} looking like you {CRITIQUE} — {SOCIAL} noticed.' },
];

// --- Target Bucket (120+) — visible features / objects to anchor on ---
// Safe-to-roast: pose, effort, style, angle, background, accessories — no body/identity traits
const NV2_TARGET_BUCKET = [
  // Hair & grooming
  'hairline', 'hair', 'beard', 'stubble', 'fade', 'part', 'bangs',
  'sideburns', 'ponytail', 'bun', 'buzzcut', 'combover',
  // Expression (safe — no physical feature attacks)
  'expression', 'stare', 'deadpan', 'smirk', 'half-smile', 'blank look',
  'glare', 'smile', 'grin', 'deadpan stare', 'squint',
  'resting face', 'eye contact', 'side-eye', 'pout',
  'blank stare', 'duck face',
  // Posture & stance
  'posture', 'stance', 'slouch', 'lean', 'arm cross', 'hand placement',
  'head tilt', 'shoulder shrug', 'arm placement', 'hand gesture',
  'power pose', 'finger point', 'peace sign', 'thumbs up',
  // Outfit & clothing
  'outfit', 'fit', 'shirt', 'hoodie', 'jacket', 'collar', 'shoes',
  'sneakers', 'hat', 'cap', 'beanie', 'sunglasses', 'glasses',
  'chain', 'necklace', 'watch', 'ring', 'wristband', 'belt',
  'tank top', 'polo', 'flannel', 'graphic tee', 'vest', 'tie',
  'joggers', 'jeans', 'shorts', 'crocs', 'slides',
  // Camera & photo technique
  'angle', 'camera angle', 'selfie technique', 'crop', 'framing',
  'mirror selfie', 'flash', 'filter', 'zoom', 'portrait mode',
  'low angle', 'high angle', 'dutch tilt', 'phone grip',
  // Background & setting
  'background', 'backdrop', 'lighting choice', 'room', 'setup',
  'wall color', 'bathroom mirror', 'car selfie', 'gym selfie',
  'bed in the background', 'messy room', 'parking lot',
  'office chair', 'gaming chair', 'kitchen background',
  // Accessories & props
  'headphones', 'earbuds', 'lanyard', 'backpack', 'water bottle',
  'vape', 'coffee cup', 'phone case', 'sticker collection',
  'keychain', 'badge', 'wristwatch', 'bracelet',
  // Effort & vibe signals
  'pose', 'attempt', 'effort', 'caption choice', 'filter choice',
  'try-hard pose', 'candid act', 'staged candid', 'hand-on-chin pose',
  'mirror wipe', 'flex attempt', 'squint attempt', 'lighting setup',
];

// Pose-specific targets that require known pose to use
const NV2_POSE_SPECIFIC_TARGETS = new Set([
  'head tilt', 'shoulder shrug', 'arm placement', 'hand gesture',
  'power pose', 'finger point', 'peace sign', 'thumbs up',
  'try-hard pose', 'candid act', 'staged candid', 'hand-on-chin pose',
]);

// --- Critique Bucket (160+) — what's wrong ---
// Harsh but not hateful. No "favors" crutches. No protected-class attacks.
const NV2_CRITIQUE_BUCKET = [
  // Effort & competence
  'gave up halfway', 'lost the plot', 'missed the memo',
  'skipped the tutorial', 'committed to nothing', 'called in sick',
  'went through the motions', 'ran out of ideas', 'quit mid-sentence',
  'phoned it in', 'half-finished the thought', 'peaked before starting',
  'showed up but didn\'t arrive', 'clocked in but checked out',
  'tried once and gave up', 'never made it past the draft',
  'started strong then folded', 'gave up before the photo loaded',
  'is running on fumes', 'surrendered on contact',
  // Confidence mismatch
  'overcompensates', 'tries too hard', 'fakes confidence poorly',
  'fronts harder than it delivers', 'forgot to be convincing',
  'reads as borrowed', 'begs for validation', 'broadcasts desperation',
  'oversells and underdelivers', 'promised more than it gave',
  'is all trailer, no movie', 'wrote a check it can\'t cash',
  'has main character delusion on a background budget',
  'carries unearned swagger', 'leads with ego, delivers nothing',
  'is cosplaying competence', 'is performing for an audience that left',
  'confuses volume for substance', 'is loud for no reason',
  'is a cover letter for a job that doesn\'t exist',
  // Social verdict
  'already made the decision for everyone', 'tells on you',
  'answers questions nobody asked', 'proves the point',
  'is the punchline nobody needed', 'invites follow-up questions nobody wants to ask',
  'speaks volumes and none of them are good',
  'says everything you were trying to hide',
  'confirms what people suspected', 'settled the debate',
  'ended the conversation before it started',
  'made the case against you', 'filed the paperwork',
  'is the before photo with no after', 'sealed the verdict',
  // Quality / result
  'works against you', 'needs a second draft', 'flatlines on arrival',
  'delivers diminishing returns', 'is the wrong answer',
  'auditioned and lost', 'set the bar underground',
  'came pre-defeated', 'carries the whole disappointment',
  'reeks of last resort', 'is a liability',
  'lowers the bar', 'peaked already', 'peaked in 2019',
  'has clearance energy', 'was the backup plan\'s backup plan',
  'is giving participation trophy', 'missed the assignment',
  'needs a patch update', 'is still in beta',
  'never left early access', 'got returned unopened',
  'looks like it runs on excuses', 'bricked on arrival',
  'is the demo version nobody downloaded',
  // Specificity / what it reveals
  'raises concerns', 'functions as a warning',
  'is exhibit B', 'files under regret', 'invites pity',
  'makes excuses for you', 'folds under pressure',
  'screams rental energy', 'never got a second opinion',
  'is doing the heavy lifting and losing',
  'looks like it was someone else\'s idea',
  'has the range of a parking meter', 'lost its warranty',
  'was already on clearance', 'got marked down twice',
  'is the free sample nobody took', 'left the receipt visible',
  'has the shelf life of a sneeze', 'aged like milk in July',
  'expired before opening', 'was outdated on arrival',
  // Delusional / misread
  'misread the room completely', 'thought this was the move',
  'came in with the wrong playbook', 'solved the wrong problem',
  'studied for the wrong test', 'dressed for a different event',
  'showed up to the wrong audition', 'played the wrong character',
  'brought a speech to a roast', 'rehearsed for a crowd that wasn\'t there',
  'prepared for a different genre', 'is in the wrong category',
  'entered the wrong competition', 'answered the wrong question',
  // Underwhelming / forgettable
  'registered as a maybe', 'landed with a thud',
  'had the impact of a read receipt', 'went straight to spam',
  'got archived on sight', 'got scrolled past',
  'is the human skip button', 'buffered and never loaded',
  'loaded at 144p', 'rendered in low resolution',
  'got cropped out of the group photo', 'is the unsent draft',
  'is the notification nobody checks', 'went to voicemail',
  'is the unread message in the thread', 'barely made the feed',
  // Style / taste fail
  'made a statement and it was wrong', 'committed to the wrong aesthetic',
  'has the coordination of a random generator',
  'looks algorithm-suggested', 'has auto-complete styling',
  'was styled by autocorrect', 'has default settings showing',
  'is the stock photo of choices', 'has factory preset written all over it',
  'looks like the sample image nobody replaced',
  'has the creativity of a placeholder', 'is the template someone forgot to edit',
  // Effort-related
  'needed more prep time', 'deserved a second attempt',
  'should have stayed in drafts', 'was posted prematurely',
  'wasn\'t ready for the public', 'needed another review cycle',
  'launched without testing', 'shipped with known bugs',
  'was released too early', 'needed one more pass',
  // Timing / awareness
  'arrived late and still missed the point', 'showed up after the moment passed',
  'is the encore nobody requested', 'walked in after last call',
  'is the reply to a thread that moved on',
];

// --- Escalation Bucket (120+) — closers / social verdicts ---
// Short, screenshot-friendly, micdrop-style (2–6 words)
const NV2_ESCALATION_BUCKET = [
  // Short punches (nuclear)
  'Ratio\'d', 'Muted', 'Archived', 'Blocked', 'Reported',
  'Benched', 'Expired', 'Voided', 'Flagged', 'Sidelined',
  // Dismissals
  'Hard pass', 'Returned to sender', 'Unsubscribed',
  'Sent to spam', 'Left on read', 'Swiped left',
  // Platform actions
  'Comments off', 'Notifications muted', 'DMs closed',
  'Story expired', 'Account suspended',
  'Unfollowed in real time', 'Blocked mid-scroll',
  'Reported for spam', 'Removed from Close Friends',
  // Receipts
  'Receipts exist', 'Screenshot-worthy', 'Forwarded without comment',
  'Jury is back', 'Filed under cringe',
  'Permanently on record', 'Seen and screenshotted',
  // Social verdict
  'Crowd went quiet', 'Nobody is fooled',
  'Audience left early', 'Everyone saw that',
  'The room remembers', 'Table went silent',
  // Status burns
  'Not the flex', 'Not the serve', 'Not recoverable',
  'NPC behavior', 'Budget confidence', 'Main character denied',
  'Appeal denied', 'Application rejected',
  'Access revoked', 'Membership cancelled',
  // Effort calls
  'Back to drafts', 'Rough draft at best',
  'Rejected on first read', 'Peer review failed',
  // Internet burns
  'Ratio incoming', 'Engagement: zero',
  'Views but no saves', 'The feed recovered',
  'Highlights reel reject', 'Content warning needed',
];

// --- Safe fallback templates (for when play-safe filter blocks everything) ---
const NV2_SAFE_FALLBACKS = [
  'That angle was a creative choice. The creativity is debatable.',
  'Your confidence walked in without reading the room. Nobody clapped.',
  'This photo has cover letter energy. Nobody asked for it.',
  'Bold strategy going with this look. Bold, not effective.',
  'You posed like you rehearsed this. The rehearsal needed rehearsal.',
];

// --- Freeform stem bans (nuclear-v2 freeform mode) ---
const NV2_FREEFORM_STEM_BANS = [
  'got ammo', 'bench yourself', 'camera was too generous',
  'internet took screenshots', 'turned off notifications',
  'left the chat', 'the timeline remembers',
];

// --- Play-Safe content filter ---
const NV2_DENY_SLURS = [
  // Racial/ethnic slurs (abbreviated patterns to catch variants)
  'nigger', 'nigga', 'chink', 'spic', 'kike', 'wetback', 'gook', 'coon',
  'beaner', 'towelhead', 'raghead', 'redskin', 'cracker',
  // Sexuality/gender slurs
  'faggot', 'fag', 'dyke', 'tranny', 'shemale',
  // Disability slurs
  'retard', 'retarded', 'cripple', 'spaz',
];

const NV2_DENY_PROTECTED = [
  // Protected attribute words (when used as insult basis)
  'race', 'racist', 'racism', 'ethnic', 'ethnicity',
  'religion', 'religious', 'muslim', 'jewish', 'christian', 'hindu', 'sikh',
  'gay', 'lesbian', 'bisexual', 'transgender', 'queer', 'homosexual',
  'disabled', 'disability', 'autistic', 'autism', 'wheelchair',
  'black people', 'white people', 'asian people', 'latino', 'latina',
];

const NV2_DENY_VIOLENCE = [
  'kill yourself', 'kill you', 'hurt you', 'should die', 'go die',
  'kys', 'end yourself', 'neck yourself', 'slit', 'stab', 'shoot you',
  'hang yourself', 'jump off', 'off yourself',
];

const NV2_DENY_SEXUAL = [
  'rape', 'molest', 'fuck you', 'suck my', 'cum', 'orgasm',
  'genitals', 'penis', 'vagina', 'tits', 'boobs',
];

// Appearance-feature insult denylist — medical/disability-sensitive terms only
const NV2_DENY_APPEARANCE = [
  'nose', 'teeth', 'acne', 'skin',
];

function isPlaySafe(text) {
  const lower = text.toLowerCase();
  for (const term of NV2_DENY_SLURS) {
    if (lower.includes(term)) return false;
  }
  for (const term of NV2_DENY_PROTECTED) {
    if (lower.includes(term)) return false;
  }
  for (const term of NV2_DENY_VIOLENCE) {
    if (lower.includes(term)) return false;
  }
  for (const term of NV2_DENY_SEXUAL) {
    if (lower.includes(term)) return false;
  }
  // Appearance-feature attacks (word-boundary to avoid false positives)
  for (const term of NV2_DENY_APPEARANCE) {
    if (new RegExp(`\\b${term}\\b`, 'i').test(text)) return false;
  }
  // Self-harm encouragement patterns
  if (/\b(kill|hurt|harm)\s+(yourself|themselves|myself)\b/i.test(text)) return false;
  if (/\bsuicid/i.test(text)) return false;
  return true;
}

// --- Per-client repetition memory ---
const nuclearClientState = new Map();
const savageStructureHistory = new Map();
const savageFamilyHistory = new Map();

function getSavageFamilyHistory(clientId) {
  return savageFamilyHistory.get(clientId || 'anon') || [];
}

function pushSavageFamilyHistory(clientId, familyId) {
  const key = clientId || 'anon';
  const arr = savageFamilyHistory.get(key) || [];
  arr.push(familyId);
  while (arr.length > 3) arr.shift();
  savageFamilyHistory.set(key, arr);
}

const NV2_MAX_RECENT_ROASTS = 20;
const NV2_MAX_RECENT_TARGETS = 6;
const NV2_MAX_RECENT_STRUCTURES = 6;
const NV2_MAX_RECENT_OPENER_TYPES = 6;
const NV2_AVOID_LAST_N = 2; // avoid targets/structures used in last N requests
const NV2_MAX_SELECT_TRIES = 20; // max tries before allowing repeat

// Classify structure template opener type
function nv2GetOpenerType(tpl) {
  if (tpl.startsWith('Your ') || tpl.startsWith('your ')) return 'YOUR';
  if (tpl.startsWith('That ') || tpl.startsWith('that ')) return 'THAT';
  if (tpl.startsWith('The ') || tpl.startsWith('the ')) return 'THE';
  return 'OTHER';
}

// Social-context terms for nuclear status hits (weighted)
// Generic personal anchors — limited set so they don't dominate
const GENERIC_OUTFIT_ANCHORS = ['fit', 'outfit'];
const GENERIC_OUTERWEAR_ANCHORS = ['jacket', 'hoodie', 'coat'];
const GENERIC_HAIR_ANCHORS  = ['hair'];

// Social context pools — three modes with per-client repeat avoidance
const NV2_SOCIAL_IMPLICIT = ['people', 'everyone', 'the internet', 'the whole room', 'anybody watching'];
const NV2_SOCIAL_PLATFORM = ['the comments', 'the feed', 'the timeline', 'the algorithm'];
const NV2_SOCIAL_OFFLINE  = ['your mates', 'group chat', 'someone you know'];
const NV2_MAX_RECENT_SOCIAL = 5;

const NV2_AUDIENCE_COOLDOWN = 5;
const NV2_OVERUSED_AUDIENCE = new Set(['anybody watching']);

function nv2PickSocialContext(clientId) {
  const st = getClientState(clientId);
  if (!st.recentSocialContexts) st.recentSocialContexts = [];
  if (!st.recentAudiencePhrases) st.recentAudiencePhrases = [];
  const avoid = new Set(st.recentAudiencePhrases.slice(-NV2_AUDIENCE_COOLDOWN));

  // Mode roll: 75% implicit, 15% platform, 10% offline
  const roll = Math.random();
  let pool;
  if (roll < 0.75) {
    pool = NV2_SOCIAL_IMPLICIT;
  } else if (roll < 0.90) {
    pool = NV2_SOCIAL_PLATFORM;
  } else {
    pool = NV2_SOCIAL_OFFLINE;
  }

  // Pick from pool, avoiding recent audience phrases
  let candidates = pool.filter(t => !avoid.has(t));
  // Extra penalty: halve chance of overused phrases by filtering them 50% of the time
  if (candidates.length > 1 && Math.random() < 0.5) {
    const filtered = candidates.filter(t => !NV2_OVERUSED_AUDIENCE.has(t));
    if (filtered.length > 0) candidates = filtered;
  }
  if (candidates.length === 0) candidates = pool;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  st.recentAudiencePhrases.push(pick);
  if (st.recentAudiencePhrases.length > 10) st.recentAudiencePhrases.shift();
  st.recentSocialContexts.push(pick);
  if (st.recentSocialContexts.length > 10) st.recentSocialContexts.shift();
  return pick;
}

function getClientState(clientId) {
  if (!nuclearClientState.has(clientId)) {
    nuclearClientState.set(clientId, {
      recentRoasts: [],
      recentTargets: [],
      recentStructures: [],
      recentOpenerTypes: [],
      recentMicdrops: [],
      recentSocialContexts: [],
    });
  }
  const st = nuclearClientState.get(clientId);
  // Backfill for existing clients
  if (!st.recentMicdrops) st.recentMicdrops = [];
  if (!st.recentSocialContexts) st.recentSocialContexts = [];
  if (!st.recentNuclearTexts) st.recentNuclearTexts = [];
  if (!st.recentAudiencePhrases) st.recentAudiencePhrases = [];
  if (!st.lastSentenceStarter) st.lastSentenceStarter = null;
  if (!st.nv2RecentWinners) st.nv2RecentWinners = [];
  return st;
}

function pushClientRoast(clientId, roast, target, structureId, openerType) {
  const st = getClientState(clientId);
  st.recentRoasts.push(roast);
  if (st.recentRoasts.length > NV2_MAX_RECENT_ROASTS) st.recentRoasts.shift();
  st.recentTargets.push(target);
  if (st.recentTargets.length > NV2_MAX_RECENT_TARGETS) st.recentTargets.shift();
  st.recentStructures.push(structureId);
  if (st.recentStructures.length > NV2_MAX_RECENT_STRUCTURES) st.recentStructures.shift();
  st.recentOpenerTypes.push(openerType);
  if (st.recentOpenerTypes.length > NV2_MAX_RECENT_OPENER_TYPES) st.recentOpenerTypes.shift();
}

// --- Micdrop selection with per-client memory ---
const NV2_MAX_RECENT_MICDROPS = 16;
const NV2_MICDROP_AVOID_LAST_N = 5;

function nv2DetectMicdropLane(target, setting, angle, lighting, pose) {
  const t = (target || '').toLowerCase();
  const s = (setting || '').toLowerCase();
  if (angle || t.includes('angle') || t.includes('crop') || t.includes('framing')) return 'camera';
  if (lighting || t.includes('lighting') || t.includes('light') || t.includes('shadow')) return 'lighting';
  if (s.includes('garage') || t.includes('garage') || t.includes('car') || t.includes('tool') || t.includes('tire')) return 'garage';
  if (s.includes('outdoor') || t.includes('grass') || t.includes('palm') || t.includes('tree') || t.includes('park')) return 'outdoors';
  if (t.includes('monitor') || t.includes('keyboard') || t.includes('desk') || t.includes('cable') || t.includes('setup') || s.includes('office')) return 'tech';
  if (pose || t.includes('pose') || t.includes('lean') || t.includes('stance') || t.includes('arm cross')) return 'confidence';
  return null;
}

function nv2SelectMicdrop(clientId, lane) {
  const st = getClientState(clientId);
  const avoidSet = new Set(st.recentMicdrops.slice(-NV2_MICDROP_AVOID_LAST_N));

  // Pick from lane pool first (50% chance if lane exists), else general
  let pool;
  if (lane && NV2_MICDROPS_LANE[lane] && Math.random() < 0.5) {
    pool = NV2_MICDROPS_LANE[lane];
  } else {
    pool = NV2_MICDROPS; // already filtered to 3+ words
  }

  for (let i = 0; i < 10; i++) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!avoidSet.has(pick)) {
      st.recentMicdrops.push(pick);
      if (st.recentMicdrops.length > NV2_MAX_RECENT_MICDROPS) st.recentMicdrops.shift();
      return pick;
    }
  }
  // Fallback: general pool allowing repeat
  const fallbackPool = NV2_MICDROPS;
  const pick = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
  st.recentMicdrops.push(pick);
  if (st.recentMicdrops.length > NV2_MAX_RECENT_MICDROPS) st.recentMicdrops.shift();
  return pick;
}

// --- Helpers ---
function nv2CleanOutput(text) {
  // Strip leading/trailing whitespace, quotes, markdown artifacts, newlines
  let out = text.trim()
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
  // Enforce 1–2 sentences: split on sentence boundaries OUTSIDE of quotes
  // Simple heuristic: replace periods inside quotes temporarily
  const masked = out.replace(/"[^"]*"/g, m => m.replace(/[.!?]/g, '\x00'));
  const sents = masked.match(/[^.!?]*[.!?]+/g);
  if (sents && sents.length > 2) {
    // Restore masked chars in the first 2 sentences
    const kept = sents.slice(0, 2).map(s => s.trim().replace(/\x00/g, '.')).join(' ');
    out = kept;
  }
  // Ensure ends with punctuation
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

// --- Bucket A: hard-banned phrases (AI-crutch, meta-commentary) ---
const NV2_BANNED_PHRASES = [
  'confidence was a mistake', 'evidence submitted', 'read that back',
  'impact: none', 'impact none', 'confirmed on arrival',
];
const NV2_BANNED_OPENERS_RE = /^(With that|Your vibe|Your expression|It'?s giving)\b/i;

// --- Bucket B: soft-penalty terms (can be nuclear, but overused = medium feel) ---
const NV2_SOFT_PENALTY_TERMS = [
  'try again', 'kind of', 'maybe', 'a bit', 'low-key', 'low key',
];

function nv2HasBannedPatterns(text, _debugLabel) {
  const checks = [
    [/\bYou (imagine|expect|insist|assume|pretend)\b/i, 'passive-you-verb'],
    [/\b(do(es)?|is(n't)?|is not) (doing )?you (any )?favors\b/i, 'does-you-favors'],
  ];
  for (const [re, label] of checks) {
    if (re.test(text)) {
      if (_debugLabel) _debugLabel.matched = label;
      return true;
    }
  }
  const lower = text.toLowerCase();
  for (const p of NV2_BANNED_PHRASES) {
    if (lower.includes(p)) {
      if (_debugLabel) _debugLabel.matched = `phrase:${p}`;
      return true;
    }
  }
  if (NV2_BANNED_OPENERS_RE.test(text.trim())) {
    if (_debugLabel) _debugLabel.matched = 'crutch-opener';
    return true;
  }
  return false;
}

// Soft-penalty score: -10 per B-term hit, capped at -30
// Includes former hard-bans demoted to penalties (lighting crutch, question marks)
const NV2_SOFT_PENALTY_PATTERNS = [
  { re: /\bthe lighting\b/i, label: 'lighting-crutch' },
  { re: /\?/, label: 'question-mark' },
];
function nv2SoftPenalty(text, isDev) {
  const lower = text.toLowerCase();
  let penalty = 0;
  for (const term of NV2_SOFT_PENALTY_TERMS) {
    if (lower.includes(term)) penalty -= 10;
  }
  for (const { re, label } of NV2_SOFT_PENALTY_PATTERNS) {
    if (re.test(text)) {
      penalty -= 10;
      if (isDev) console.log(`[nuclear-v2] penalty applied: ${label}`);
    }
  }
  return Math.max(-30, penalty);
}

function nv2SelectWithAvoidance(pool, recentList, maxTries) {
  const avoidSet = new Set(recentList.slice(-NV2_AVOID_LAST_N));
  for (let i = 0; i < maxTries; i++) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const key = typeof pick === 'object' ? pick.id : pick;
    if (!avoidSet.has(key)) return pick;
  }
  // Fallback: allow repeat
  return pool[Math.floor(Math.random() * pool.length)];
}

// Nuclear structure scoring: bias toward social-context templates
const NV2_SOCIAL_RE = /\b(group chat|linkedin|HR|drafts?|screenshot|audience|everyone|nobody|crowd|timeline|comment|room|SOCIAL|ratio|reported|muted|blocked|unfollowed)\b/i;
const NV2_STATUS_VERB_RE = /\b(humiliated|exposed|benched|suspended|demoted|archived|rejected|cancelled|muted|flagged|ratio|reported|blocked|unfollowed)\b/i;
const NV2_MEDIUM_PENALTY_RE = /\b(confidence was a mistake|evidence submitted|read that back|try again|impact.?none|confirmed on arrival)\b/i;

function nv2ScoreStructure(tpl) {
  let score = 10; // base
  if (NV2_SOCIAL_RE.test(tpl)) score += 10;
  if (NV2_STATUS_VERB_RE.test(tpl)) score += 10;
  if (NV2_MEDIUM_PENALTY_RE.test(tpl)) score -= 10;
  return Math.max(1, score);
}

// Pre-compute scores for all structure templates
const NV2_STRUCTURE_SCORES = NV2_STRUCTURE_TEMPLATES.map(s => nv2ScoreStructure(s.tpl));
const NV2_STRUCTURE_SCORE_TOTAL = NV2_STRUCTURE_SCORES.reduce((a, b) => a + b, 0);

function nv2WeightedStructurePick(pool, avoidSet) {
  // Build weighted pool excluding recently used
  const candidates = [];
  let totalWeight = 0;
  for (let i = 0; i < pool.length; i++) {
    if (avoidSet.has(pool[i].id)) continue;
    // Find score from precomputed (match by id)
    const idx = NV2_STRUCTURE_TEMPLATES.findIndex(s => s.id === pool[i].id);
    const w = idx >= 0 ? NV2_STRUCTURE_SCORES[idx] : 10;
    candidates.push({ struct: pool[i], weight: w });
    totalWeight += w;
  }
  if (candidates.length === 0) return pool[Math.floor(Math.random() * pool.length)];
  let r = Math.random() * totalWeight;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c.struct;
  }
  return candidates[candidates.length - 1].struct;
}

// --- Scene tagger: extract safe scene nouns from image ---
const NV2_SCENE_DENYLIST = new Set([
  // Body/identity terms to filter out of scene tags
  'person', 'man', 'woman', 'boy', 'girl', 'face', 'body', 'skin',
  'arm', 'leg', 'hand', 'foot', 'finger', 'eye', 'nose', 'mouth',
  'ear', 'hair', 'chest', 'stomach', 'back', 'neck', 'shoulder',
  'teeth', 'lip', 'chin', 'forehead', 'cheek', 'elbow', 'knee',
  'breast', 'butt', 'thigh', 'hip', 'torso', 'head', 'skull',
  'child', 'kid', 'baby', 'teen', 'adult', 'male', 'female',
  'black', 'white', 'asian', 'latino', 'latina', 'race', 'ethnicity',
  // Generic structural/non-roastable nouns
  'roof', 'ceiling', 'wall', 'floor', 'corner', 'beam', 'frame',
  'canister', 'container', 'object', 'item', 'surface', 'edge',
  'background', 'shadow', 'reflection', 'space', 'area', 'room',
]);

// Preferred roastable scene objects — tech/room items that make good targets
const NV2_SCENE_ALLOWLIST_KEYWORDS = new Set([
  'monitor', 'keyboard', 'desk', 'chair', 'shelf', 'bottle', 'cup',
  'papers', 'cables', 'lights', 'tools', 'garage', 'poster', 'speaker',
  'mic', 'headset', 'lamp', 'screen', 'laptop', 'phone', 'mouse',
  'controller', 'console', 'tv', 'camera', 'tripod', 'whiteboard',
  'fan', 'clock', 'plant', 'towel', 'mirror', 'sticker', 'figurine',
]);

function nv2FilterSceneNouns(rawNouns) {
  return rawNouns
    .map(s => String(s).trim().toLowerCase())
    .filter(s => s.length >= 2 && s.length <= 18)
    // Remove multiword phrases >2 words
    .filter(s => s.split(/\s+/).length <= 2)
    .filter(s => !NV2_SCENE_DENYLIST.has(s) && !NV2_SCENE_DENYLIST.has(s.split(/\s+/)[0]))
    // Boost: sort allowlisted items first
    .sort((a, b) => {
      const aMatch = NV2_SCENE_ALLOWLIST_KEYWORDS.has(a) || NV2_SCENE_ALLOWLIST_KEYWORDS.has(a.split(/\s+/)[0]) ? 1 : 0;
      const bMatch = NV2_SCENE_ALLOWLIST_KEYWORDS.has(b) || NV2_SCENE_ALLOWLIST_KEYWORDS.has(b.split(/\s+/)[0]) ? 1 : 0;
      return bMatch - aMatch;
    })
    .slice(0, 12);
}

function nv2ToDataUrl(imageBase64, fallbackMime = 'image/jpeg') {
  if (!imageBase64) return `data:${fallbackMime};base64,`;
  if (typeof imageBase64 === 'string' && imageBase64.startsWith('data:image/')) return imageBase64;
  return `data:${fallbackMime};base64,${imageBase64}`;
}

async function nv2ExtractSceneNouns(imageBase64) {
  const isDev = process.env.NODE_ENV !== 'production';
  try {
    const resp = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'system', content: 'You list concrete objects/background elements in photos. Output ONLY a JSON array of 6–12 short nouns (1–2 words each). No people/body attributes. Example: ["monitor","keyboard","LED strip","posters","desk"]' },
        { role: 'user', content: [
          { type: 'input_text', text: 'List 6–12 concrete objects or background elements visible in this photo as short nouns (1–2 words each). No people or body attributes. JSON array only.' },
          { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
        ]},
      ],
      max_output_tokens: 120,
      temperature: 0.3,
    });
    const raw = (resp.output_text || '').trim();
    // Parse JSON array safely
    const arr = JSON.parse(raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim());
    if (!Array.isArray(arr)) return [];
    return nv2FilterSceneNouns(arr);
  } catch (err) {
    if (isDev) console.log(`[nuclear-v2] scene-tagger error: ${err.message}`);
    return [];
  }
}

// --- Safe Selfie Tags extractor (vision-based, nuclear-v2 only) ---
const NV2_SELFIE_TAG_ALLOWED_ANGLES = new Set(['low angle','high angle','straight-on','tilted','off-center','unknown']);
const NV2_SELFIE_TAG_ALLOWED_LIGHTING = new Set(['dim','harsh','backlit','screen glow','bright','mixed','unknown']);
const NV2_SELFIE_TAG_ALLOWED_FRAMING = new Set(['close crop','too far','awkward crop','centered','unknown']);
const NV2_SELFIE_TAG_ALLOWED_POSE = new Set(['stiff','forced casual','over-serious','trying-to-look-cool','deadpan','unknown']);
const NV2_SELFIE_TAG_ALLOWED_HAIR = new Set([
  'messy','greasy','flat','overgrown','slicked','helmet hair',
  'bed head','windswept','frizzy','unkempt','freshly cut',
  'dyed','parted','buzzed','unknown'
]);
const NV2_SELFIE_TAG_ALLOWED_OUTFIT = new Set([
  'wrinkled','oversized','too tight','mismatched','graphic tee',
  'athleisure','pajamas','formal','layered','plain',
  'branded','vintage','basic','gym clothes','uniform','unknown'
]);
const NV2_SELFIE_TAG_ALLOWED_EXPRESSION = new Set([
  'blank','smug','confused','bored','forced smile',
  'duck face','squinting','surprised','zoned out','intense',
  'unbothered','cringe','awkward grin','side-eye','pouty','frown','unknown'
]);
const NV2_SELFIE_TAG_ALLOWED_GROOMING = new Set([
  'unshaved','over-groomed','low-effort',
  'freshly trimmed','scraggly','clean-shaven','five-o-clock shadow',
  'peach fuzz','handlebar','soul patch','unknown'
]);
const NV2_SELFIE_TAG_ALLOWED_BG_VIBE = new Set([
  'cluttered','sterile','chaotic','bare','staged',
  'dingy','flex-heavy','trying too hard','lived-in',
  'fluorescent','grim','corporate','basement','unknown'
]);
const NV2_SELFIE_TAG_OBJECT_DENYLIST = new Set([
  'person', 'man', 'woman', 'boy', 'girl', 'face', 'body', 'skin',
  'arm', 'leg', 'hand', 'foot', 'finger', 'eye', 'nose', 'mouth',
  'ear', 'hair', 'chest', 'stomach', 'back', 'neck', 'shoulder',
  'teeth', 'lip', 'chin', 'forehead', 'cheek', 'elbow', 'knee',
  'breast', 'butt', 'thigh', 'hip', 'torso', 'head', 'skull',
  'child', 'kid', 'baby', 'teen', 'adult', 'male', 'female',
  'black', 'white', 'asian', 'latino', 'latina', 'race', 'ethnicity',
  'human', 'people', 'figure', 'selfie', 'portrait',
]);

// Normalize tag string: trim, lowercase, collapse whitespace, fix unicode quotes/hyphens
function normTag(v) {
  if (typeof v !== 'string') return null;
  return v
    .toLowerCase()
    .trim()
    .replace(/['\u2019]/g, "'")
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
}

// Synonym mappers: return allowlisted value or pass through
const HAIR_SYNONYMS = { short: 'freshly cut', trimmed: 'freshly cut', neat: 'freshly cut', bald: 'buzzed', shaved: 'buzzed', curly: 'frizzy', wavy: 'frizzy' };
function mapHair(v) { return v && HAIR_SYNONYMS[v] || v; }

const EXPRESSION_SYNONYMS = {
  neutral: 'deadpan', serious: 'deadpan', tired: 'bored',
  'straight face': 'deadpan', 'straight-faced': 'deadpan', 'neutral expression': 'deadpan',
  'no expression': 'deadpan', expressionless: 'deadpan', 'blank stare': 'deadpan', 'flat expression': 'deadpan',
  smile: 'awkward grin', smiling: 'awkward grin', 'big smile': 'awkward grin', grin: 'awkward grin', grinning: 'awkward grin', beaming: 'awkward grin',
  frown: 'frown', frowning: 'frown', scowl: 'frown', scowling: 'frown' };
function mapExpression(v) { return v && EXPRESSION_SYNONYMS[v] || v; }

const OUTFIT_SYNONYMS = { jacket: 'layered', hoodie: 'layered', coat: 'layered', outerwear: 'layered' };
function mapOutfit(v) { return v && OUTFIT_SYNONYMS[v] || v; }

const GROOMING_SYNONYMS = { stubble: 'five-o-clock shadow', beard: 'unshaved', mustache: 'handlebar' };
function mapGrooming(v) { return v && GROOMING_SYNONYMS[v] || v; }
// Helper: true if tag is a real known value (not null, undefined, or 'unknown')
function isKnownTag(v) { return !!v && v !== 'unknown'; }
// Helper: clean tag token — returns null for empty, "unknown", or "null" strings
function cleanTagToken(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === 'unknown' || s === 'null') return null;
  return s;
}

async function extractSafeSelfieTags(imageInput) {
  const isDev = process.env.NODE_ENV !== 'production';
  const emptyResult = { objects: [], angle: 'unknown', lighting: 'unknown', framing: 'unknown', setting: 'unknown', pose: 'unknown', hair: 'unknown', outfit: 'unknown', expression: 'unknown', grooming: 'unknown', bg_vibe: 'unknown', face_visibility: 'not_visible', face_confidence: 'low', hair_confidence: 'low', person_present: 'no', hair_visible: 'no', outfit_visible: 'no', outerwear_visible: 'no', face_visible: 'no', face_obstructed: 'no' };
  try {
    const resp = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'system', content: 'You analyze photos for safe visual qualities only. Output ONLY valid JSON. Never mention identity, race, gender, age, body size, attractiveness, or protected traits. Never mention nudity or sexual content.' },
        { role: 'user', content: [
          { type: 'input_text', text: 'Look at the image. Output ONLY valid JSON matching this schema: {"objects":[],"angle":"unknown","lighting":"unknown","framing":"unknown","setting":null,"pose":"unknown","hair":"unknown","outfit":"unknown","expression":"unknown","grooming":"unknown","bg_vibe":"unknown","face_visible":"no","face_obstructed":"no","face_visibility":"not_visible","face_confidence":"low","hair_confidence":"low","person_present":"no","hair_visible":"no","outfit_visible":"no","outerwear_visible":"no"}. Deterministic face mapping: - If face_visible="yes" AND face_obstructed="no", then face_visibility MUST be "clear". - If face_visible="no", then face_visibility MUST be "not_visible". - If face_visible="yes" AND face_obstructed="yes", then face_visibility MUST be "partial" or "obscured" (choose based on severity). Visibility definitions: - face_visible="yes" if a face is present at all. - face_obstructed="yes" only if the face is cropped, blurred, heavily shadowed, or mostly covered. Confidence rule: - If face_visible="yes" AND face_obstructed="no", face_confidence MUST be at least "medium". objects: 0-12 nouns (monitor, keyboard, desk, tools, etc.). angle: one of "low angle","high angle","straight-on","tilted","off-center","unknown". lighting: one of "dim","harsh","backlit","screen glow","bright","mixed","unknown". framing: one of "close crop","too far","awkward crop","centered","unknown". setting: short label like "garage","bedroom","office","outdoors","plain wall" or null. pose: one of "stiff","forced casual","over-serious","trying-to-look-cool","deadpan","unknown". hair: one of "messy","greasy","flat","overgrown","slicked","helmet hair","bed head","windswept","frizzy","unkempt","freshly cut","dyed","parted","buzzed","unknown". outfit: one of "wrinkled","oversized","too tight","mismatched","graphic tee","athleisure","pajamas","formal","layered","plain","branded","vintage","basic","gym clothes","uniform","unknown". expression: one of "blank","smug","confused","bored","forced smile","duck face","squinting","surprised","zoned out","intense","unbothered","cringe","awkward grin","side-eye","pouty","frown","unknown". grooming: one of "unshaved","over-groomed","low-effort","freshly trimmed","scraggly","clean-shaven","five-o-clock shadow","peach fuzz","handlebar","soul patch","unknown". bg_vibe: one of "cluttered","sterile","chaotic","bare","staged","dingy","flex-heavy","trying too hard","lived-in","fluorescent","grim","corporate","basement","unknown". face_visible: one of "yes","no". face_obstructed: one of "yes","no". face_visibility: one of "clear","partial","obscured","not_visible". face_confidence: one of "low","medium","high". hair_confidence: one of "low","medium","high". person_present: one of "yes","no". hair_visible: one of "yes","no". outfit_visible: one of "yes","no". outerwear_visible: one of "yes","no". Outerwear rule: - outerwear_visible="yes" ONLY if a jacket, hoodie, coat, or outer layer is clearly present. - outerwear_visible="no" otherwise. Visibility rules: - If any person is visible, set person_present="yes". - If hair is visible, set hair_visible="yes" and hair_confidence to at least "medium". Hair may still be "unknown" if the style cannot be classified. - If clothing/outfit is visible, set outfit_visible="yes". Outfit label may remain "unknown" if unclear. Expression rule: - If the facial expression is clearly visible (e.g. smiling, grinning, frowning, scowling), choose the closest matching enum label instead of "unknown". - Broad smiles with teeth visible should map to "awkward grin" unless clearly subtle and relaxed. - Obvious frowns or scowls should map to "frown". - Use "unknown" only when the expression cannot be reasonably inferred. Keep hair/grooming/outfit as "unknown" unless clearly visible enough to classify confidently. If unsure, return "unknown" (not null) for enum fields. Only describe visible objects and SAFE photo/style qualities. Do NOT mention identity, race, gender, age, body size, attractiveness, or protected traits. Do NOT mention nudity/sexual content. Output ONLY valid JSON, no markdown fences.' },
          { type: 'input_image', image_url: nv2ToDataUrl(imageInput) },
        ]},
      ],
      max_output_tokens: 350,
      temperature: 0.5,
    });
    const raw = (resp.output_text || '').trim();
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (process.env.DEBUG_TAGS === '1') console.log('[nuclear-v2] raw parsed selfie-tags:', parsed);

    // Filter objects: keep only safe nouns
    const objects = (Array.isArray(parsed.objects) ? parsed.objects : [])
      .map(s => String(s).trim().toLowerCase())
      .filter(s => s.length >= 2 && s.length <= 30)
      .filter(s => !NV2_SELFIE_TAG_OBJECT_DENYLIST.has(s) && !NV2_SELFIE_TAG_OBJECT_DENYLIST.has(s.split(/\s+/)[0]))
      .slice(0, 12);

    // Validate enum fields via normTag (fallback to 'unknown' instead of null)
    const angleNorm = normTag(parsed.angle);
    const angle = angleNorm && NV2_SELFIE_TAG_ALLOWED_ANGLES.has(angleNorm) ? angleNorm : 'unknown';
    const lightingNorm = normTag(parsed.lighting);
    const lighting = lightingNorm && NV2_SELFIE_TAG_ALLOWED_LIGHTING.has(lightingNorm) ? lightingNorm : 'unknown';
    const framingNorm = normTag(parsed.framing);
    const framing = framingNorm && NV2_SELFIE_TAG_ALLOWED_FRAMING.has(framingNorm) ? framingNorm : 'unknown';
    const poseNorm = normTag(parsed.pose);
    const pose = poseNorm && NV2_SELFIE_TAG_ALLOWED_POSE.has(poseNorm) ? poseNorm : 'unknown';
    const setting = (typeof parsed.setting === 'string' && parsed.setting.trim() && parsed.setting.length <= 30) ? parsed.setting.toLowerCase().trim() : 'unknown';
    const hairNorm = mapHair(normTag(parsed.hair));
    const hair = hairNorm && NV2_SELFIE_TAG_ALLOWED_HAIR.has(hairNorm) ? hairNorm : 'unknown';
    const outfitNorm = mapOutfit(normTag(parsed.outfit));
    const outfit = outfitNorm && NV2_SELFIE_TAG_ALLOWED_OUTFIT.has(outfitNorm) ? outfitNorm : 'unknown';
    const exprNorm = mapExpression(normTag(parsed.expression));
    let expression = exprNorm && NV2_SELFIE_TAG_ALLOWED_EXPRESSION.has(exprNorm) ? exprNorm : 'unknown';
    const groomNorm = mapGrooming(normTag(parsed.grooming));
    const grooming = groomNorm && NV2_SELFIE_TAG_ALLOWED_GROOMING.has(groomNorm) ? groomNorm : 'unknown';
    const bgVibeNorm = normTag(parsed.bg_vibe);
    const bg_vibe = bgVibeNorm && NV2_SELFIE_TAG_ALLOWED_BG_VIBE.has(bgVibeNorm) ? bgVibeNorm : 'unknown';

    // Visibility/confidence fields
    const ALLOWED_FACE_VIS = new Set(['clear', 'partial', 'obscured', 'not_visible']);
    const ALLOWED_CONFIDENCE = new Set(['low', 'medium', 'high']);
    const ALLOWED_YES_NO = new Set(['yes', 'no']);
    const faceVisibleNorm = normTag(parsed.face_visible);
    const face_visible = faceVisibleNorm && ALLOWED_YES_NO.has(faceVisibleNorm) ? faceVisibleNorm : 'no';
    const faceObstructedNorm = normTag(parsed.face_obstructed);
    const face_obstructed = faceObstructedNorm && ALLOWED_YES_NO.has(faceObstructedNorm) ? faceObstructedNorm : 'no';
    // Parse model's face_visibility/confidence, then enforce deterministic mapping
    const faceVisNorm = normTag(parsed.face_visibility);
    let face_visibility = faceVisNorm && ALLOWED_FACE_VIS.has(faceVisNorm) ? faceVisNorm : 'partial';
    const faceConfNorm = normTag(parsed.face_confidence);
    let face_confidence = faceConfNorm && ALLOWED_CONFIDENCE.has(faceConfNorm) ? faceConfNorm : 'low';
    // Deterministic override from face_visible + face_obstructed
    if (face_visible === 'yes' && face_obstructed === 'no') {
      face_visibility = 'clear';
      if (face_confidence === 'low') face_confidence = 'medium';
    } else if (face_visible === 'no') {
      face_visibility = 'not_visible';
    }
    // face_visible=yes + face_obstructed=yes: keep model's partial/obscured (already validated)
    const hairConfNorm = normTag(parsed.hair_confidence);
    const hair_confidence = hairConfNorm && ALLOWED_CONFIDENCE.has(hairConfNorm) ? hairConfNorm : 'low';
    const personPresentNorm = normTag(parsed.person_present);
    const person_present = personPresentNorm && ALLOWED_YES_NO.has(personPresentNorm) ? personPresentNorm : 'no';
    const hairVisNorm = normTag(parsed.hair_visible);
    const hair_visible = hairVisNorm && ALLOWED_YES_NO.has(hairVisNorm) ? hairVisNorm : 'no';
    const outfitVisNorm = normTag(parsed.outfit_visible);
    const outfit_visible = outfitVisNorm && ALLOWED_YES_NO.has(outfitVisNorm) ? outfitVisNorm : 'no';
    const outerwearVisNorm = normTag(parsed.outerwear_visible);
    const outerwear_visible = outerwearVisNorm && ALLOWED_YES_NO.has(outerwearVisNorm) ? outerwearVisNorm : 'no';

    // Expression synonym enrichment: vary the expression token for anti-repetition
    {
      const EXPR_NEUTRAL = ['deadpan', 'blank stare', 'straight face', 'neutral stare', 'unbothered look'];
      const EXPR_SMILE = ['smile', 'polite smile', 'forced smile', 'half-smile'];
      const EXPR_AWKWARD_GRIN = ['awkward grin', 'uneasy grin', 'strained grin', 'trying-too-hard grin'];
      const EXPR_BIG_SMILE = ['wide grin', 'toothpaste-ad grin', 'overcommitted smile', 'full-send grin'];
      const _pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const originalExpression = expression;
      if ((!expression || expression === 'unknown') && face_visible === 'yes') {
        expression = _pickRandom(EXPR_NEUTRAL);
      } else if (expression === 'awkward grin') {
        expression = _pickRandom(EXPR_AWKWARD_GRIN);
      } else if (/smile/i.test(expression) && !/big|wide/i.test(expression)) {
        expression = _pickRandom(EXPR_SMILE);
      } else if (/big smile|wide grin/i.test(expression)) {
        expression = _pickRandom(EXPR_BIG_SMILE);
      } else if (expression === 'deadpan' || expression === 'blank') {
        expression = _pickRandom(EXPR_NEUTRAL);
      }
      if (expression !== originalExpression && isDev) console.log('[nuclear-v2] expression enriched', { originalExpression, newExpression: expression });
    }

    // Debug: log rejected/unknown tags when DEBUG_TAGS=1
    if (process.env.DEBUG_TAGS === '1') {
      if (parsed.hair && hair === 'unknown') console.log(`[selfie-tags] hair->unknown: raw="${parsed.hair}" norm="${normTag(parsed.hair)}" mapped="${hairNorm}"`);
      if (parsed.expression && expression === 'unknown') console.log(`[selfie-tags] expression->unknown: raw="${parsed.expression}" norm="${normTag(parsed.expression)}" mapped="${exprNorm}"`);
      if (parsed.grooming && grooming === 'unknown') console.log(`[selfie-tags] grooming->unknown: raw="${parsed.grooming}" norm="${normTag(parsed.grooming)}" mapped="${groomNorm}"`);
      if (parsed.pose && pose === 'unknown') console.log(`[selfie-tags] pose->unknown: raw="${parsed.pose}" norm="${poseNorm}"`);
      if (parsed.outfit && outfit === 'unknown') console.log(`[selfie-tags] outfit->unknown: raw="${parsed.outfit}" norm="${outfitNorm}"`);
      console.log(`[selfie-tags] face_visible=${face_visible} face_obstructed=${face_obstructed} face_visibility=${face_visibility} face_confidence=${face_confidence} person_present=${person_present} hair_visible=${hair_visible} outfit_visible=${outfit_visible} outerwear_visible=${outerwear_visible}`);
    }

    // Deterministic fallback: if hair is visible but tag is missing/unknown, use generic token
    const finalHair = (hair_visible === 'yes' && (!hair || hair === 'unknown')) ? 'hair' : hair;
    if (finalHair !== hair && isDev) console.log('[selfie-tags] hair fallback: visible but unknown, using generic "hair"');

    return { objects, angle, lighting, framing, setting, pose, hair: finalHair, outfit, expression, grooming, bg_vibe, face_visible, face_obstructed, face_visibility, face_confidence, hair_confidence, person_present, hair_visible, outfit_visible, outerwear_visible };
  } catch (err) {
    if (isDev) console.log(`[nuclear-v2] selfie-tags error: ${err.message}`);
    return emptyResult;
  }
}

// --- Modifier-phrase structure templates (use {MODIFIER} and {ESCALATION}) ---
// These REQUIRE modifierPhrase. 1–2 sentences, screenshot-friendly, no questions.
const NV2_MODIFIER_TEMPLATES = [
  { id: 'M01', tpl: 'You really went {MODIFIER} like {SOCIAL} wouldn\'t notice.' },
  { id: 'M02', tpl: 'You chose {MODIFIER} on purpose and {SOCIAL} archived you instantly.' },
  { id: 'M03', tpl: 'You committed to {MODIFIER} and {SOCIAL} committed to muting you.' },
  { id: 'M04', tpl: 'You hit upload going {MODIFIER} — {SOCIAL} reported you on sight.' },
  { id: 'M05', tpl: 'You went {MODIFIER} like it was a flex and {SOCIAL} ratio\'d you.' },
  { id: 'M06', tpl: 'Showed up {MODIFIER} and {SOCIAL} went completely silent.' },
  { id: 'M07', tpl: 'You posted yourself {MODIFIER} and {SOCIAL} turned off notifications.' },
  { id: 'M08', tpl: 'Shot this {MODIFIER} and thought {SOCIAL} would be impressed.' },
  { id: 'M09', tpl: 'You leaned into {MODIFIER} and {SOCIAL} unfollowed in real time.' },
  { id: 'M10', tpl: 'Got caught going {MODIFIER} — {SOCIAL} took screenshots.' },
  { id: 'M11', tpl: 'You doubled down on {MODIFIER} and {SOCIAL} blocked you mid-scroll.' },
  { id: 'M12', tpl: 'Tried {MODIFIER} like {SOCIAL} wouldn\'t notice the difference.' },
];

// --- Nuclear V2 micdrop pool (120+ entries, 3–5 words preferred) ---
// --- Lane-aware micdrop pools (all 3–6 words, punchy, Play-safe) ---
const NV2_MICDROPS_GENERAL = [
  // ego/delusion
  'Main character delusion.', 'Confidence not included.', 'Ego budget edition.',
  'Self-awareness sold separately.', 'Ego wrote a check.',
  'Main character denied again.', 'Confidence left the chat.', 'Ego needs a refund.',
  'Confidence without the resume.', 'Ego running on fumes.', 'Delusion runs deep here.',
  'Unearned swagger on display.', 'Ego exceeded its budget.', 'Main character energy denied.',
  'Confidence recalled immediately.', 'Hard reset your confidence.', 'Your ego needs patches.',
  'Not the flex you think.', 'Confidence: unlicensed software.', 'Ego overcharged and underdelivered.',
  // effort/quality
  'Rough draft energy only.', 'This needs a reboot.', 'Effort level critically low.',
  'Draft one of many.', 'Not ready for release.', 'First draft is showing.',
  'Minimum effort maximum confidence.', 'Standards were not met.', 'Execution fell apart fast.',
  'Effort left on read.', 'Work in progress forever.', 'Beta version at best.',
  'Shipped without testing.', 'Half finished at best.', 'This belongs in drafts.',
  'Pack it up, champ.',
  // social calibration
  'Wrong audience entirely.', 'Group chat already knows.', 'This won\'t age well.',
  'Read the room first.', 'Nobody asked for this.', 'Room went quiet fast.',
  'The timeline remembers this.', 'Crowd already moved on.', 'Nobody needed to see.',
  'The room voted no.', 'Timeline is taking notes.', 'Shared for wrong reasons.',
  'The room has questions.',
  // status/NPC
  'NPC behavior on display.', 'Side quest at best.', 'Background noise personified.',
  'Side character vibes only.', 'Filler episode material.', 'Walk-on role at best.',
  'Tutorial level confidence.', 'Loading screen personality.', 'Cutscene was skipped.',
  // revoke/bench
  'Bench yourself immediately.', 'Return to drafts immediately.',
  'Camera should be confiscated.', 'Permanently on the bench.',
  'Bench yourself right now.', 'Last chance already passed.', 'Probation starts right now.',
  // short punchy (2-word)
  'Sit down.', 'Log off.', 'Walk away.', 'Hard pass.', 'Game over.', 'Not today.',
  // harsh punchy (nuclear tier)
  'Confidence sold separately.', 'Delete that immediately.', 'This wasn\'t the move.',
  'Not even close here.', 'Gallery should be locked.', 'Warranty voided on sight.',
  'Credibility left the chat.', 'Reputation took a hit.', 'Viral for wrong reasons.',
  'Followers deserve a refund.', 'Feed cleanse recommended.', 'Profile audit needed immediately.',
  'Charisma not found here.', 'Personality patch required.', 'Zero engagement deserved.',
  'Posted without peer review.', 'Damage control activated.', 'Strike three was generous.',
  'Shelf life already expired.', 'Audition tape got shredded.', 'Casting call was cancelled.',
  'Approval rating plummeting.', 'Permanently on thin ice.', 'Resume needs this removed.',
];

// Lane-specific micdrops: keyed by detected context
const NV2_MICDROPS_LANE = {
  camera: [
    'That angle lied for you.', 'Lens can\'t fix this.', 'Camera owes an apology.',
    'Angle did all the work.', 'Framing couldn\'t save you.', 'Not even a good crop.',
    'The camera was too generous.', 'Zoom out was the move.',
  ],
  lighting: [
    'Even good light gave up.', 'Lighting carried the whole thing.', 'Shadows were being kind.',
    'The light tried its best.', 'Brightness couldn\'t save this.', 'Dim was the right call.',
  ],
  garage: [
    'Garage-sale poster child.', 'Oil stain has more charm.', 'The tools outperformed you.',
    'Even the garage judged you.', 'Mechanic cosplay gone wrong.',
  ],
  outdoors: [
    'Nature didn\'t consent to this.', 'Sunlight couldn\'t save this.', 'The scenery carried you.',
    'Even the grass looked away.', 'Vacation wasted on this.',
  ],
  tech: [
    'The setup outperformed you.', 'Your rig deserves better.', 'Even the WiFi judged you.',
    'Screen brightness wasn\'t enough.', 'The keyboard carried harder.', 'Ctrl Z this immediately.',
    'Delete and start over.', 'Hard restart needed badly.',
  ],
  confidence: [
    'Swagger exceeded your clearance.', 'Posture promised too much.', 'That stance lied for you.',
    'Confidence wrote a bad check.', 'The pose oversold everything.',
  ],
};

// Flatten all lane micdrops for fallback
const NV2_MICDROPS_ALL_LANES = Object.values(NV2_MICDROPS_LANE).flat();

// Combined pool: general + all lanes (all guaranteed 3+ words, ban-filtered)
const NV2_MICDROPS = [...NV2_MICDROPS_GENERAL, ...NV2_MICDROPS_ALL_LANES].filter(m => {
  const wc = m.replace(/\.$/, '').split(/\s+/).length;
  if (wc < 2) return false;
  const lower = m.toLowerCase();
  if (NV2_BANNED_PHRASES.some(p => lower.includes(p))) return false;
  return true;
});

// Nuclear-tier meme micdrops: short, captionable, screenshot-worthy
const NV2_MICDROPS_NUCLEAR = [
  // 2-word punches
  'Log off.', 'Screenshotted.', 'Archived.', 'Muted.', 'Reported.',
  'Blocked.', 'Ratio\'d.', 'Benched.', 'Expired.', 'Revoked.',
  // 3-word punches
  'Delete this.', 'Stay offline.', 'Comments disabled.', 'Muted on sight.',
  'Archived immediately.', 'Not the moment.', 'DMs stayed unopened.',
  'Reported for spam.', 'Notifications off permanently.', 'Story skipped.',
  // 4-word punches
  'Unfollowed in real time.', 'Drafted and never posted.', 'Screenshot sent already.',
  'Close Friends removed you.', 'Algorithm buried this.', 'Posted without clearance.',
  'Engagement rate: zero.', 'Forwarded without comment.',
  // 5-6 word punches
  'The replies wrote themselves.', 'Nobody saved this to anything.',
];

// Environment-only nouns that should NOT be a roast target (can still appear as background context)
const NV2_NON_ROASTABLE_TARGETS = new Set([
  'grass', 'bushes', 'bush', 'sky', 'clouds', 'horizon',
  'tree', 'palm tree', 'palm', 'window', 'wall', 'floor',
  'ceiling', 'building', 'sun', 'sunlight',
]);

// Context-only objects: can appear as background detail but should not be the main roast target
const NV2_CONTEXT_ONLY_OBJECTS = new Set([
  'bottles', 'bottle', 'tools', 'tool', 'boxes', 'box',
  'shelf', 'chair', 'mug', 'papers', 'cables',
  'car', 'monitor', 'keyboard', 'window', 'palm tree',
  'grass', 'bushes', 'wall', 'roof', 'desk', 'lamp', 'tire', 'shirt',
]);

// Scene punchlines: short fragments injected into sentence 1 for scene-aware targets
const NV2_SCENE_PUNCHLINES = {
  monitor:   ['your setup is working harder than you', 'gamer rig, NPC energy', 'the tech is carrying this'],
  keyboard:  ['your setup is working harder than you', 'gamer rig, NPC energy', 'the tech is carrying this'],
  desk:      ['your setup is working harder than you', 'gamer rig, NPC energy', 'the tech is carrying this'],
  cables:    ['your setup is working harder than you', 'gamer rig, NPC energy', 'the tech is carrying this'],
  shelf:     ['storage-unit energy', 'clutter as a personality', 'yard-sale aesthetics'],
  boxes:     ['storage-unit energy', 'clutter as a personality', 'yard-sale aesthetics'],
  bottles:   ['storage-unit energy', 'clutter as a personality', 'yard-sale aesthetics'],
  garage:    ['mechanic cosplay', 'garage-sale poster vibes', 'oil-stained confidence'],
  car:       ['mechanic cosplay', 'garage-sale poster vibes', 'oil-stained confidence'],
  tools:     ['mechanic cosplay', 'garage-sale poster vibes', 'oil-stained confidence'],
  tire:      ['mechanic cosplay', 'garage-sale poster vibes', 'oil-stained confidence'],
  'palm tree': ['sad tourist energy', 'vacation wasted', 'sunlight couldn\'t save this'],
  grass:     ['sad tourist energy', 'vacation wasted', 'sunlight couldn\'t save this'],
  outdoors:  ['sad tourist energy', 'vacation wasted', 'sunlight couldn\'t save this'],
};

// Weak sentence 2 detector phrases
const NV2_WEAK_SENTENCE2_WORDS = [
  'thoughts', 'opinions', 'impression', 'noticed', 'cringed',
  'barely', 'kinda', 'sort of',
];

// --- Template 2-sentence classification ---
// Templates containing ". " or "— " produce 2 sentences; mark for bias selection
const NV2_TWO_SENTENCE_IDS = new Set(
  NV2_STRUCTURE_TEMPLATES
    .filter(t => /\.\s|—\s/.test(t.tpl.replace(/\{[A-Z]+\}/g, 'X')))
    .map(t => t.id)
);

// --- Quote sanitizer: strip or convert inner double quotes ---
function nv2SanitizeQuotes(text) {
  // Replace "word" patterns with bare word (remove decorative quotes)
  return text.replace(/(?<!\w)"([^"]{1,30})"(?!\w)/g, '$1');
}

// --- Object-subject detector: sentence 1 should roast the person, not the object ---
function nv2Sentence1ObjectSubject(sentence1, allowedObjects, targetSource) {
  if (!sentence1 || typeof sentence1 !== 'string') return false;
  const s = sentence1.trim();
  // Only check first 8 words to avoid false positives deep in the sentence
  const firstWords = s.split(/\s+/).slice(0, 8).join(' ').toLowerCase();
  const objsLower = (allowedObjects || []).map(o => o.toLowerCase());

  // Helper: does phrase start with a known object?
  function startsWithObj(phrase) {
    for (const obj of objsLower) {
      if (phrase === obj || phrase.startsWith(obj + ' ') || phrase.startsWith(obj + "'")) return true;
    }
    return false;
  }

  // A) "Your <obj>..." where obj is scene/tag-derived
  if (targetSource === 'scene' || targetSource === 'tags') {
    const yourMatch = firstWords.match(/^your\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\b/);
    if (yourMatch && startsWithObj(yourMatch[1])) return true;
  }

  // B) "The <obj>..." or "That <obj>..."
  const theMatch = firstWords.match(/^(?:the|that)\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\b/);
  if (theMatch && startsWithObj(theMatch[1])) return true;

  // C) No "you" or "your" at all in sentence 1
  if (!/\b(you|your)\b/i.test(s)) return true;

  return false;
}

// --- Tag-glued object detector: "Your car's mixed, garage look..." / "Your jeans are so centered..." ---
function nv2HasTagGluedObject(text) {
  if (!text || typeof text !== 'string') return false;
  return /your\s+\w+\s*[''']s\s+(mixed|dim|bright|centered|straight-on|low angle|garage|office|outdoors)\b/i.test(text) ||
    /your\s+\w+\s+(mixed|dim|bright)\s+(garage|office|outdoors)\s+look\b/i.test(text) ||
    /^your\s+(jeans|shirt|hoodie|jacket|flannel|polo|tee|t-shirt|pants)\s+.*\b(centered|straight-on|low angle|close-up|wide shot)\b/i.test(text);
}

// --- Consolidated broken sentence-end detector ---
function nv2HasBrokenSentenceEnd(text) {
  if (!text || typeof text !== 'string') return false;
  const sents = text.match(/[^.!?]*[.!?]+/g);
  if (!sents) return false;
  for (const raw of sents) {
    const s = raw.trim().replace(/["'`]+$/, '').trim();
    // Dangling article: sentence ends with a/an/the before punctuation
    if (/\b(a|an|the)\s*[.!?]$/.test(s)) return true;
    // Dangling preposition: sentence ends with prep before punctuation
    if (/\b(of|to|on|in|at|for|with|from|by|as)\s*[.!?]$/.test(s)) return true;
    // Two-token dangling: prep + the before punctuation
    if (/\b(on|in|at|of|to|for|with)\s+the\s*[.!?]$/.test(s)) return true;
  }
  return false;
}

// Legacy aliases kept for any external callers
function nv2HasDanglingPreposition(text) { return nv2HasBrokenSentenceEnd(text); }
function nv2HasDanglingArticle(text) { return nv2HasBrokenSentenceEnd(text); }

const REFUSAL_PATTERNS = [
  // Anchored starters — require refusal-specific continuation
  { label: 'starts-i-cannot',     re: /^i cannot (assist|help|comply|generate|create|produce|fulfill|provide|do that|do this|write)/i },
  { label: 'starts-i-cant',       re: /^i can[''\u2019]?t (assist|help|comply|generate|create|produce|fulfill|provide|do that|do this|write)/i },
  { label: 'starts-i-am-unable',  re: /^i am unable to\b/i },
  { label: 'starts-as-an-ai',     re: /^as an ai\b/i },
  // Unanchored full refusal phrases
  { label: 'cannot-assist',       re: /i cannot assist/i },
  { label: 'cant-assist',         re: /i can[''\u2019]?t assist/i },
  { label: 'cannot-help-with',    re: /i cannot help with th/i },
  { label: 'cant-help-with',      re: /i can[''\u2019]?t help with th/i },
  { label: 'cannot-comply',       re: /i cannot comply/i },
  { label: 'cant-comply',         re: /i can[''\u2019]?t comply/i },
  { label: 'request-violates',    re: /this request violates/i },
  { label: 'against-policy',      re: /i .{0,20}(policy|guidelines)/i },
  { label: 'not-appropriate',     re: /^(this |that )?(is |isn[''\u2019]?t )?(not |in)?appropriate/i },
];
// "Sorry" / "I'm sorry" only counts as refusal when paired with inability language
const SORRY_RE = /^(i[''\u2019]?m sorry|sorry)\b/i;
const INABILITY_RE = /\b(can[''\u2019]?t|cannot|unable|assist|help with|comply|provide|generate|fulfill)\b/i;
function looksLikeRefusal(text, _debugLabel) {
  if (!text || typeof text !== 'string') return true;
  // Check sorry + inability combo first
  if (SORRY_RE.test(text) && INABILITY_RE.test(text)) {
    if (_debugLabel) _debugLabel.matched = 'sorry+inability';
    return true;
  }
  for (const { label, re } of REFUSAL_PATTERNS) {
    if (re.test(text)) {
      if (_debugLabel) _debugLabel.matched = label;
      return true;
    }
  }
  return false;
}

// --- Local punch-up for polishFailed skeletons ---
function nv2LocalPunchUp(text, ctx) {
  const isDev = process.env.NODE_ENV !== 'production';
  const sents = text.match(/[^.!?]*[.!?]+/g);
  if (!sents || sents.length < 1) return text;
  let s1 = sents[0].trim();
  const s2 = sents.length > 1 ? sents.slice(1).map(s => s.trim()).join(' ') : null;
  let changed = false;
  let targetWas = ctx.target;
  let targetNow = ctx.target;

  // A) "You look like" -> punchier opener
  if (/^You look like\b/i.test(s1)) {
    const socialFeedContexts = /\b(feed|story|stories|replies|comments|timeline|algorithm|posted|upload)\b/i;
    const isFeedContext = ctx.socialContext && socialFeedContexts.test(ctx.socialContext);
    const alts = isFeedContext
      ? ['You posted like', "You're out here", 'You really chose']
      : ["You're out here", 'You really chose', 'You showed up'];
    const pick = alts[Math.floor(Math.random() * alts.length)];
    s1 = s1.replace(/^You look like\b/i, pick);
    changed = true;
  }

  // B) If target is "lighting choice" but primary selfie attrs available -> swap in
  if (ctx.target && ctx.target.toLowerCase() === 'lighting choice' && ctx.primaryAttrs && ctx.primaryAttrs.length > 0) {
    const replacement = ctx.primaryAttrs[Math.floor(Math.random() * ctx.primaryAttrs.length)];
    const lightRe = /\b(your |that |the )?(lighting choice|lighting)\b/gi;
    if (lightRe.test(s1)) {
      s1 = s1.replace(lightRe, (m, prefix) => (prefix || 'that ') + replacement);
      targetNow = replacement;
      changed = true;
    }
  }

  // Ensure punctuation on s1
  if (!/[.!?]$/.test(s1)) s1 += '.';

  const final = s2 ? s1 + ' ' + s2 : s1;

  if (changed && isDev) {
    console.log(`[nuclear-v2] localPunchUpApplied=true reason=polishFailed targetWas=${targetWas} -> targetNow=${targetNow}`);
  }

  return final;
}

// --- Contradiction detector: reject outputs that contradict extracted tags ---
function nv2ContradictsFacts(text, facts) {
  const lower = text.toLowerCase();
  const reasons = [];
  // Modifier consistency: "centered" vs "off-center"
  if (facts.modifier) {
    const modLower = facts.modifier.toLowerCase();
    if (modLower.includes('centered') && (lower.includes('off-center') || lower.includes('off centre'))) {
      reasons.push('modifier:centered->off-center');
    }
    if (modLower.includes('close-up') && lower.includes('wide shot')) {
      reasons.push('modifier:close-up->wide-shot');
    }
    if (modLower.includes('wide') && lower.includes('close-up')) {
      reasons.push('modifier:wide->close-up');
    }
  }
  // Lighting consistency
  if (facts.lighting) {
    const litLower = facts.lighting.toLowerCase();
    if (litLower.includes('bright') && (lower.includes('dark') || lower.includes('shadow'))) {
      reasons.push('lighting:bright->dark');
    }
    if (litLower.includes('dim') && lower.includes('bright')) {
      reasons.push('lighting:dim->bright');
    }
  }
  // Setting consistency
  if (facts.setting) {
    const setLower = facts.setting.toLowerCase();
    if (setLower.includes('office') && lower.includes('garage')) {
      reasons.push('setting:office->garage');
    }
    if (setLower.includes('garage') && lower.includes('office')) {
      reasons.push('setting:garage->office');
    }
    if (setLower.includes('outdoor') && (lower.includes('office') || lower.includes('cubicle'))) {
      reasons.push('setting:outdoor->office');
    }
    if (setLower.includes('indoor') && lower.includes('outdoor')) {
      reasons.push('setting:indoor->outdoor');
    }
    // Setting-coherence: indoor settings vs outdoor-only words
    const allowed = (facts.allowedObjects || []).map(o => o.toLowerCase()).join(' ');
    if (setLower.includes('garage') || setLower.includes('office') || setLower.includes('indoor')) {
      for (const w of ['sky', 'clouds', 'horizon', 'sunset', 'sunrise']) {
        if (lower.includes(w) && !allowed.includes(w)) {
          reasons.push('settingSkyMismatch');
          break;
        }
      }
    }
    // Setting-coherence: outdoors vs indoor-only phrases
    if (setLower.includes('outdoor')) {
      for (const phrase of ['garage wall', 'monitor glare', 'desk setup', 'office chair']) {
        if (lower.includes(phrase) && !allowed.includes(phrase)) {
          reasons.push('settingIndoorMismatch');
          break;
        }
      }
    }
    // Setting-coherence: garage vs beach/ocean
    if (setLower.includes('garage')) {
      for (const w of ['beach', 'ocean', 'sand']) {
        if (lower.includes(w)) {
          reasons.push('settingGarageBeachMismatch');
          break;
        }
      }
    }
  }
  return reasons.length > 0 ? reasons : null;
}

// --- Nuclear V2 system prompt (shared) ---
const NV2_SYSTEM_MSG = `You write brutally funny 2-sentence roast captions for selfie photos. Rules:\n- EXACTLY 2 sentences, 12–26 words total.\n- Sentence 1: reference AT LEAST 2 provided visible details.\n- Sentence 2: 3–7 words preferred (2–12 allowed), cold punchline, NO exclamation marks, NO questions, no emojis/hashtags. Must end with ".".\n- Must NOT start sentence 2 with "Even", "And", "But", or "So".\n- No quotes, no profanity.\n- Avoid: "your expression", "your vibe", "your energy", "your aura", "it's giving".\n- Avoid starting sentence 1 with "Your". Prefer non-"Your" openers ~70% of the time. Good starters: "Somebody lied to you about…", "Nobody warned you that…", "You really posted this like…", "This is the kind of photo that…", "The room clocked…", "Be honest…"\n- Do NOT start sentence 1 with: "When your", "The lighting", "This lighting", "In this lighting".\n- Do NOT use the trope "Even the <object/person> looks embarrassed/judging/disagrees" or endings like "X disagrees", "X deserves better".\n- Mention lighting ONLY if extremely bright or dim, never in the first 6 words, and only once.\n- Roast visible styling, pose, effort, setting — never body, identity, or physical features.\n- Be blunt, specific, original. Google Play safe.\nNUCLEAR TONE:\n- Roast the person's confidence and decision to post this.\n- Imply they believed this looked good.\n- Attack the ego behind the photo, not just the objects in it.\n- Avoid observational-only jokes; make it socially cutting.\n- Cold, controlled, humiliating — not playful.\n- Avoid generic puns, catchphrases, and job-title taglines.\n- Avoid abstract roast crutches like confidence/charisma/vibes/energy/aura; use concrete, photo-specific insults.\n- Avoid using "You really posted this..." more than ~20% of the time. Vary your openers.\n- Avoid using "Delete this" as the sentence 2 closer too often; prefer varied finality (pick one, 3–7 words): "Receipts already exist.", "Permanently on record.", "The room clocked it.", "No recovery from this.", "Close Friends removed you.", "Comments would be brutal.", "Muted in real time.", "Archived for a reason.", "Filed under cringe.", "Group chat saw it."\n- Avoid repeating the same micdrop wording across roasts.`;

// --- Nuclear V2 freeform candidate generation (multi-call parallel) ---
function nv2BuildCandidateUserMsg(detailsBlock) {
  return `${detailsBlock}\n\nWrite one 2-sentence roast caption. Sentence 1: reference ≥2 visible details. Sentence 2: 3–7 word cold punchline ending in "." only (no "!"). Be specific, original, punchy.`;
}

async function nv2GenerateCandidates({ imageBase64, detailsBlock, n = 8 }) {
  const userMsg = nv2BuildCandidateUserMsg(detailsBlock);

  const calls = Array.from({ length: n }, () =>
    openai.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'system', content: NV2_SYSTEM_MSG },
        { role: 'user', content: [
          { type: 'input_text', text: userMsg },
          { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
        ]},
      ],
      max_output_tokens: 65,
      temperature: 0.78,
    }).then(r => r.output_text || null).catch(() => null)
  );
  return (await Promise.all(calls)).filter(Boolean);
}

// --- Nuclear V2 early-accept candidate generation ---
const NV2_EARLY_ACCEPT_TIMECAP_MS = 5500;
const NV2_TOPUP_COUNT = 2;
const NV2_TOPUP_TIMEOUT_MS = 1500;
const NV2_TOPUP_TEMPERATURE = 0.72;
const NV2_GRACE_WAIT_MS = 800;
async function nv2GenerateCandidatesEarlyAccept({ imageBase64, detailsBlock, n, validateFn, isUsableFace = false }) {
  const userMsg = nv2BuildCandidateUserMsg(detailsBlock);
  const genStart = Date.now();
  const results = [];
  let resolved = false;
  let settledCount = 0;
  let timeToFirstValid = null;
  let timeToThirdValid = null;

  // Phase 1: launch N calls, accept early when conditions met
  // Results are accumulated incrementally even after resolve (timecap/validCount)
  const calls = Array.from({ length: n }, () =>
    openai.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'system', content: NV2_SYSTEM_MSG },
        { role: 'user', content: [
          { type: 'input_text', text: userMsg },
          { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
        ]},
      ],
      max_output_tokens: 65,
      temperature: 0.78,
    }).then(r => r.output_text || null).catch(() => null)
  );

  const phase1Reason = await new Promise((resolve) => {
    const tryAccept = () => {
      const valid = results.filter(r => r.valid);
      if (valid.length >= 3) { finish('validCount'); return; }
    };

    const finish = (reason) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timecapTimer);
      resolve(reason);
    };

    const timecapTimer = setTimeout(() => finish('timecap'), NV2_EARLY_ACCEPT_TIMECAP_MS);

    calls.forEach(p => p.then(raw => {
      settledCount++;
      // Always accumulate results, even after timecap/early-accept resolved
      if (raw) {
        const validated = validateFn(raw);
        results.push(validated);
        if (validated.valid) {
          const elapsed = Date.now() - genStart;
          const validCount = results.filter(r => r.valid).length;
          if (validCount === 1 && timeToFirstValid === null) timeToFirstValid = elapsed;
          if (validCount === 3 && timeToThirdValid === null) timeToThirdValid = elapsed;
        }
      }
      // Only drive finish/accept logic before resolved
      if (!resolved) {
        if (results.some(r => r.valid)) tryAccept();
        if (settledCount >= n) {
          clearTimeout(timecapTimer);
          finish('allSettled');
        }
      }
    }));
  });

  // Grace wait: if timecap fired with 0 results, wait briefly for first completion
  const phase1SettledAtResolve = settledCount;
  let graceWaitUsed = false;
  if (phase1Reason === 'timecap' && results.length === 0 && settledCount < n) {
    graceWaitUsed = true;
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) console.log(`[nuclear-v2] grace wait: 0 results at timecap, settled=${settledCount}/${n}, waiting up to ${NV2_GRACE_WAIT_MS}ms`);
    await Promise.race([
      Promise.any(calls),
      new Promise(r => setTimeout(r, NV2_GRACE_WAIT_MS)),
    ]);
    // calls continue to push into results via the .then above; give microtask queue a tick
    await new Promise(r => setTimeout(r, 0));
    if (isDev) console.log(`[nuclear-v2] grace wait done: results=${results.length} settled=${settledCount}/${n}`);
  }

  const preTopUpValidCount = results.filter(r => r.valid).length;
  const isDev = process.env.NODE_ENV !== 'production';

  // Phase 2: repair top-up — rewrite best failed candidates via gpt-4o-mini
  let boosterFired = false;
  let boosterValidAdded = 0;
  let topUpAttempted = false;
  let topUpValidCount = 0;
  let topUpMode = null;
  let repairedCount = 0;
  let repairedValidCount = 0;
  if ((phase1Reason === 'timecap' || phase1Reason === 'allSettled') && preTopUpValidCount < 3) {
    const failedCandidates = results
      .filter(r => !r.valid && r.text)
      .sort((a, b) => b.score - a.score)
      .slice(0, NV2_TOPUP_COUNT);

    if (failedCandidates.length > 0) {
      topUpAttempted = true;
      topUpMode = 'repair';
      repairedCount = failedCandidates.length;
      if (isDev) console.log(`[nuclear-v2] topUp triggered mode=repair preTopUpValid=${preTopUpValidCount} reason=${phase1Reason} repairing=${repairedCount}`);

      const repairCalls = failedCandidates.map(candidate => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), NV2_TOPUP_TIMEOUT_MS);
        const repairPrompt = `Rewrite this roast caption: "${candidate.text}"
Problem: ${candidate.reason}.
${detailsBlock}
Rules:
- EXACTLY 2 sentences, 12-26 words total.
- Sentence 1: must reference at least ONE exact visible noun from the detail list above. Start with you/your/nobody/somebody or similar direct framing.
- Sentence 2: 3-7 word cold punchline ending in "." only (no "!"). Must NOT start with "Even", "And", "But", "So".
- No quotes, no emojis, no hashtags, no questions.
- Google Play safe. No slurs, no profanity.
- Keep the comedic voice. Output ONLY the fixed caption.`;
        return openai.responses.create({
          model: 'gpt-4o-mini',
          input: [
            { role: 'system', content: 'Rewrite the caption per the rules. Output only the result, no explanation.' },
            { role: 'user', content: repairPrompt },
          ],
          max_output_tokens: 65,
          temperature: NV2_TOPUP_TEMPERATURE,
        }, { signal: ac.signal })
          .then(r => { clearTimeout(timer); return r.output_text || null; })
          .catch(() => { clearTimeout(timer); return null; });
      });

      const repairResults = await Promise.all(repairCalls);
      for (let i = 0; i < repairResults.length; i++) {
        const raw = repairResults[i];
        if (raw) {
          const validated = validateFn(raw);
          results.push(validated);
          if (validated.valid) {
            topUpValidCount++;
            repairedValidCount++;
            const elapsed = Date.now() - genStart;
            const validCount = results.filter(r => r.valid).length;
            if (validCount === 1 && timeToFirstValid === null) timeToFirstValid = elapsed;
            if (validCount === 3 && timeToThirdValid === null) timeToThirdValid = elapsed;
          }
          if (isDev) console.log(`[nuclear-v2] repair[${i}] source="${failedCandidates[i].text}" reason=${failedCandidates[i].reason} -> valid=${validated.valid} ${validated.valid ? `score=${validated.score}` : `rejectReason=${validated.reason}`} text="${validated.text}"`);
        }
      }
    }
  }

  return {
    results,
    earlyAccepted: phase1Reason !== 'allSettled',
    earlyReason: phase1Reason,
    timeToFirstValid,
    timeToThirdValid,
    phase1InitialCalls: n,
    phase1SettledCount: settledCount,
    graceWaitUsed,
    preTopUpValidCount,
    boosterFired,
    boosterValidAdded,
    topUpAttempted,
    topUpValidCount,
    topUpMode,
    repairedCount,
    repairedValidCount,
    finalValidCount: results.filter(r => r.valid).length,
  };
}

// --- Nuclear V2 batch candidate generation (single call, default) ---
async function nv2GenerateCandidatesBatch({ imageBase64, detailsBlock, n = 5 }) {
  const labels = Array.from({ length: n }, (_, i) => `C${i + 1}`);
  const format = labels.map(l => `${l}: <two sentences>`).join('\n---\n');
  const userMsg = `${detailsBlock}\n\nWrite exactly ${n} DIFFERENT 2-sentence roast captions. Each must independently follow all rules. Vary openers and punchlines across candidates — no two should start the same way or end with the same micdrop.\n\nOutput format (strictly follow, no extra text):\n${format}`;

  try {
    const resp = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'system', content: NV2_SYSTEM_MSG },
        { role: 'user', content: [
          { type: 'input_text', text: userMsg },
          { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
        ]},
      ],
      max_output_tokens: 400,
      temperature: 0.85,
    });
    const raw = (resp.output_text || '').trim();
    // Parse candidates by splitting on --- or C\d+: markers
    const candidates = [];
    const blocks = raw.split(/\n---\n/);
    for (const block of blocks) {
      const cleaned = block.replace(/^C\d+:\s*/i, '').trim();
      if (cleaned.length > 10) candidates.push(cleaned);
    }
    return candidates;
  } catch (e) {
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) console.log(`[nuclear-v2] batchCall error: ${e.message}`);
    return [];
  }
}

// --- Nuclear V2 freeform candidate validation ---
function nv2ValidateCandidate(text, { detailAnchors, sceneAnchors, clientState, isDev, sceneFiltered = [], selfieAttrs = [], tagObjects = [], lightingTag = '' }) {
  let score = 100;
  // A. Exactly 2 sentences
  const sents = text.match(/[^.!?]*[.!?]+/g);
  if (!sents || sents.length !== 2) return { valid: false, score: 0, reason: 'sentenceCount' };
  // A2. Sentence 1 must use direct/accusational framing
  const s1Trimmed = sents[0].trim();
  const s1DirectOpener = /^\s*(you|your|this|nobody|somebody|be honest|that|the)\b/i.test(s1Trimmed);
  const s1First10 = s1Trimmed.split(/\s+/).slice(0, 10).join(' ').toLowerCase();
  const s1HasYou = /\b(you|your)\b/i.test(s1First10);
  const s1HasIdentity = /\b(smile|grin|stare|face|expression|eyes|hair|shirt|outfit|hoodie|jacket|glasses|beard|eyebrows|posture|stance|hat|collar|watch|pose)\b/i.test(s1First10);
  if (!s1DirectOpener || (!s1HasYou && !s1HasIdentity)) return { valid: false, score: 0, reason: 'noDirectS1' };
  // B. 12-26 words
  const wc = text.split(/\s+/).length;
  if (wc < 12 || wc > 26) return { valid: false, score: 0, reason: 'wordCount' };
  // B2. No questions, emojis, or hashtags
  if (/\?/.test(text)) return { valid: false, score: 0, reason: 'question' };
  if (/#\w/.test(text)) return { valid: false, score: 0, reason: 'hashtag' };
  if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}]/u.test(text)) return { valid: false, score: 0, reason: 'emoji' };
  // B3. No quotes (double, curly single, curly double — causes broken formatting)
  if (/["\u201C\u201D\u2018\u2019]/.test(text)) return { valid: false, score: 0, reason: 'quotes' };
  // C. Safety
  if (!isPlaySafe(text)) return { valid: false, score: 0, reason: 'safety' };
  // D. Refusal
  if (looksLikeRefusal(text)) return { valid: false, score: 0, reason: 'refusal' };
  // E. Banned patterns
  if (nv2HasBannedPatterns(text)) return { valid: false, score: 0, reason: 'bannedPattern' };
  // F. Detail anchors: ≥2 from detailAnchors
  const lower = text.toLowerCase();
  const matchedDetails = detailAnchors.filter(d => lower.includes(d.toLowerCase()));
  if (matchedDetails.length < 2) return { valid: false, score: 0, reason: 'missingDetails' };
  // F2. Modifier-only penalty: discourage roasts that anchor only on lighting/angle/framing
  const MODIFIER_ANCHOR_REGEX = /\b(angle|lighting|framing|setting|pose|bg_vibe|centered|straight-on|low angle|high angle|mixed)\b/i;
  const matchedNonModifier = matchedDetails.filter(d => !MODIFIER_ANCHOR_REGEX.test(d));
  if (matchedDetails.length >= 2 && matchedNonModifier.length === 0) {
    score -= 22;
    if (isDev) console.log(`[nuclear-v2] modifierOnly penalty matched=${matchedDetails.join(',')}`);
  }
  // F3. Scene dominance penalty: discourage over-reliance on scene objects when identity anchors exist
  const _scenePool = new Set([...sceneFiltered, ...tagObjects].map(s => s.toLowerCase().trim()).filter(Boolean));
  const _identityExclude = /\b(angle|tilted|off-center|framing|crop|cropped|lighting|dim|dark|glare|backlit|shadow|centered|straight-on|setting|garage|outdoors)\b/i;
  const _identityPool = new Set([...selfieAttrs].map(s => s.toLowerCase().trim()).filter(a => a && a.length >= 3 && !_identityExclude.test(a)));
  const sceneMatches = matchedDetails.filter(d => _scenePool.has(d.toLowerCase()));
  const identityMatches = matchedDetails.filter(d => _identityPool.has(d.toLowerCase()));
  if (sceneMatches.length >= 2 && identityMatches.length <= 1) {
    score -= 20;
    if (isDev) console.log('[nuclear-v2] sceneDominance penalty', { sceneMatches, identityMatches });
  }
  // G. Scene anchor: ≥1 if sceneAnchors is non-empty
  if (sceneAnchors.length > 0) {
    const hasScene = sceneAnchors.some(s => lower.includes(s.toLowerCase()));
    if (!hasScene) { score -= 18; if (isDev) console.log(`[nuclear-v2] missingScene penalty applied`); }
  }
  // H. Template stems
  if (NV2_FREEFORM_STEM_BANS.some(s => lower.includes(s))) return { valid: false, score: 0, reason: 'templateStem' };
  // I. Global repeat
  if (isRecentNuclearRepeat(text)) return { valid: false, score: 0, reason: 'globalRepeat' };
  // J. Phrase fatigue (per-client) — soft penalty, not a hard reject
  let phraseFatigueHits = 0;
  if (clientState.recentNuclearTexts) {
    const nv2FatigueStart = (t) => { const w = t.toLowerCase().split(/\s+/); if (w[0] === 'you' || w[0] === 'your') w.shift(); return w.slice(0, 4).join(' '); };
    const candStart = nv2FatigueStart(text);
    for (const prev of clientState.recentNuclearTexts.slice(-10)) {
      const prevStart = nv2FatigueStart(prev);
      if (candStart === prevStart || tokenOverlap(text, prev) >= 0.55) { phraseFatigueHits++; break; }
    }
  }
  if (phraseFatigueHits > 0) {
    const penalty = Math.min(phraseFatigueHits * 14, 28);
    score -= penalty;
    if (isDev) console.log(`[nuclear-v2] phraseFatigue penalty -${penalty} hits=${phraseFatigueHits} text="${text.slice(0, 60)}"`);
  }
  // J2. "You really posted this" opener fatigue: penalize if any of last 3 winners also used it
  {
    const YRPT_RE = /\byou really posted this\b/i;
    if (YRPT_RE.test(text)) {
      const recentWinners = clientState.nv2RecentWinners || [];
      if (recentWinners.some(t => YRPT_RE.test(t))) {
        score -= 8;
        if (isDev) console.log(`[nuclear-v2] youReallyPostedThis fatigue penalty -8`);
      }
    }
  }
  // J3. "Screenshots already exist" S2 fatigue: penalize if last 3 winners ended the same way
  {
    const SAE_RE = /screenshots already exist\.?$/i;
    if (SAE_RE.test(text.trim())) {
      const recentWinners = clientState.nv2RecentWinners || [];
      if (recentWinners.some(t => SAE_RE.test(t.trim()))) {
        score -= 10;
        if (isDev) console.log(`[nuclear-v2] screenshotsAlreadyExist fatigue penalty -10`);
      }
    }
  }
  // K. Soft opener
  if (s1IsSoft(text)) return { valid: false, score: 0, reason: 'softOpener' };
  // L. Identity disclaimer
  if (/i(?:'m| am) not sure who|can'?t (?:tell|identify)/i.test(text)) return { valid: false, score: 0, reason: 'identityDisclaimer' };
  // M. Sentence-1 anchor gate: s1 must reference at least one photo-specific detail (or scene anchor)
  const s1AnchorPool = [...detailAnchors, ...(sceneAnchors || [])];
  if (!nv2HasAnyAnchorToken(sents[0], s1AnchorPool)) return { valid: false, score: 0, reason: 'noS1Anchor' };
  // M2. Camera-only S1 penalty: if sentence 1 only references camera/lighting anchors, penalize
  const CAMERA_ANCHOR_REGEX = /\b(angle|tilted|off-center|framing|frame|crop|cropped|lighting|dim|dark|glare|backlit|shadow|shadows|screen|centered|straight-on|selfie|camera|lens)\b/i;
  const nonCameraAnchors = [...new Set([
    ...sceneFiltered.map(s => s.toLowerCase().trim()),
    ...selfieAttrs.map(s => s.toLowerCase().trim()),
    ...tagObjects.map(s => s.toLowerCase().trim()),
  ])].filter(a => a && a.length >= 3 && !CAMERA_ANCHOR_REGEX.test(a));
  const s1HasNonCamera = nv2HasAnyAnchorToken(sents[0], nonCameraAnchors);
  if (nonCameraAnchors.length >= 3 && !s1HasNonCamera) {
    score -= 25;
    if (isDev) console.log(`[nuclear-v2] cameraOnlyS1 penalty nonCamera=${nonCameraAnchors.length} s1="${sents[0].trim()}" text="${text}"`);
  }
  // N. Micdrop validator: sentence 2 must be a cold, declarative punchline
  const s2Raw = sents[1].trim();
  const s2WordCount = s2Raw.split(/\s+/).length;
  if (s2WordCount < 2 || s2WordCount > 11) { if (isDev) console.log(`[nuclear-v2] weakMicdrop wc=${s2WordCount} s2="${s2Raw}"`); return { valid: false, score: 0, reason: 'weakMicdrop' }; }
  const s2HasAnchor = nv2HasAnyAnchorToken(s2Raw, [...detailAnchors, ...(sceneAnchors || [])]);
  if (/^even\s/i.test(s2Raw)) { if (!s2HasAnchor) { if (isDev) console.log(`[nuclear-v2] weakMicdrop even-start unanchored s2="${s2Raw}"`); return { valid: false, score: 0, reason: 'weakMicdrop' }; } score -= 14; if (isDev) console.log(`[nuclear-v2] even-start penalty (anchored) s2="${s2Raw}"`); }
  if (/looks disappointed/i.test(s2Raw)) { score -= 6; if (isDev) console.log(`[nuclear-v2] micdrop phrase penalty: looks disappointed`); }
  if (/(?:is|are) judging/i.test(s2Raw)) { score -= 4; if (isDev) console.log(`[nuclear-v2] micdrop phrase penalty: judging`); }
  if (/^(and|but|so)\s/i.test(s2Raw)) { if (isDev) console.log(`[nuclear-v2] weakMicdrop leading-conj wc=${s2WordCount} s2="${s2Raw}"`); return { valid: false, score: 0, reason: 'weakMicdrop' }; }
  if (/\?/.test(s2Raw)) { if (isDev) console.log(`[nuclear-v2] weakMicdrop question wc=${s2WordCount} s2="${s2Raw}"`); return { valid: false, score: 0, reason: 'weakMicdrop' }; }
  if (/!/.test(s2Raw) && s2WordCount > 4) { score -= 4; if (isDev) console.log(`[nuclear-v2] exclamation penalty s2="${s2Raw}"`); }
  if (!/[.!]$/.test(s2Raw)) { if (isDev) console.log(`[nuclear-v2] weakMicdrop no-terminal wc=${s2WordCount} s2="${s2Raw}"`); return { valid: false, score: 0, reason: 'weakMicdrop' }; }
  // N2. Object-as-judge S2 penalty: discourage "The X...", "Even the X...", "Not even the X..." openers
  if (/^(even\s+the|not\s+even\s+the|the\s+)/i.test(s2Raw)) {
    score -= 8;
    if (isDev) console.log('[nuclear-v2] s2ObjectStart penalty', s2Raw);
  }
  // N3. Identity anchor bonus: prefer roasts that target the person (expression/outfit/hair) over environment
  const IDENTITY_ANCHOR_REGEX = /\b(angle|tilted|off-center|framing|crop|cropped|lighting|dim|dark|glare|backlit|shadow|centered|straight-on|setting|garage|outdoors)\b/i;
  const identityAnchors = [...new Set(
    selfieAttrs.map(s => s.toLowerCase().trim()),
  )].filter(a => a && a.length >= 3 && !IDENTITY_ANCHOR_REGEX.test(a));
  if (identityAnchors.length > 0) {
    const s1HasIdentity = identityAnchors.some(a => sents[0].toLowerCase().includes(a.toLowerCase()));
    if (s1HasIdentity) {
      score += 18;
      if (isDev) console.log('[nuclear-v2] identityAnchor bonus', identityAnchors);
    } else {
      score -= 15;
      if (isDev) console.log('[nuclear-v2] s1 missing identity penalty', identityAnchors);
    }
  }
  // N4. Identity-lead bonus: reward candidates that open with identity anchors in first 6 words (skip if env-led)
  const ENV_LEAD_REGEX = /^\s*(you|your)\s+(dim|dark|bright|harsh|backlit|garage|lighting|angle|tilted|selfie|outdoors|window|shadow|screen|framing|cropped)\b/i;
  if (identityAnchors.length > 0 && !ENV_LEAD_REGEX.test(sents[0])) {
    const firstWordsStr = sents[0].toLowerCase().split(/\s+/).slice(0, 6).join(' ');
    if (identityAnchors.some(a => firstWordsStr.includes(a.toLowerCase()))) {
      score += 12;
      if (isDev) console.log('[nuclear-v2] identityLead bonus', { firstWords: firstWordsStr });
    }
  }
  // N5. Env-led S1 penalty: discourage opening with environment/camera when identity anchors exist
  if (identityAnchors.length > 0) {
    const ENV_S1_REGEX = /^(your\s+)?(dim|dimly\s+lit|mixed\s+lighting|lighting|garage|office|outdoors|window|angle|framing|selfie)\b/i;
    if (ENV_S1_REGEX.test(sents[0].trim())) {
      score -= 10;
      if (isDev) console.log('[nuclear-v2] envLeadS1 penalty', sents[0].trim());
    }
  }
  // N6. Lighting mention fatigue: penalize lighting repetition across recent winners (unless extreme)
  {
    const LIGHTING_MENTION_RE = /\b(lighting|dim|bright|overexposed|glaring|backlit|shadows?)\b/i;
    const recentWinners = clientState.nv2RecentWinners || [];
    const recentMentionsLighting = recentWinners.some(t => LIGHTING_MENTION_RE.test(t));
    const mentionsLightingNow = LIGHTING_MENTION_RE.test(text);
    const lightingVal = String(lightingTag).toLowerCase();
    const isExtremeLighting = ['very dim', 'dark', 'shadowy', 'glaring', 'harsh', 'overexposed', 'blown out', 'backlit'].includes(lightingVal);
    const fatigueActive = recentMentionsLighting && !isExtremeLighting;
    if (fatigueActive && mentionsLightingNow) {
      score -= 35;
      if (isDev) console.log('[nuclear-v2] lightingFatigue penalty', { lightingVal, text });
    }
    // Anti-lighting bonus: reward candidates that avoid lighting when fatigue is active
    if (fatigueActive && !mentionsLightingNow) {
      score += 20;
      if (isDev) console.log('[nuclear-v2] antiLighting bonus', { text });
    }
  }
  // N6b. Lighting clamp: penalize casual lighting mentions that lack extreme markers
  {
    const CASUAL_LIGHTING_RE = /\b(lighting|dim|bright)\b/i;
    const EXTREME_LIGHTING_RE = /\b(pitch[- ]black|barely visible|blinding|washed out|spotlight|harsh flash|neon glare)\b/i;
    if (CASUAL_LIGHTING_RE.test(text) && !EXTREME_LIGHTING_RE.test(text)) {
      score -= 12;
      if (isDev) console.log('[nuclear-v2] lightingClamp penalty -12', { text: text.slice(0, 60) });
    }
  }
  // N6c. Lighting-over-scene penalty: if scene is rich (2+ non-lighting anchors), penalize lighting mentions
  {
    const CASUAL_LIGHTING_RE2 = /\b(lighting|dim|bright)\b/i;
    if (CASUAL_LIGHTING_RE2.test(text)) {
      const LIGHTING_ANCHOR_RE = /^(lighting|dim|bright|harsh|backlit|mixed|screen glow|dark|shadow|shadows)$/i;
      const nonLightingSceneAnchors = (sceneAnchors || []).filter(a => !LIGHTING_ANCHOR_RE.test(a));
      if (nonLightingSceneAnchors.length >= 2) {
        score -= 10;
        if (isDev) console.log('[nuclear-v2] lightingOverScene penalty -10', { nonLightingSceneAnchors: nonLightingSceneAnchors.slice(0, 4), text: text.slice(0, 60) });
      }
    }
  }
  // N7. "Your dim garage selfie" lead penalty
  const NUCLEAR_SELFIE_ENV_LEAD_RE = /^your\s+(?:\w+\s+){0,2}(dim|dimly lit|dark|low[- ]light)\s+(?:\w+\s+){0,2}(garage|room|setup|space)\s+selfie\b/i;
  if (NUCLEAR_SELFIE_ENV_LEAD_RE.test(text)) {
    score -= 18;
    if (isDev) console.log('[nuclear-v2] selfieEnvLead penalty', { text });
  }
  // N8. "screams" crutch penalty in S1
  if (/\bscreams\b/i.test(sents[0])) {
    score -= 10;
    if (isDev) console.log('[nuclear-v2] screamsCrutch penalty', { s1: sents[0].trim(), text });
  }
  // N9. Identity-start bonus: reward S1 that opens directly with an identity anchor
  if (identityAnchors.length > 0) {
    const s1First3 = sents[0].trim().toLowerCase().replace(/^(your|that|this)\s+/i, '').split(/\s+/).slice(0, 2).join(' ');
    if (identityAnchors.some(a => s1First3.includes(a.toLowerCase()))) {
      score += 10;
      if (isDev) console.log('[nuclear-v2] identityStart bonus', { firstWords: s1First3, text });
    }
  }

  // Scoring
  score += Math.min(30, (matchedDetails.length - 2) * 10); // bonus for extra detail anchors
  if (/^you\b/i.test(text)) score += 5; // accusatory opener
  // Cold micdrop bonus: reward short, clean sentence 2
  const s2 = sents[1].trim();
  const s2Lower = s2.toLowerCase();
  const s2Wc = s2.split(/\s+/).length;
  if (s2Wc >= 2 && s2Wc <= 5
    && !/\b(even|and|because|while|looks?)\b/.test(s2Lower)) {
    score += 10;
  }
  // Comparative/explanatory connectives in sentence 2: soft penalty (moved from hard reject)
  if (/ than | as | more | because | while /i.test(s2)) score -= 8;
  // Corny micdrop penalty (soft — not a hard reject)
  const NV2_CORNY_MICDROP_TOKENS = ['tool time', 'era', 'arc', 'main character', 'of despair', 'energy', 'vibes', 'rizz', 'sigma', 'npc', 'final boss'];
  const cornyMatch = NV2_CORNY_MICDROP_TOKENS.find(t => s2Lower.includes(t));
  if (cornyMatch) { score -= 12; if (isDev) console.log(`[nuclear-v2] cornyMicdrop: "${cornyMatch}" in s2="${s2}"`); }
  // "more alive than you" repetition penalty
  if (/more\s+alive\s+than\s+you/i.test(text)) { score -= 18; if (isDev) console.log('[nuclear-v2] phrase penalty: more alive than you'); }
  if (/more\s+lively\s+than\s+you/i.test(text)) { score -= 18; if (isDev) console.log('[nuclear-v2] phrase penalty: more lively than you'); }
  if (/look\s+like\s+it\s+has\s+more\s+personality/i.test(text)) { score -= 18; if (isDev) console.log('[nuclear-v2] phrase penalty: look like it has more personality'); }
  if (/has\s+more\s+drive/i.test(text)) { score -= 10; if (isDev) console.log('[nuclear-v2] phrase penalty: has more drive'); }
  // Comparison trope penalty: "more X than you/your selfie" structures
  const NUCLEAR_COMPARISON_TROPE_RE = /\b(more|less)\b[^.]{0,50}\b(than)\b[^.]{0,40}\b(you|your selfie|your face|your look|your expression)\b/i;
  if (NUCLEAR_COMPARISON_TROPE_RE.test(text)) { score -= 16; if (isDev) console.log('[nuclear-v2] comparisonTrope penalty', { text }); }
  // Glowing/only-thing-alive cliché penalty
  const NUCLEAR_GLOWING_ONLY_RE = /\b(only|just)\b[^.]{0,25}\b(one|thing)\b[^.]{0,25}\b(glowing|alive|lively|awake|working)\b/i;
  if (NUCLEAR_GLOWING_ONLY_RE.test(text)) { score -= 14; if (isDev) console.log('[nuclear-v2] glowingOnly penalty', { text }); }
  // "makes X look more alive/lively" cliché penalty
  const NUCLEAR_MORE_ALIVE_RE = /\b(makes|making)\b[^.]{0,40}\b(look|seem)\b[^.]{0,20}\b(more)\b[^.]{0,20}\b(alive|lively|awake)\b/i;
  if (NUCLEAR_MORE_ALIVE_RE.test(text)) { score -= 12; if (isDev) console.log('[nuclear-v2] moreAlive penalty', { text }); }
  // Generic micdrop penalty: penalize abstract filler punchlines
  const NV2_GENERIC_MICDROP_TOKENS = ['confidence', 'charisma', 'motivation', 'vibes', 'energy', 'aura', 'personality', 'presence', 'effort', 'try-hard', 'desperation', 'midlife crisis', 'hopes dashed', 'cringe'];
  const s2GenericMatch = NV2_GENERIC_MICDROP_TOKENS.find(t => s2Lower.includes(t));
  if (s2GenericMatch) {
    if (s2HasAnchor) { score -= 6; if (isDev) console.log(`[nuclear-v2] genericMicdrop anchored: "${s2GenericMatch}" in s2="${s2}"`); }
    else { if (isDev) console.log(`[nuclear-v2] genericMicdrop unanchored: "${s2GenericMatch}" in s2="${s2}"`); return { valid: false, score: 0, reason: 'genericMicdropUnanchored' }; }
  }
  // Specificity bonus: reward micdrop that references image details
  if (s2HasAnchor) score += 12;
  if (s2Wc >= 3 && s2Wc <= 7 && s2HasAnchor && !s2GenericMatch) score += 10;
  score += nv2SoftPenalty(text, false); // existing soft penalty (returns negative)
  // Word-count scoring bands (soft — hard reject already handled above)
  if (wc >= 14 && wc <= 20) score += 20;
  else if (wc >= 21 && wc <= 22) score += 10;
  else if (wc >= 23 && wc <= 24) score -= 5;
  else if (wc > 24) score -= 20;
  else if (wc < 14) score -= 15;
  // Soft opener penalty: variety pressure for common openers
  const nv2S1 = sents[0].trim().toLowerCase();
  const nv2MatchedOpener = NUCLEAR_COMMON_OPENERS.find(o => nv2S1.startsWith(o));
  if (nv2MatchedOpener) {
    score -= 14;
    // Extra penalty if same opener stem used in last 3 nuclear outputs for this client
    if (clientState.recentNuclearTexts) {
      const recent3 = clientState.recentNuclearTexts.slice(-3);
      const openerUsedRecently = recent3.some(prev => {
        const prevS1 = (prev.match(/[^.!?]*[.!?]+/) || [prev])[0].trim().toLowerCase();
        return prevS1.startsWith(nv2MatchedOpener);
      });
      if (openerUsedRecently) score -= 20;
    }
  }
  // Lighting-first penalty: discourage leading with lighting unless detail pack is thin
  if (NUCLEAR_LIGHTING_OPENERS.some(lo => nv2S1.startsWith(lo))) {
    const nonLightingAnchors = detailAnchors.filter(a => !/\b(dim|bright|harsh|mixed|lighting|backlit|screen glow)\b/i.test(a));
    if (nonLightingAnchors.length >= 3) score -= 8;
  }
  // Opening cadence penalty (exact 4-word match with recent outputs, skip leading you/your)
  if (clientState.recentNuclearTexts && clientState.recentNuclearTexts.length > 0) {
    const nv2CadenceStart = (t) => { const w = t.toLowerCase().split(/\s+/); if (w[0] === 'you' || w[0] === 'your') w.shift(); return w.slice(0, 4).join(' '); };
    const candStart = nv2CadenceStart(text);
    for (const prev of clientState.recentNuclearTexts.slice(-3)) {
      if (nv2CadenceStart(prev) === candStart) { score -= 15; break; }
    }
  }
  // Social exposure bonus: reward ego-hit / socially fatal phrasing
  const NUCLEAR_SOCIAL_EXPOSURE_RE = /\b(hit post|pressed post|posted this|uploaded this|really posted|thought this was|this was the one|nobody asked|confidence like this|should've stayed|should have stayed|should've stayed in drafts|should've stayed private|try again|delete this|this isn't it|wasn't it|no recovery|in public|in private|group chat|story|feed|timeline|drafts|start over|bold of you)\b/i;
  if (NUCLEAR_SOCIAL_EXPOSURE_RE.test(text)) {
    score += 26;
    if (isDev) console.log('[nuclear-v2] socialExposure bonus', { text });
  }
  // N-esc. Escalation bonus: reward social-consequence phrasing in identity-led roasts
  {
    const s1LightingLed = NUCLEAR_LIGHTING_OPENERS.some(lo => sents[0].trim().toLowerCase().startsWith(lo));
    const sceneDominant = sceneMatches.length >= 2 && identityMatches.length <= 1;
    const recentWinners = clientState.nv2RecentWinners || [];
    const lightingFatigueActive = recentWinners.some(t => /\b(lighting|dim|bright|overexposed|glaring|backlit|shadows?)\b/i.test(t))
      && !['very dim', 'dark', 'shadowy', 'glaring', 'harsh', 'overexposed', 'blown out', 'backlit'].includes(String(lightingTag).toLowerCase());
    if (identityMatches.length >= 1 && !s1LightingLed && !sceneDominant && !lightingFatigueActive) {
      const escalationMatches = NUCLEAR_ESCALATION_PATTERNS.filter(re => re.test(text)).length;
      if (escalationMatches >= 2) {
        score += 15;
        if (isDev) console.log('[nuclear-v2] escalation bonus +15', { escalationMatches, text });
      } else if (escalationMatches >= 1) {
        score += 10;
        if (isDev) console.log('[nuclear-v2] escalation bonus +10', { escalationMatches, text });
      }
    }
  }
  // Trope penalty: reduce generic internet roast clichés
  const NUCLEAR_TROPE_RE = /\b(basement|future hacker|tech support|hacker at best|keyboard warrior|discord mod|neckbeard)\b/i;
  if (NUCLEAR_TROPE_RE.test(text)) {
    score -= 18;
    if (isDev) console.log('[nuclear-v2] trope penalty', { text });
  }
  // Cute object commentary penalty: reduce "object judging you" humor
  const NUCLEAR_CUTE_OBJECT_RE = /\b(car|monitor|shelves|garage|chair|wall|door)\b.*\b(judging|disapproves|embarrassed|ashamed|plotting|begging)\b/i;
  if (NUCLEAR_CUTE_OBJECT_RE.test(text)) {
    score -= 12;
    if (isDev) console.log('[nuclear-v2] cuteObject penalty', { text });
  }
  // Object-led penalty: reduce "object screams/tells/says" patterns
  const NUCLEAR_OBJECT_LEAD_RE = /\b(monitor|keyboard|car|shelves|setup)\b.*\b(scream|screams|saying|tells|disapproves|judging|begging|plotting)\b/i;
  if (NUCLEAR_OBJECT_LEAD_RE.test(text)) {
    score -= 14;
    if (isDev) console.log('[nuclear-v2] objectLead penalty', { text });
  }
  // Personal jab bonus: reward confidence/effort targeting (store-safe)
  const NUCLEAR_PERSONAL_JAB_RE = /\b(self-esteem|confidence|delusion|validation|attention|main character|audacity)\b/i;
  if (NUCLEAR_PERSONAL_JAB_RE.test(text)) {
    score += 14;
    if (isDev) console.log('[nuclear-v2] personalJab bonus', { text });
  }
  // Finality mic-drop bonus: reward short decisive endings
  const NUCLEAR_FINALITY_RE = /\b(try again|delete (it|this)|start over|no recovery|wasn't it|should've stayed private)\.?$/i;
  if (NUCLEAR_FINALITY_RE.test(s2.trim())) {
    score += 15;
    if (isDev) console.log('[nuclear-v2] finality bonus', { text });
  }
  // Hedge penalty: reduce weak/uncertain phrasing
  const NUCLEAR_HEDGE_RE = /\b(at best|maybe|kind of|sort of)\b/i;
  if (NUCLEAR_HEDGE_RE.test(text)) {
    score -= 8;
    if (isDev) console.log('[nuclear-v2] hedge penalty', { text });
  }
  // "Your" opener penalty: encourage diverse openers
  if (/^Your\b/i.test(sents[0].trim())) {
    score -= 10;
    if (isDev) console.log('[nuclear-v2] yourOpener penalty', { text });
  }
  // Trope penalties: "disagrees" / "deserves better"
  if (/\bdisagrees\b/i.test(text)) {
    score -= 14;
    if (isDev) console.log('[nuclear-v2] disagreesTrope penalty', { text });
  }
  if (/\bdeserves better\b/i.test(text)) {
    score -= 10;
    if (isDev) console.log('[nuclear-v2] deservesBetterTrope penalty', { text });
  }
  return { valid: true, score, reason: null };
}

// --- Main Nuclear V2 generator ---
async function generateNuclearV2({ clientId = 'anon', imageBase64, dynamicTargets = [], selfieTags = null }) {
  const t0 = Date.now();
  const isDev = process.env.NODE_ENV !== 'production';
  const state = getClientState(clientId);
  let fallbackUsed = false;
  let finalRoast = null;
  let wordCount = 0;
  let sceneTargetsAfterFilter = 0;

  // Build enriched dynamic targets from selfie tags if available
  const tags = selfieTags || { objects: [], angle: null, lighting: null, framing: null, setting: null, pose: null, hair: null, outfit: null, expression: null, grooming: null, bg_vibe: null };

  // Apply enhanced scene-noun filtering to dynamicTargets
  let filteredSceneTargets = nv2FilterSceneNouns(dynamicTargets);
  // Cap scene targets when person is present — prevent scene objects from dominating
  if (tags.person_present === 'yes' && filteredSceneTargets.length > 3) {
    filteredSceneTargets = filteredSceneTargets.slice(0, 3);
  }
  sceneTargetsAfterFilter = filteredSceneTargets.length;

  // Face usability check (uses atomic face_visible/face_obstructed fields)
  const isUsableFace = (tags.face_visible === 'yes' && tags.face_obstructed === 'no' && tags.face_confidence !== 'low');
  if (isDev) console.log(`[nuclear-v2] isUsableFace=${isUsableFace} face_visible=${tags.face_visible} face_obstructed=${tags.face_obstructed} face_confidence=${tags.face_confidence} person_present=${tags.person_present} outfit_visible=${tags.outfit_visible} hair_visible=${tags.hair_visible}`);

  // ===== PHASE 1: Freeform candidate generation =====
  // Build details block for freeform prompt
  const detailParts = [];
  if (isKnownTag(tags.lighting)) detailParts.push(`lighting: ${tags.lighting}`);
  if (isKnownTag(tags.setting)) detailParts.push(`setting: ${tags.setting}`);
  const faceVisible = tags.face_visible === 'yes' || tags.face_visible === true;
  const hairVisible = tags.hair_visible === 'yes' || tags.hair_visible === true;
  const outfitVisible = tags.outfit_visible === 'yes' || tags.outfit_visible === true;
  if (isKnownTag(tags.outfit) && outfitVisible) detailParts.push(`outfit: ${tags.outfit}`);
  if (isKnownTag(tags.expression) && faceVisible) detailParts.push(`expression: ${tags.expression}`);
  if (isKnownTag(tags.hair) && hairVisible) detailParts.push(`hair: ${tags.hair}`);
  if (isKnownTag(tags.pose) && isUsableFace) detailParts.push(`pose: ${tags.pose}`);
  if (isKnownTag(tags.grooming) && faceVisible) detailParts.push(`grooming: ${tags.grooming}`);
  if (isKnownTag(tags.bg_vibe)) detailParts.push(`vibe: ${tags.bg_vibe}`);
  if (isKnownTag(tags.angle)) detailParts.push(`angle: ${tags.angle}`);
  if (isKnownTag(tags.framing)) detailParts.push(`framing: ${tags.framing}`);
  if (tags.objects.length > 0) detailParts.push(`objects: ${tags.objects.slice(0, 6).join(', ')}`);
  if (filteredSceneTargets.length > 0) detailParts.push(`scene: ${filteredSceneTargets.slice(0, 4).join(', ')}`);
  const detailsBlock = `Visible details: [${detailParts.join('; ')}]`;

  // Build anchor lists for validation
  const detailAnchors = [
    ...detailParts.map(p => p.split(': ').slice(1).join(': ')).filter(Boolean),
    ...tags.objects.slice(0, 6),
    ...filteredSceneTargets.slice(0, 4),
  ].map(s => s.toLowerCase().trim()).filter(s => s.length >= 3 && s !== 'unknown');
  // Dedupe
  const detailAnchorSet = [...new Set(detailAnchors)];
  // Split compound anchors ("car hood" → also "car", "hood")
  const expandedAnchors = [];
  for (const a of detailAnchorSet) {
    expandedAnchors.push(a);
    if (a.includes(' ')) a.split(' ').filter(w => w.length >= 3).forEach(w => expandedAnchors.push(w));
  }
  const finalDetailAnchors = [...new Set(expandedAnchors)];

  // Detail pack minimum guarantee: ensure ≥3 usable anchors even when tags are weak
  if (finalDetailAnchors.length < 3) {
    const fallbackTerms = [tags.setting, tags.angle, tags.lighting, tags.framing, tags.bg_vibe, tags.pose]
      .map(v => v && typeof v === 'string' ? v.toLowerCase().trim() : null)
      .filter(v => v && v.length >= 3 && v !== 'unknown' && !finalDetailAnchors.includes(v));
    for (const t of fallbackTerms) {
      if (finalDetailAnchors.length >= 3) break;
      finalDetailAnchors.push(t);
    }
    if (isDev && finalDetailAnchors.length < 3) console.log(`[nuclear-v2] detailPackWeak=true anchors=${finalDetailAnchors.length}`);
  }

  // Identity anchor injection: ensure face/expression/hair/outfit are roastable when visible
  {
    let _injected = false;
    if (tags.face_visible === 'yes') {
      if (!finalDetailAnchors.includes('face')) { finalDetailAnchors.push('face'); _injected = true; }
      if (!finalDetailAnchors.includes('expression')) { finalDetailAnchors.push('expression'); _injected = true; }
    }
    if (tags.hair_visible === 'yes') {
      if (!finalDetailAnchors.includes('hair')) { finalDetailAnchors.push('hair'); _injected = true; }
    }
    if (tags.outfit_visible === 'yes') {
      if (!finalDetailAnchors.includes('outfit')) { finalDetailAnchors.push('outfit'); _injected = true; }
    }
    if (_injected && isDev) console.log('[nuclear-v2] injected identity anchors', { face_visible: tags.face_visible, hair_visible: tags.hair_visible, outfit_visible: tags.outfit_visible });
  }

  // Scene anchors: dynamic from tagger output, with generic-term stoplist
  const NV2_GENERIC_SCENE_STOP = new Set(['wall', 'floor', 'ceiling', 'room', 'door', 'window', 'background', 'surface', 'space', 'area', 'corner', 'side', 'thing', 'stuff', 'item', 'object', 'place']);
  const rawScenePool = [
    ...(isKnownTag(tags.setting) ? [tags.setting.toLowerCase()] : []),
    ...filteredSceneTargets.slice(0, 4).map(s => s.toLowerCase()),
    ...tags.objects.slice(0, 6).map(s => s.toLowerCase()),
  ];
  const sceneAnchors = [...new Set(rawScenePool)].filter(s => s.length >= 3 && !NV2_GENERIC_SCENE_STOP.has(s));

  // Pre-compute selfieAttrs and tagObjects for cameraOnlyS1 penalty
  const selfieAttrs = [tags.hair, tags.outfit, tags.expression, tags.grooming, tags.bg_vibe].map(cleanTagToken).filter(Boolean);
  const tagObjects = tags.objects.slice(0, 6).map(s => s.toLowerCase().trim()).filter(s => s.length >= 3);

  // Generate candidates — early-accept multi-call by default, batch behind NV2_BATCH=1
  const genN = isUsableFace ? 4 : 6;
  const useBatch = process.env.NV2_BATCH === '1';

  // Validate function used by early-accept path (clean + validate in one step)
  const validateFn = (raw) => {
    const cleaned = nv2SanitizeQuotes(nv2CleanOutput(raw));
    const result = nv2ValidateCandidate(cleaned, { detailAnchors: finalDetailAnchors, sceneAnchors, clientState: state, isDev, sceneFiltered: filteredSceneTargets, selfieAttrs, tagObjects, lightingTag: tags.lighting || '' });
    return { text: cleaned, ...result };
  };

  let results, valid, rejected, earlyMeta;

  if (useBatch) {
    const rawCandidates = await nv2GenerateCandidatesBatch({ imageBase64, detailsBlock, n: genN });
    results = rawCandidates.map(validateFn);
    valid = results.filter(r => r.valid).sort((a, b) => b.score - a.score);
    rejected = results.filter(r => !r.valid);
    earlyMeta = { earlyAccepted: false, earlyReason: 'batch', timeToFirstValid: null, timeToThirdValid: null, phase1InitialCalls: genN, phase1SettledCount: genN, graceWaitUsed: false, preTopUpValidCount: valid.length, boosterFired: false, boosterValidAdded: 0, topUpAttempted: false, topUpValidCount: 0, topUpMode: null, repairedCount: 0, repairedValidCount: 0, finalValidCount: valid.length };
  } else {
    const ea = await nv2GenerateCandidatesEarlyAccept({ imageBase64, detailsBlock, n: genN, validateFn, isUsableFace });
    results = ea.results;
    valid = results.filter(r => r.valid).sort((a, b) => b.score - a.score);
    rejected = results.filter(r => !r.valid);
    earlyMeta = ea;
  }

  const t1 = Date.now();
  console.log(`[nuclear-v2] generationTime=${t1 - t0}ms phase1InitialCalls=${earlyMeta.phase1InitialCalls ?? genN} phase1Settled=${earlyMeta.phase1SettledCount ?? '?'}/${genN} candidatesParsed=${results.length} mode=${useBatch ? 'batch' : 'early-accept'} earlyAccepted=${earlyMeta.earlyAccepted} earlyReason=${earlyMeta.earlyReason} graceWait=${earlyMeta.graceWaitUsed ?? false} preTopUpValid=${earlyMeta.preTopUpValidCount} booster=${earlyMeta.boosterFired ?? false}(+${earlyMeta.boosterValidAdded ?? 0}) topUp=${earlyMeta.topUpAttempted}(+${earlyMeta.topUpValidCount}) topUpMode=${earlyMeta.topUpMode} repairedCount=${earlyMeta.repairedCount} repairedValidCount=${earlyMeta.repairedValidCount} finalValidCount=${earlyMeta.finalValidCount} t1stValid=${earlyMeta.timeToFirstValid}ms t3rdValid=${earlyMeta.timeToThirdValid}ms`);

  if (results.length === 0 && !useBatch) {
    const settled = earlyMeta.phase1SettledCount ?? 0;
    const reason = settled >= genN ? 'all_failed' : 'timecap_zero_results';
    console.log(`[nuclear-v2] WARNING finalizeReason=${reason} phase1Settled=${settled}/${genN} graceWait=${earlyMeta.graceWaitUsed ?? false}`);
  }

  if (isDev) {
    const rejectSummary = {};
    rejected.forEach(r => { rejectSummary[r.reason] = (rejectSummary[r.reason] || 0) + 1; });
    console.log(`[nuclear-v2] candidates=${results.length} valid=${valid.length} rejected=${JSON.stringify(rejectSummary)}`);
    if (valid.length > 0) console.log(`[nuclear-v2] winner score=${valid[0].score} text="${valid[0].text}"`);
  }

  if (valid.length > 0) {
    finalRoast = valid[0].text;
  } else {
    // Pick best source candidate for rewrite: highest score, prefer weakMicdrop rejects
    const micdropRejects = results.filter(r => r.reason === 'weakMicdrop').sort((a, b) => b.score - a.score);
    const bestSource = micdropRejects.length > 0 ? micdropRejects[0]
      : results.sort((a, b) => b.score - a.score)[0] || results[0];
    // Text-only rewrite call (no image) — cheaper, faster, focused on format fix
    if (bestSource) {
      try {
        const rewritePrompt = `Rewrite this roast caption: "${bestSource.text}"\nProblem: ${bestSource.reason}.\n${detailsBlock}\nRules:\n- EXACTLY 2 sentences, 14-22 words total.\n- Sentence 2 must be 2-8 words. Sentence 2 must NOT start with "Even".\n- Reference at least 2 visible details and 1 scene element.\n- No quotes, no emojis, no hashtags, no questions.\n- Google Play safe.\n- Keep the comedic voice. Output ONLY the fixed caption.`;
        const rewriteResp = await openai.responses.create({
          model: 'gpt-4o',
          input: [
            { role: 'system', content: 'Rewrite the caption per the rules. Output only the result, no explanation.' },
            { role: 'user', content: rewritePrompt },
          ],
          max_output_tokens: 60,
          temperature: 0.5,
        });
        const fixed = nv2SanitizeQuotes(nv2CleanOutput(rewriteResp.output_text || ''));
        const fixResult = nv2ValidateCandidate(fixed, { detailAnchors: finalDetailAnchors, sceneAnchors, clientState: state, isDev, sceneFiltered: filteredSceneTargets, selfieAttrs, tagObjects, lightingTag: tags.lighting || '' });
        if (fixResult.valid) {
          finalRoast = fixed;
          if (isDev) console.log(`[nuclear-v2] rewriteFallback=success text="${fixed}"`);
        } else if (isDev) {
          console.log(`[nuclear-v2] rewriteFallback=rejected reason=${fixResult.reason} text="${fixed}"`);
        }
      } catch (e) {
        if (isDev) console.log(`[nuclear-v2] rewriteFallback=error ${e.message}`);
      }
    }
    // Intermediate fallback: best candidate that passes safety + format (even if missing detail/scene anchors)
    if (!finalRoast) {
      const safeFormatCandidates = results.filter(r => {
        const reason = r.reason;
        return reason === 'missingDetails' || reason === 'missingScene' || reason === 'noS1Anchor' || reason === 'templateStem' || reason === 'globalRepeat' || reason === 'weakMicdrop';
      }).filter(r => {
        // Re-verify safety + format on these (relax micdrop for intermediate)
        const t = r.text;
        const ss = t.match(/[^.!?]*[.!?]+/g);
        const ww = t.split(/\s+/).length;
        return ss && ss.length === 2 && ww >= 12 && ww <= 26 && isPlaySafe(t) && !looksLikeRefusal(t) && !nv2HasBannedPatterns(t);
      });
      if (safeFormatCandidates.length > 0) {
        finalRoast = safeFormatCandidates[0].text;
        if (isDev) console.log(`[nuclear-v2] intermediateFallback=safeFormat text="${finalRoast}"`);
      }
    }
    // Deterministic 2-sentence fallback (never return a 1-sentence result)
    if (!finalRoast) {
      finalRoast = NV2_SAFE_FALLBACKS[Math.floor(Math.random() * NV2_SAFE_FALLBACKS.length)];
      fallbackUsed = true;
      if (isDev) console.log('[nuclear-v2] allCandidatesFailed=true using safeFallback');
    }
  }
  wordCount = finalRoast.split(/\s+/).length;

  // ===== PHASE 2: Slim post-processing =====
  // Re-apply cleanup (already done during validation, but needed for rewrite fallback path)
  finalRoast = nv2SanitizeQuotes(nv2CleanOutput(finalRoast));

  // Quote + whitespace cleanup: strip all stray quotes, fix spacing
  finalRoast = finalRoast
    .replace(/[\u201C\u201D\u2018\u2019""]/g, '')  // remove double quotes + curly quotes (keep apostrophes)
    .replace(/\s+/g, ' ')                           // collapse multiple spaces
    .replace(/\s+([.!?,;:])/g, '$1')                // remove space before punctuation
    .trim();

  // Contraction + possessive normalization
  finalRoast = finalRoast
    .replace(/\bcant\b/g, "can't")
    .replace(/\bCant\b/g, "Can't")
    .replace(/\bwouldnt\b/g, "wouldn't")
    .replace(/\bWouldnt\b/g, "Wouldn't")
    .replace(/\bisnt\b/g, "isn't")
    .replace(/\bIsnt\b/g, "Isn't")
    .replace(/\bdont\b/g, "don't")
    .replace(/\bDont\b/g, "Don't")
    .replace(/\bdoesnt\b/g, "doesn't")
    .replace(/\bDoesnt\b/g, "Doesn't")
    .replace(/\bwont\b/g, "won't")
    .replace(/\bWont\b/g, "Won't")
    .replace(/\bcouldnt\b/g, "couldn't")
    .replace(/\bCouldnt\b/g, "Couldn't")
    .replace(/\bshouldnt\b/g, "shouldn't")
    .replace(/\bShouldnt\b/g, "Shouldn't")
    .replace(/\bdidnt\b/g, "didn't")
    .replace(/\bDidnt\b/g, "Didn't")
    .replace(/\byouve\b/g, "you've")
    .replace(/\bYouve\b/g, "You've")
    .replace(/\byoure\b/g, "you're")
    .replace(/\bYoure\b/g, "You're")
    .replace(/\btheyre\b/g, "they're")
    .replace(/\bTheyre\b/g, "They're")
    .replace(/\bthats\b/g, "that's")
    .replace(/\bThats\b/g, "That's")
    .replace(/\bwhats\b/g, "what's")
    .replace(/\bWhats\b/g, "What's")
    .replace(/\bheres\b/g, "here's")
    .replace(/\bHeres\b/g, "Here's")
    .replace(/\blets\b/g, "let's")
    .replace(/\bLets\b/g, "Let's")
    .replace(/\bwhos\b/g, "who's")
    .replace(/\bWhos\b/g, "Who's")
    .replace(/\bhasnt\b/g, "hasn't")
    .replace(/\bHasnt\b/g, "Hasn't")
    .replace(/\bwasnt\b/g, "wasn't")
    .replace(/\bWasnt\b/g, "Wasn't")
    .replace(/\bwerent\b/g, "weren't")
    .replace(/\bWerent\b/g, "Weren't")
    .replace(/\bwouldve\b/g, "would've")
    .replace(/\bWouldve\b/g, "Would've")
    .replace(/\bcouldve\b/g, "could've")
    .replace(/\bCouldve\b/g, "Could've")
    .replace(/\bshouldve\b/g, "should've")
    .replace(/\bShouldve\b/g, "Should've")
    // Common possessive fixes (noun + s where apostrophe was stripped)
    .replace(/\bcars\s+(hood|door|bumper|mirror|seat|window|trunk|roof|paint|interior)/g, "car's $1")
    .replace(/\bshirts\s+(collar|button|sleeve|fabric|fit|tag|pattern|design|logo)/g, "shirt's $1")
    .replace(/\bhairs\s+(part|line|texture|color|root|ends|volume|style)/g, "hair's $1")
    .replace(/\brooms\s+(lighting|vibe|energy|decor|walls|corner|ceiling|floor)/g, "room's $1")
    .replace(/\bmirrors\s+(reflection|angle|edge|frame|smudge)/g, "mirror's $1")
    .replace(/\bphones\s+(camera|flash|angle|case|screen|glow)/g, "phone's $1");

  // Platform-closer ban: replace sentence 2 if it contains platform-y clichés
  {
    const NV2_PLATFORM_CLOSER_BANS = ['the timeline remembers', 'turning off notifications', 'notifications', 'the algorithm noticed', 'left the chat'];
    const NV2_PLATFORM_CLOSER_REPLACEMENTS = ['Sit down.', 'Delete it.', 'Wrong room.', 'Not even close.', 'Try again.', 'Nope.', 'Bad choice.', 'Log off.'];
    const pcSents = finalRoast.match(/[^.!?]*[.!?]+/g);
    if (pcSents && pcSents.length >= 2) {
      const s2Lower = pcSents[pcSents.length - 1].trim().toLowerCase();
      if (NV2_PLATFORM_CLOSER_BANS.some(b => s2Lower.includes(b))) {
        const replacement = NV2_PLATFORM_CLOSER_REPLACEMENTS[Math.floor(Math.random() * NV2_PLATFORM_CLOSER_REPLACEMENTS.length)];
        finalRoast = pcSents[0].trim() + ' ' + replacement;
        wordCount = finalRoast.split(/\s+/).length;
        if (isDev) console.log(`[nuclear-v2] platformCloserBanned: "${pcSents[pcSents.length - 1].trim()}" -> "${replacement}"`);
      }
    }
  }

  // Timeline+notifications double-up guard
  {
    const lower = finalRoast.toLowerCase();
    if (lower.includes('timeline') && lower.includes('notification')) {
      finalRoast = finalRoast.replace(/\btimeline\b/gi, 'room');
      if (isDev) console.log(`[nuclear-v2] timelineNotificationDoubleUp=true -> replaced timeline with room`);
    }
  }

  // Broken sentence end repair
  if (nv2HasBrokenSentenceEnd(finalRoast)) {
    const repairSents = finalRoast.match(/[^.!?]*[.!?]+/g);
    if (repairSents) {
      const repaired = repairSents.map(s => {
        let t = s.trim();
        t = t.replace(/\s+\b(a|an|the|of|to|on|in|at|for|with|from|by|as)\s*([.!?])$/, '$2');
        t = t.replace(/\s+\b(on|in|at|of|to|for|with)\s+the\s*([.!?])$/, '$2');
        return t;
      });
      finalRoast = repaired.join(' ');
    }
    if (!/[.!?]$/.test(finalRoast)) finalRoast += '.';
    if (isDev) console.log(`[nuclear-v2] brokenSentenceEndDetected=true -> repaired`);
  }

  // Absolute final refusal guard
  if (looksLikeRefusal(finalRoast)) {
    finalRoast = 'That upload was brave. It wasn\'t smart.';
    wordCount = finalRoast.split(/\s+/).length;
    fallbackUsed = true;
  }

  // Push to client state + global anti-repeat pool
  pushClientRoast(clientId, finalRoast, 'freeform', 'FREEFORM', 'FREEFORM');
  pushRecentNuclear(finalRoast);

  // Track per-client nuclear texts for phrase fatigue
  state.recentNuclearTexts.push(finalRoast);
  if (state.recentNuclearTexts.length > 12) state.recentNuclearTexts.shift();
  // Track recent winners for lighting fatigue
  state.nv2RecentWinners.push(finalRoast);
  if (state.nv2RecentWinners.length > 3) state.nv2RecentWinners.shift();

  // Track target category and final text for graphic-tee rotation
  lastNuclearTargetCategory = 'other';
  lastNuclearFinalText = finalRoast;

  wordCount = finalRoast.split(/\s+/).length;

  if (isDev) {
    console.log(`[nuclear-v2] result="${finalRoast}" wordCount=${wordCount}`);
  }

  const t2 = Date.now();
  console.log(`[nuclear-v2] totalTime=${t2 - t0}ms`);

  if (process.env.TUNING_MODE) {
    return {
      roast: finalRoast,
      meta: {
        tier: 'nuclear',
        isUsableFace: typeof isUsableFace !== 'undefined' ? isUsableFace : null,
        detailPackWeak: typeof finalDetailAnchors !== 'undefined' ? finalDetailAnchors.length < 3 : null,
        anchorsCount: typeof selfieAttrs !== 'undefined' ? selfieAttrs.length : null,
        candidatesCount: typeof rawCandidates !== 'undefined' ? rawCandidates.length : null,
        validCount: typeof valid !== 'undefined' ? valid.length : null,
        rejectedReasons: typeof rejected !== 'undefined' ? rejected.map(r => r.reason) : null,
        winnerScore: typeof valid !== 'undefined' && valid.length > 0 ? valid[0].score : null,
        generationTime: t1 - t0,
        totalTime: t2 - t0,
        earlyReason: earlyMeta.earlyReason,
        preTopUpValidCount: earlyMeta.preTopUpValidCount,
        topUpMode: earlyMeta.topUpMode,
        repairedCount: earlyMeta.repairedCount,
        repairedValidCount: earlyMeta.repairedValidCount,
        finalValidCount: earlyMeta.finalValidCount,
        phase1InitialCalls: earlyMeta.phase1InitialCalls ?? genN,
        phase1SettledCount: earlyMeta.phase1SettledCount ?? null,
        graceWaitUsed: earlyMeta.graceWaitUsed ?? false,
      },
    };
  }
  return {
    roast: finalRoast,
    meta: {
      candidateCount: results.length,
      validCount: valid.length,
      winnerScore: valid.length > 0 ? valid[0].score : 0,
      fallbackUsed,
      clientId,
      wordCount,
      targetSource: 'freeform',
      selfieAttrs,
      tagModifiers: [tags.angle, tags.lighting, tags.framing, tags.pose, tags.setting].map(cleanTagToken).filter(Boolean),
      sceneTargetCount: dynamicTargets.length,
      sceneTargetsAfterFilter,
      tagObjectCount: tags.objects.length,
    },
  };
}

// --- Nuclear V2 self-check (dev only) ---
if (process.env.NV2_DEBUG === '1') {
  (async () => {
    console.log('\n=== Nuclear V2 Self-Check (5 runs, same client) ===');
    const testClientId = 'selfcheck-' + Date.now();
    // Use a tiny placeholder image (1x1 white pixel JPEG base64)
    const tinyImg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AAAf/2Q==';
    for (let i = 0; i < 5; i++) {
      const { roast, meta } = await generateNuclearV2({ clientId: testClientId, imageBase64: tinyImg });
      console.log(`  [${i + 1}] candidates=${meta.candidateCount} valid=${meta.validCount} score=${meta.winnerScore} words=${meta.wordCount} fallback=${meta.fallbackUsed}`);
      console.log(`       "${roast}"`);
    }
    console.log('=== End Self-Check ===\n');
  })();
}

// ============================================================
// SAVAGE V2 — Hybrid skeleton + GPT-polish (scaffolding, not wired by default)
// ============================================================

// --- Savage V2 Structure Templates (10+) ---
const SV2_STRUCTURE_TEMPLATES = [
  { id: 'V01', tpl: 'Your {TARGET} {CRITIQUE} — {ESCALATION}.' },
  { id: 'V02', tpl: 'That {TARGET} {CRITIQUE}. {ESCALATION}.' },
  { id: 'V03', tpl: 'The {TARGET} {CRITIQUE} and it shows.' },
  { id: 'V04', tpl: 'Nobody needed to see your {TARGET} to know {CRITIQUE}.' },
  { id: 'V05', tpl: 'Your {TARGET} {CRITIQUE}. {ESCALATION}.' },
  { id: 'V06', tpl: 'Even your {TARGET} {CRITIQUE}. {ESCALATION}.' },
  { id: 'V07', tpl: 'One look at that {TARGET} and {CRITIQUE}.' },
  { id: 'V08', tpl: 'Your {TARGET} says {CRITIQUE}. {ESCALATION}.' },
  { id: 'V09', tpl: '{ESCALATION} — your {TARGET} {CRITIQUE}.' },
  { id: 'V10', tpl: 'That {TARGET} is proof that {CRITIQUE}.' },
];

const SV2_TEMPLATE_FAMILY = {
  V01: 'FAMILY_YOUR',
  V02: 'FAMILY_THAT',
  V03: 'FAMILY_THE',
  V04: 'FAMILY_NOBODY',
  V05: 'FAMILY_YOUR',
  V06: 'FAMILY_EVEN',
  V07: 'FAMILY_MISC',
  V08: 'FAMILY_YOUR',
  V09: 'FAMILY_MISC',
  V10: 'FAMILY_THAT',
};

// --- Savage V2 Targets (25+) ---
const SV2_TARGET_BUCKET = [
  'hairline', 'posture', 'fit', 'smile', 'jawline', 'outfit', 'stance',
  'angle', 'hoodie', 'expression', 'shirt', 'glasses', 'beard', 'eyebrows',
  'crop', 'shoes', 'background', 'hat', 'hair', 'collar', 'squint',
  'head tilt', 'arm placement', 'jacket', 'eye contact', 'watch',
];

// --- Savage V2 Critiques (30+) ---
const SV2_CRITIQUE_BUCKET = [
  'gave up halfway', 'lost the plot', 'missed the memo',
  'peaked in 2019', 'reads as borrowed', 'begs for validation',
  'works against you', 'needs a second draft', 'called in sick',
  'went through the motions', 'committed to nothing', 'skipped the tutorial',
  'ran out of ideas', 'overcompensates', 'tries too hard',
  'forgot to be convincing', 'fronts harder than it delivers',
  'tells on you', 'raises concerns', 'lowers the bar',
  'peaked already', 'is the wrong answer', 'auditioned and lost',
  'delivers diminishing returns', 'set the bar underground',
  'functions as a warning', 'came pre-defeated', 'proves the point',
  'carries the whole disappointment', 'does zero favors', 'reeks of last resort',
];

// Clause critiques: verbs/phrases that follow "Your {TARGET} ..."
const SV2_CRITIQUE_CLAUSE = [
  'gave up halfway', 'lost the plot', 'missed the memo',
  'peaked in 2019', 'called in sick',
  'committed to nothing', 'skipped the tutorial',
  'ran out of ideas', 'overcompensates', 'tries too hard',
  'forgot to be convincing', 'fronts harder than it delivers',
  'tells on you', 'raises concerns', 'lowers the bar',
  'peaked already', 'auditioned and lost',
  'delivers diminishing returns', 'set the bar underground',
  'came pre-defeated', 'proves the point', 'does zero favors',
  'is mid with confidence', 'looks AI-generated', 'belongs in drafts',
  'is fighting the algorithm', 'is confidence without clearance',
  'screams unpaid internship', 'peaked before you pressed post',
  'is bold without permission', 'is buffering in real time',
  'is sponsored by delusion', 'is participation trophy energy',
  'is commitment to nothing', 'is allergic to self-awareness',
  'is mid but committed', 'is trying hard in the wrong direction',
];

// Noun-phrase critiques: work after "says" or "to know"
const SV2_CRITIQUE_NOUN = [
  'a rough draft', 'a cry for help', 'last resort energy',
  'zero follow-through', 'diminishing returns', 'the wrong answer',
  'borrowed confidence', 'a participation trophy', 'the bare minimum',
  'nothing new', 'unfinished business', 'a warning label',
  'pre-defeat energy', 'the whole disappointment', 'a second draft at best',
];

// "that"-clause critiques: read after "is proof that ..."
const SV2_CRITIQUE_THAT = [
  'you gave up halfway', 'nobody proofread this', 'effort is optional',
  'this was rushed', 'confidence is unearned', 'the bar is underground',
  'trying harder is not the move', 'the preview was better',
  'less is not always more', 'not everything deserves a post',
  'the rough draft won', 'validation was the whole plan',
];

// "and"-clause critiques: read after "One look at that {TARGET} and ..."
const SV2_CRITIQUE_AND = [
  'you gave up halfway', 'you lost the plot', 'you missed the memo',
  'you peaked in 2019', 'it needs a second draft', 'it went through the motions',
  'it works against you', "it's the wrong answer", "it's a cry for help",
  "it's last resort energy",
];

// --- Savage V2 Escalations (25+) — lighter than nuclear ---
const SV2_ESCALATION_BUCKET = [
  'Not the flex', 'Bold choice', 'The room noticed',
  'Nobody asked', 'Read that back', 'Be serious',
  'Results are in', 'Swing and a miss', 'Wrong audience',
  'Rough draft energy', 'Almost something', 'Not the serve',
  'Barely counts', 'Bold move', 'Work in progress',
  'Respectfully no', 'Off-brand energy', 'Participation trophy',
  'Return to drafts', 'Wrong energy', 'Try again',
  'Didn\'t land', 'Barely registered', 'Reality check',
  'Not quite', 'Points for trying',
];

// Full short sentences for ". {ESCALATION}." slots
const SV2_ESCALATION_SENTENCE = [
  'Read that back', 'Be serious', 'Try again',
  'Nobody asked', 'The room noticed', 'Results are in',
  'Barely counts', 'Return to drafts', 'Not quite',
  'Respectfully no', 'Reality check', 'Start over',
  'In public', 'Delete this', 'Wild choice',
  'Respectfully', 'The group chat noticed', 'You had time',
  'Not the flex', "That's brave", 'Bold in the worst way',
  "This wasn't it",
];

// Fragment tags for "— {ESCALATION}" slots
const SV2_ESCALATION_TAG = [
  'Not the flex', 'Bold choice', 'Swing and a miss',
  'Wrong audience', 'Rough draft energy', 'Almost something',
  'Not the serve', 'Bold move', 'Work in progress',
  'Off-brand energy', 'Participation trophy', 'Wrong energy',
  'Didn\'t land', 'Barely registered', 'Points for trying',
];

// --- Savage V2 Micro Templates (short viral punches) ---
const SV2_MICRO_TEMPLATES = [
  '{TARGET}. Mid with confidence. In public.',
  "{TARGET}. That's brave. The room noticed.",
  '{TARGET}. Delete this. You had time.',
  '{TARGET}. In public? Wild choice.',
  'Mid with confidence. {TARGET}. Not the flex.',
  'Confidence without clearance. The room noticed.',
  '{TARGET}. Bold for no reason. Be serious.',
  "{TARGET}. This wasn't it. Try again.",
];

// --- Savage V2 Safe Fallbacks ---
const SV2_SAFE_FALLBACKS = [
  'That angle was a creative choice. Creative, not effective.',
  'Bold strategy going with that look. Bold is generous.',
  'You posed like this was rehearsed. The rehearsal lost.',
  'Your confidence walked in before your talent did.',
  'That effort was voluntary and it still underdelivered.',
];

const SV2_LOCAL_CANDIDATES = 8;

// --- Per-client Savage V2 state ---
const savageClientState = new Map();
const SV2_MAX_RECENT_ROASTS = 20;
const SV2_MAX_RECENT_TARGETS = 6;
const SV2_MAX_RECENT_STRUCTURES = 6;

function getSavageClientState(clientId) {
  if (!savageClientState.has(clientId)) {
    savageClientState.set(clientId, {
      recentRoasts: [],
      recentTargets: [],
      recentStructures: [],
    });
  }
  return savageClientState.get(clientId);
}

function pushSavageClientRoast(clientId, roast, target, structureId) {
  const st = getSavageClientState(clientId);
  st.recentRoasts.push(roast);
  if (st.recentRoasts.length > SV2_MAX_RECENT_ROASTS) st.recentRoasts.shift();
  st.recentTargets.push(target);
  if (st.recentTargets.length > SV2_MAX_RECENT_TARGETS) st.recentTargets.shift();
  st.recentStructures.push(structureId);
  if (st.recentStructures.length > SV2_MAX_RECENT_STRUCTURES) st.recentStructures.shift();
}

// --- Savage V2 output cleaner (1–2 sentences, 12–26 words preferred) ---
function sv2CleanOutput(text) {
  let out = text.trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
  const sents = out.match(/[^.!?]*[.!?]+/g);
  if (sents && sents.length > 2) {
    out = sents.slice(0, 2).map(s => s.trim()).join(' ');
  }
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

// --- Main Savage V2 generator ---
async function generateSavageV2({ clientId = 'anon', imageBase64 }) {
  const _t0 = Date.now();
  const isDev = process.env.NODE_ENV !== 'production';
  const state = getSavageClientState(clientId);
  const clientKey = clientId || 'anon';
  const recentFamilies = getSavageFamilyHistory(clientKey);
  const structHistory = savageStructureHistory.get(clientId) || [];
  let fallbackUsed = false;
  let pickedStructure = null;
  let pickedTarget = null;
  let finalRoast = null;
  let wordCount = 0;

  // 0. Micro-template fast path (~12% chance)
  const useMicro = Math.random() < 0.12;
  if (useMicro) {
    const microTarget = nv2SelectWithAvoidance(
      SV2_TARGET_BUCKET, state.recentTargets, NV2_MAX_SELECT_TRIES
    );
    const capTarget = microTarget.charAt(0).toUpperCase() + microTarget.slice(1);
    let microTpl = SV2_MICRO_TEMPLATES[Math.floor(Math.random() * SV2_MICRO_TEMPLATES.length)];
    let microResult = microTpl.replace('{TARGET}', capTarget);
    let microWc = microResult.split(/\s+/).length;

    // Reroll once if too short
    if (microWc < 9) {
      microTpl = SV2_MICRO_TEMPLATES[Math.floor(Math.random() * SV2_MICRO_TEMPLATES.length)];
      microResult = microTpl.replace('{TARGET}', capTarget);
      microWc = microResult.split(/\s+/).length;
    }

    // If still too short, fall through to normal candidate path
    if (microWc < 9) {
      if (isDev) console.log(`[savage-v2] micro too short (${microWc}w), falling through to candidates`);
    } else if (!nv2HasBannedPatterns(microResult) && isPlaySafe(microResult)) {
      pickedStructure = { id: 'MICRO' };
      pickedTarget = microTarget;
      finalRoast = microResult;
      wordCount = finalRoast.split(/\s+/).length;

      pushSavageClientRoast(clientId, finalRoast, pickedTarget, pickedStructure.id);
      const prevHistory = savageStructureHistory.get(clientId) || [];
      savageStructureHistory.set(clientId, [pickedStructure.id, ...prevHistory].slice(0, 3));
      pushSavageFamilyHistory(clientId, 'FAMILY_MISC');

      if (isDev) {
        console.log(`[savage-v2] micro clientId=${clientId} target="${pickedTarget}" words=${wordCount}`);
        console.log(`[savage-v2] result="${finalRoast}"`);
      }

      const microMeta = {
        tier: 'savage',
        useMicro: true,
        structureId: 'MICRO',
        familyId: 'FAMILY_MISC',
        target: pickedTarget,
        wordCount,
        candidatesCount: 1,
        winnerScore: null,
      };
      console.log('[savage-v2 timing]', { micro: true, totalMs: Date.now() - _t0 });
      return { roast: finalRoast, meta: microMeta };
    } else {
      // Micro fails validation, fall through to normal candidate path
      if (isDev) console.log(`[savage-v2] micro failed validation, falling through to candidates`);
    }
  }

  // 1. Build local skeleton candidates and score them
  const candidates = [];
  const batchRecentStructures = [...state.recentStructures];
  const batchRecentTargets = [...state.recentTargets];
  for (let i = 0; i < SV2_LOCAL_CANDIDATES; i++) {
    // Pick structure with avoidance, then apply family fatigue reroll-once
    let structure = nv2SelectWithAvoidance(
      SV2_STRUCTURE_TEMPLATES, batchRecentStructures, NV2_MAX_SELECT_TRIES
    );
    let familyId = SV2_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';
    let rerolled = false;

    if (recentFamilies.includes(familyId)) {
      const altTemplates = SV2_STRUCTURE_TEMPLATES.filter(t => {
        const fam = SV2_TEMPLATE_FAMILY[t.id] || 'FAMILY_MISC';
        return fam !== familyId;
      });
      if (altTemplates.length > 0) {
        structure = nv2SelectWithAvoidance(
          altTemplates, batchRecentStructures, NV2_MAX_SELECT_TRIES
        );
        familyId = SV2_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';
        rerolled = true;
      }
    }
    batchRecentStructures.push(structure.id);
    if (batchRecentStructures.length > 6) batchRecentStructures.shift();

    const target = nv2SelectWithAvoidance(
      SV2_TARGET_BUCKET, batchRecentTargets, NV2_MAX_SELECT_TRIES
    );
    batchRecentTargets.push(typeof target === 'object' ? target.id : target);
    if (batchRecentTargets.length > 6) batchRecentTargets.shift();
    // Template-aware critique selection
    let critPool = SV2_CRITIQUE_CLAUSE;
    if (structure.id === 'V08' || structure.id === 'V04') critPool = SV2_CRITIQUE_NOUN;
    else if (structure.id === 'V07') critPool = SV2_CRITIQUE_AND;
    else if (structure.id === 'V10') critPool = SV2_CRITIQUE_THAT;
    const critique = critPool[Math.floor(Math.random() * critPool.length)];

    // Template-aware escalation selection
    const usesSentenceEsc = ['V02', 'V05', 'V06', 'V08'].includes(structure.id);
    const usesTagEsc = ['V01', 'V09'].includes(structure.id);
    let escPool = SV2_ESCALATION_BUCKET;
    if (usesSentenceEsc) escPool = SV2_ESCALATION_SENTENCE;
    else if (usesTagEsc) escPool = SV2_ESCALATION_TAG;
    const escalation = escPool[Math.floor(Math.random() * escPool.length)];

    // Plural subject–verb agreement for "{TARGET} {CRITIQUE}" templates
    let finalCritique = critique;
    const pluralTargets = new Set(['glasses', 'shoes', 'pants', 'jeans', 'socks']);
    if ((pluralTargets.has(target) || target.endsWith('s')) &&
        ['V01', 'V02', 'V03', 'V05', 'V06', 'V09'].includes(structure.id)) {
      finalCritique = finalCritique
        .replace(/^needs /, 'need ')
        .replace(/^works /, 'work ')
        .replace(/^fronts /, 'front ');
    }

    let tpl = structure.tpl;
    // V07 plural grammar: "One look at that" -> "One look at those"
    if (structure.id === 'V07' && (target.endsWith('s') || ['glasses', 'shoes', 'eyebrows'].includes(target))) {
      tpl = tpl.replace('that {TARGET}', 'those {TARGET}');
    }

    const skeleton = tpl
      .replace('{TARGET}', target)
      .replace('{CRITIQUE}', finalCritique)
      .replace('{ESCALATION}', escalation);

    const wc = skeleton.split(/\s+/).length;

    // Score using existing rules
    let wcScore = 0;
    if (wc <= 8) wcScore -= 12;
    else if (wc === 9) wcScore -= 2;
    else if (wc >= 10 && wc <= 14) wcScore += 12;
    if (wc >= 11 && wc <= 12) wcScore += 6;
    if (wc > 16) wcScore -= 6;

    // V04 dominance penalty
    if (structure.id === 'V04') wcScore -= 10;

    // Structure fatigue penalty
    if (structHistory.includes(structure.id)) wcScore -= 12;

    candidates.push({ structure, familyId, rerolled, target, critique, escalation, skeleton, wcScore, wordCount: wc });
  }

  // 2. Sort candidates: highest wcScore first; tie-break by word count proximity to 11–12
  candidates.sort((a, b) => {
    if (b.wcScore !== a.wcScore) return b.wcScore - a.wcScore;
    const aInSweet = (a.wordCount >= 11 && a.wordCount <= 12) ? 1 : 0;
    const bInSweet = (b.wordCount >= 11 && b.wordCount <= 12) ? 1 : 0;
    if (bInSweet !== aInSweet) return bInSweet - aInSweet;
    const aInGood = (a.wordCount >= 10 && a.wordCount <= 14) ? 1 : 0;
    const bInGood = (b.wordCount >= 10 && b.wordCount <= 14) ? 1 : 0;
    return bInGood - aInGood;
  });

  if (process.env.TUNING_MODE) {
    const uniqueTemplates = new Set(candidates.map(c => c.structure.id)).size;
    const top3 = candidates.slice(0, 3).map((c, i) => `#${i + 1} template=${c.structure.id} family=${c.familyId} wc=${c.wordCount} score=${c.wcScore}`);
    console.log('[sav2] uniqueTemplates=%d/%d top3: %s', uniqueTemplates, SV2_LOCAL_CANDIDATES, top3.join(' | '));
  }

  const _tPrep = Date.now();

  // 3. Polish best candidate (fallback to 2nd-best if validation fails)
  async function polishAndValidate(candidate) {
    let polished = candidate.skeleton;
    if (!process.env.TUNING_MODE) {
      const polishPrompt = `Rewrite this EXACT roast to sound more natural and punchy. Do NOT add new ideas, do NOT change the target, do NOT add new sentences. Keep 1–2 sentences. 12–26 words preferred. Do NOT use questions. Output ONLY the rewritten roast, nothing else.\n\nRoast: "${candidate.skeleton}"`;
      try {
        const polishOpts = {
          model: 'gpt-4o',
          input: [
            { role: 'system', content: 'You are a roast rewriter. You ONLY output the rewritten roast. No quotes, no explanation, no markdown. 1–2 sentences only. Savage but not cruel. NEVER mention not knowing who someone is. NEVER use assistant disclaimers. Roast only visible details.' },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: polishPrompt },
                { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
              ],
            },
          ],
          max_output_tokens: 100,
          temperature: 0.85,
          top_p: 0.9,
        };
        const polishResp = await openai.responses.create(polishOpts);
        if (polishResp.output_text) polished = polishResp.output_text;
      } catch (err) {
        if (isDev) console.log(`[savage-v2] polish LLM error: ${err.message}`);
      }
    }

    let result = sv2CleanOutput(polished);
    if (nv2HasBannedPatterns(result)) {
      if (isDev) console.log(`[savage-v2] banned pattern detected`);
      return null;
    }
    if (isIdentityUncertainty(result) || isRefusalLike(result)) {
      if (isDev) console.log(`[savage-v2] identity-uncertainty/refusal rejected: "${result.slice(0, 60)}"`);
      return null;
    }
    if (!isPlaySafe(result)) {
      if (isDev) console.log(`[savage-v2] play-safe filter triggered`);
      return null;
    }
    if (result.split(/\s+/).length > 30) result = sv2CleanOutput(result);
    return result;
  }

  // Try best candidate — skip polish if skeleton already passes quality gate
  const best = candidates[0];
  if (best && canSkipPolish(best.skeleton, 'savage')) {
    finalRoast = sv2CleanOutput(best.skeleton);
    pickedStructure = best.structure;
    pickedTarget = best.target;
    wordCount = finalRoast.split(/\s+/).length;
    if (isDev) console.log(`[savage-v2] polishSkipped=true skeleton="${finalRoast.slice(0, 60)}"`);
  }

  if (!finalRoast) {
    finalRoast = await polishAndValidate(best);
    if (finalRoast) {
      pickedStructure = best.structure;
      pickedTarget = best.target;
      wordCount = finalRoast.split(/\s+/).length;
    }
  }

  // Fallback: try 2nd-best candidate (one extra polish attempt max)
  if (!finalRoast && candidates.length > 1) {
    const second = candidates[1];
    if (isDev) console.log(`[savage-v2] best failed validation, trying 2nd-best template=${second.structure.id}`);
    if (canSkipPolish(second.skeleton, 'savage')) {
      finalRoast = sv2CleanOutput(second.skeleton);
      pickedStructure = second.structure;
      pickedTarget = second.target;
      wordCount = finalRoast.split(/\s+/).length;
      if (isDev) console.log(`[savage-v2] polishSkipped=true (2nd) skeleton="${finalRoast.slice(0, 60)}"`);
    } else {
      finalRoast = await polishAndValidate(second);
      if (finalRoast) {
        pickedStructure = second.structure;
        pickedTarget = second.target;
        wordCount = finalRoast.split(/\s+/).length;
      }
    }
  }

  // Safe fallback
  if (!finalRoast) {
    fallbackUsed = true;
    finalRoast = SV2_SAFE_FALLBACKS[Math.floor(Math.random() * SV2_SAFE_FALLBACKS.length)];
    wordCount = finalRoast.split(/\s+/).length;
    pickedStructure = { id: 'FALLBACK' };
    pickedTarget = 'fallback';
    if (isDev) console.log(`[savage-v2] all candidates failed, using safe fallback`);
  }

  // Plural agreement fix for plural targets
  const SV2_PLURAL_TARGETS = new Set(['glasses', 'shoes', 'eyebrows', 'pants', 'jeans', 'socks']);
  if (pickedTarget && (SV2_PLURAL_TARGETS.has(pickedTarget) || pickedTarget.endsWith('s'))) {
    finalRoast = finalRoast.replace(/ is /g, ' are ').replace(/ needs /g, ' need ').replace(/ tells /g, ' tell ');
  }

  pushSavageClientRoast(clientId, finalRoast, pickedTarget, pickedStructure.id);

  // Update structure fatigue history (keep last 3)
  const prevHistory = savageStructureHistory.get(clientId) || [];
  savageStructureHistory.set(clientId, [pickedStructure.id, ...prevHistory].slice(0, 3));

  // Update template family fatigue history (keep last 3)
  const finalFamily = SV2_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC';
  pushSavageFamilyHistory(clientId, finalFamily);

  if (isDev) {
    console.log(`[savage-v2] clientId=${clientId} structureId=${pickedStructure.id} target="${pickedTarget}" fallback=${fallbackUsed} words=${wordCount}`);
    console.log(`[savage-v2] result="${finalRoast}"`);
  }

  const _tDone = Date.now();
  console.log('[savage-v2 timing]', { prepMs: _tPrep - _t0, polishMs: _tDone - _tPrep, totalMs: _tDone - _t0 });

  const normalMeta = {
    tier: 'savage',
    useMicro: false,
    structureId: pickedStructure.id,
    familyId: SV2_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC',
    target: pickedTarget,
    wordCount,
    candidatesCount: SV2_LOCAL_CANDIDATES,
    winnerScore: best ? best.wcScore : null,
  };
  return { roast: finalRoast, meta: normalMeta };
}

// ============================================================
// NUCLEAR-SV — Nuclear tier via local skeleton + single LLM polish
// Goal: reduce latency by replacing multi-call vision with template gen
// ============================================================

// --- Nuclear-SV config ---
const NSV_LOCAL_CANDIDATES = 10;
const NSV_MAX_RECENT_STRUCTURES = 6;
const NSV_MAX_RECENT_TARGETS = 6;
const NSV_MICRO_TEMPLATE_RATE = 0;  // disabled for freeze

// --- Nuclear-SV banned phrases (narration/legal tone filter) ---
const NSV_BANNED_PHRASES = [
  "there is an entire timeline that led to",
  "entire timeline",
  "the whole journey was pointless",
  "whole journey",
  "proved the whole",
  "all the proof required to close this case",
  "close this case",
  "sealed the verdict permanently",
  "sealed the verdict",
  "the verdict on",
  "came back and it is devastating",
  "eliminated any chance of appeal",
  "any chance of appeal",
  "confirmed the whole case",
  "confirms the whole theory",
  "confirms there was no hesitation",
];

function nsvHasBannedPhrases(text = '') {
  const t = String(text).toLowerCase();
  return NSV_BANNED_PHRASES.some(p => t.includes(p));
}

// --- Nuclear-SV soft narration/legal token penalty ---
const NSV_SOFT_BAD_TOKENS = [
  "timeline", "journey", "theory", "verdict", "appeal",
  "proof", "case", "confirmed", "confirms", "proved",
  "explains", "required", "hesitation", "devastating",
];

function nsvNarrationPenalty(text = '') {
  const t = String(text).toLowerCase();
  let penalty = 0;
  for (const tok of NSV_SOFT_BAD_TOKENS) {
    if (t.includes(tok)) penalty += 3;
  }
  return Math.min(penalty, 12);
}

// --- Nuclear-SV Structure Templates ---
// ~40 templates across 8 reasoning families for maximum rhythm diversity.
// Two-sentence escalation format: S1 (setup with {TARGET}, 9-12 words) + S2 (punchline with {SECOND_TARGET}, 5-9 words).
// Singular/plural variants: [singular, plural] — selected at render time per target.
// S2 types: correction, consequence, exposure, social reaction.
const NSV_STRUCTURES = [
  // ── FAMILY: EVIDENCE (proving / case-building logic) ──
  { id: 'EV01', s1: ['The {TARGET} alone is all the evidence anyone needs.', 'The {TARGET} alone are all the evidence anyone needs.'], s2: ['The {SECOND_TARGET} just made it worse.', 'The {SECOND_TARGET} just made it worse.'] },
  { id: 'EV02', s1: ['That {TARGET} already said everything.', 'Those {TARGET} already said everything.'], s2: ['The {SECOND_TARGET} just backed it up.', 'The {SECOND_TARGET} just backed it up.'] },
  { id: 'EV03', s1: ['Your {TARGET} already told on you.', 'Your {TARGET} already told on you.'], s2: ['The {SECOND_TARGET} showed up as backup.', 'The {SECOND_TARGET} showed up as backup.'] },
  { id: 'EV04', s1: ['If anyone needed proof, your {TARGET} just settled it.', 'If anyone needed proof, your {TARGET} just settled it.'], s2: ['That {SECOND_TARGET} sealed the case immediately.', 'Those {SECOND_TARGET} sealed the case immediately.'] },
  { id: 'EV05', s1: ['The {TARGET} speaks for itself and it is not good.', 'The {TARGET} speak for themselves and it is not good.'], s2: ['The {SECOND_TARGET} agreed out loud.', 'The {SECOND_TARGET} agreed out loud.'] },

  // ── FAMILY: SOCIAL SHAME (placement / drafts / group chat logic) ──
  { id: 'SS01', s1: ['Your {TARGET} got this photo forwarded to the group chat.', 'Your {TARGET} got this photo forwarded to the group chat.'], s2: ['The {SECOND_TARGET} made it the pinned message.', 'The {SECOND_TARGET} made it the pinned message.'] },
  { id: 'SS02', s1: ['That {TARGET} explains why this stayed in the drafts folder.', 'Those {TARGET} explain why this stayed in the drafts folder.'], s2: ['The {SECOND_TARGET} explains why nobody asked for more.', 'The {SECOND_TARGET} explain why nobody asked for more.'] },
  { id: 'SS03', s1: ['This whole photo belongs in the evidence folder because of that {TARGET}.', 'This whole photo belongs in the evidence folder because of those {TARGET}.'], s2: ['The {SECOND_TARGET} got it archived permanently.', 'The {SECOND_TARGET} got it archived permanently.'] },
  { id: 'SS04', s1: ['The {TARGET} is the reason nobody shared this to their story.', 'The {TARGET} are the reason nobody shared this to their story.'], s2: ['The {SECOND_TARGET} made sure it stayed buried.', 'The {SECOND_TARGET} made sure it stayed buried.'] },
  { id: 'SS05', s1: ['Someone screenshotted this before you could delete that {TARGET}.', 'Someone screenshotted this before you could delete those {TARGET}.'], s2: ['The {SECOND_TARGET} made it worth saving forever.', 'The {SECOND_TARGET} made it worth saving forever.'] },

  // ── FAMILY: VERDICT (judgment / ruling / finality logic) ──
  { id: 'VD01', s1: ['The results on your {TARGET} came back and it is bad.', 'The results on your {TARGET} came back and it is bad.'], s2: ['The {SECOND_TARGET} made it hopeless.', 'The {SECOND_TARGET} made it hopeless.'] },
  { id: 'VD02', s1: ['Your {TARGET} just shut this whole photo down.', 'Your {TARGET} just shut this whole photo down.'], s2: ['That {SECOND_TARGET} finished it off.', 'Those {SECOND_TARGET} finished it off.'] },
  { id: 'VD03', s1: ['Nobody would look at that {TARGET} and think this was okay.', 'Nobody would look at those {TARGET} and think this was okay.'], s2: ['The {SECOND_TARGET} sealed it.', 'The {SECOND_TARGET} sealed it.'] },
  { id: 'VD04', s1: ['That {TARGET} already decided how this photo gets remembered.', 'Those {TARGET} already decided how this photo gets remembered.'], s2: ['The {SECOND_TARGET} made sure nobody forgets it.', 'The {SECOND_TARGET} made sure nobody forgets it.'] },
  { id: 'VD05', s1: ['Your {TARGET} put this whole photo on trial.', 'Your {TARGET} put this whole photo on trial.'], s2: ['The {SECOND_TARGET} confirmed everything.', 'The {SECOND_TARGET} confirmed everything.'] },

  // ── FAMILY: NARRATIVE (storytelling / scene-setting logic) ──
  { id: 'NR01', s1: ['One look at your {TARGET} and everyone already knows the story.', 'One look at your {TARGET} and everyone already knows the story.'], s2: ['The {SECOND_TARGET} added the tragic epilogue.', 'The {SECOND_TARGET} added the tragic epilogue.'] },
  { id: 'NR02', s1: ['The story this photo tells starts and ends with that {TARGET}.', 'The story this photo tells starts and ends with those {TARGET}.'], s2: ['The {SECOND_TARGET} wrote the worst chapter.', 'The {SECOND_TARGET} wrote the worst chapter.'] },
  { id: 'NR03', s1: ['Somewhere between the camera and the upload your {TARGET} ruined everything.', 'Somewhere between the camera and the upload your {TARGET} ruined everything.'], s2: ['The {SECOND_TARGET} made sure there were witnesses.', 'The {SECOND_TARGET} made sure there were witnesses.'] },
  { id: 'NR04', s1: ['Everything in this photo led up to that {TARGET}.', 'Everything in this photo led up to those {TARGET}.'], s2: ['The {SECOND_TARGET} wrecked whatever was left.', 'The {SECOND_TARGET} wrecked whatever was left.'] },
  { id: 'NR05', s1: ['This photo had potential until the {TARGET} showed up uninvited.', 'This photo had potential until the {TARGET} showed up uninvited.'], s2: ['The {SECOND_TARGET} killed whatever chance it had.', 'The {SECOND_TARGET} killed whatever chance it had.'] },

  // ── FAMILY: CONFIDENCE / SELF-OWN (doubling down / posting anyway) ──
  { id: 'CO01', s1: ['Your {TARGET} is proof you doubled down on all of this.', 'Your {TARGET} are proof you doubled down on all of this.'], s2: ['The {SECOND_TARGET} shows you meant every bit of it.', 'The {SECOND_TARGET} show you meant every bit of it.'] },
  { id: 'CO02', s1: ['You saw that {TARGET} in the preview and still hit post.', 'You saw those {TARGET} in the preview and still hit post.'], s2: ['The {SECOND_TARGET} proves you meant it.', 'The {SECOND_TARGET} prove you meant it.'] },
  { id: 'CO03', s1: ['The confidence it took to post this with that {TARGET} is staggering.', 'The confidence it took to post this with those {TARGET} is staggering.'], s2: ['The {SECOND_TARGET} made it genuinely historic.', 'The {SECOND_TARGET} made it genuinely historic.'] },
  { id: 'CO04', s1: ['That {TARGET} says you checked the mirror and chose violence anyway.', 'Those {TARGET} say you checked the mirror and chose violence anyway.'], s2: ['The {SECOND_TARGET} says you meant it personally.', 'The {SECOND_TARGET} say you meant it personally.'] },
  { id: 'CO05', s1: ['Your {TARGET} is what happens when self-awareness takes the day off.', 'Your {TARGET} are what happens when self-awareness takes the day off.'], s2: ['The {SECOND_TARGET} clocked in to make it worse.', 'The {SECOND_TARGET} clocked in to make it worse.'] },

  // ── FAMILY: OBSERVATION (noticing / pointing out / calling attention) ──
  { id: 'OB01', s1: ['Everything about this photo collapses right at the {TARGET}.', 'Everything about this photo collapses right at the {TARGET}.'], s2: ['The {SECOND_TARGET} made the damage impossible to ignore.', 'The {SECOND_TARGET} made the damage impossible to ignore.'] },
  { id: 'OB02', s1: ['The {TARGET} says everything nobody in the room needed confirmed.', 'The {TARGET} say everything nobody in the room needed confirmed.'], s2: ['The {SECOND_TARGET} repeated it louder for everyone.', 'The {SECOND_TARGET} repeated it louder for everyone.'] },
  { id: 'OB03', s1: ['Nobody asked about the {TARGET} but it is doing all the talking.', 'Nobody asked about the {TARGET} but they are doing all the talking.'], s2: ['The {SECOND_TARGET} nodded along in full agreement.', 'The {SECOND_TARGET} nodded along in full agreement.'] },
  { id: 'OB04', s1: ['The first thing anyone notices here is the {TARGET} unfortunately.', 'The first thing anyone notices here are the {TARGET} unfortunately.'], s2: ['The {SECOND_TARGET} makes it impossible to look away.', 'The {SECOND_TARGET} make it impossible to look away.'] },
  { id: 'OB05', s1: ['Your {TARGET} is doing the heavy lifting to make this unforgettable.', 'Your {TARGET} are doing the heavy lifting to make this unforgettable.'], s2: ['The {SECOND_TARGET} volunteered for overtime.', 'The {SECOND_TARGET} volunteered for overtime.'] },

  // ── FAMILY: CONTRAST (expectation vs. reality / before-after logic) ──
  { id: 'CT01', s1: ['Your {TARGET} makes every part of this moment impossible to defend.', 'Your {TARGET} make every part of this moment impossible to defend.'], s2: ['The {SECOND_TARGET} removed the last line of defense.', 'The {SECOND_TARGET} removed the last line of defense.'] },
  { id: 'CT02', s1: ['This could have been a decent photo but the {TARGET} intervened.', 'This could have been a decent photo but the {TARGET} intervened.'], s2: ['The {SECOND_TARGET} finished the job.', 'The {SECOND_TARGET} finished the job.'] },
  { id: 'CT03', s1: ['The rest of the photo tried its best but that {TARGET} refused.', 'The rest of the photo tried its best but those {TARGET} refused.'], s2: ['The {SECOND_TARGET} picked the wrong side entirely.', 'The {SECOND_TARGET} picked the wrong side entirely.'] },
  { id: 'CT04', s1: ['Without that {TARGET} this photo might have had a chance.', 'Without those {TARGET} this photo might have had a chance.'], s2: ['The {SECOND_TARGET} made sure it didn\'t.', 'The {SECOND_TARGET} made sure it didn\'t.'] },
  { id: 'CT05', s1: ['Your {TARGET} turned what could have been fine into a disaster.', 'Your {TARGET} turned what could have been fine into a disaster.'], s2: ['The {SECOND_TARGET} made it even worse.', 'The {SECOND_TARGET} made it even worse.'] },

  // ── FAMILY: PUBLIC EXPOSURE (broadcasting / permanence / receipts) ──
  { id: 'PE01', s1: ['Your {TARGET} turned this into a permanently documented incident.', 'Your {TARGET} turned this into a permanently documented incident.'], s2: ['The {SECOND_TARGET} got it trending immediately.', 'The {SECOND_TARGET} got it trending immediately.'] },
  { id: 'PE02', s1: ['That {TARGET} made this photo everyone\'s problem.', 'Those {TARGET} made this photo everyone\'s problem.'], s2: ['The {SECOND_TARGET} made sure nobody forgets it.', 'The {SECOND_TARGET} made sure nobody forgets it.'] },
  { id: 'PE03', s1: ['Thanks to that {TARGET} this is now permanently searchable online.', 'Thanks to those {TARGET} this is now permanently searchable online.'], s2: ['The {SECOND_TARGET} made it the first result.', 'The {SECOND_TARGET} made it the first result.'] },
  { id: 'PE04', s1: ['Your {TARGET} just guaranteed this photo outlives your dignity.', 'Your {TARGET} just guaranteed this photo outlives your dignity.'], s2: ['The {SECOND_TARGET} is making sure of it personally.', 'The {SECOND_TARGET} are making sure of it personally.'] },
  { id: 'PE05', s1: ['That {TARGET} broadcast everything you were trying to keep quiet.', 'Those {TARGET} broadcast everything you were trying to keep quiet.'], s2: ['The {SECOND_TARGET} turned up the volume on it.', 'The {SECOND_TARGET} turned up the volume on it.'] },
];

// Plural target detection
const NSV_PLURAL_TARGETS = new Set(['glasses', 'shoes', 'eyebrows', 'pants', 'jeans', 'socks']);
function nsvIsPlural(target) {
  return NSV_PLURAL_TARGETS.has(target) || (target.endsWith('s') && !target.endsWith('ss') && target !== 'eness');
}

const NSV_TEMPLATE_FAMILY = {
  // Evidence
  EV01: 'FAMILY_EVIDENCE', EV02: 'FAMILY_EVIDENCE', EV03: 'FAMILY_EVIDENCE', EV04: 'FAMILY_EVIDENCE', EV05: 'FAMILY_EVIDENCE',
  // Social shame
  SS01: 'FAMILY_SOCIAL',   SS02: 'FAMILY_SOCIAL',   SS03: 'FAMILY_SOCIAL',   SS04: 'FAMILY_SOCIAL',   SS05: 'FAMILY_SOCIAL',
  // Verdict
  VD01: 'FAMILY_VERDICT',  VD02: 'FAMILY_VERDICT',  VD03: 'FAMILY_VERDICT',  VD04: 'FAMILY_VERDICT',  VD05: 'FAMILY_VERDICT',
  // Narrative
  NR01: 'FAMILY_NARRATIVE', NR02: 'FAMILY_NARRATIVE', NR03: 'FAMILY_NARRATIVE', NR04: 'FAMILY_NARRATIVE', NR05: 'FAMILY_NARRATIVE',
  // Confidence / self-own
  CO01: 'FAMILY_CONFIDENCE', CO02: 'FAMILY_CONFIDENCE', CO03: 'FAMILY_CONFIDENCE', CO04: 'FAMILY_CONFIDENCE', CO05: 'FAMILY_CONFIDENCE',
  // Observation
  OB01: 'FAMILY_OBSERVATION', OB02: 'FAMILY_OBSERVATION', OB03: 'FAMILY_OBSERVATION', OB04: 'FAMILY_OBSERVATION', OB05: 'FAMILY_OBSERVATION',
  // Contrast
  CT01: 'FAMILY_CONTRAST', CT02: 'FAMILY_CONTRAST', CT03: 'FAMILY_CONTRAST', CT04: 'FAMILY_CONTRAST', CT05: 'FAMILY_CONTRAST',
  // Public exposure
  PE01: 'FAMILY_EXPOSURE', PE02: 'FAMILY_EXPOSURE', PE03: 'FAMILY_EXPOSURE', PE04: 'FAMILY_EXPOSURE', PE05: 'FAMILY_EXPOSURE',
};

// --- Nuclear-SV Slot Pools ---
const NSV_TARGET_POOL = [
  'hairline', 'posture', 'fit', 'smile', 'jawline', 'outfit', 'stance',
  'angle', 'hoodie', 'expression', 'shirt', 'glasses', 'beard', 'eyebrows',
  'crop', 'shoes', 'background', 'hat', 'hair', 'collar', 'squint',
  'head tilt', 'jacket', 'eye contact', 'watch', 'stare', 'grin',
];

// --- Target category helpers for cross-category pairing ---
const NSV_TARGET_CATEGORIES = {
  face: ['grin', 'smile', 'squint', 'eye contact', 'expression', 'beard', 'hairline', 'jawline', 'stare', 'eyebrows', 'hair'],
  clothing: ['shirt', 'jacket', 'hoodie', 'fit', 'collar', 'outfit', 'shoes'],
  pose: ['angle', 'stance', 'head tilt', 'posture', 'crop'],
  background: ['background', 'garage', 'shelves', 'room', 'wall', 'car'],
  accessory: ['glasses', 'watch', 'hat', 'chain'],
};
const _nsvTargetCatMap = {};
for (const [cat, items] of Object.entries(NSV_TARGET_CATEGORIES)) {
  for (const item of items) _nsvTargetCatMap[item] = cat;
}
const NSV_CAT_KEYWORD_FALLBACKS = [
  [/tee|sweater|polo|vest|pants|jeans|socks|shorts|dress|skirt|blazer/i, 'clothing'],
  [/grin|smirk|frown|brow|cheek|chin|forehead|lip|nose|teeth/i, 'face'],
  [/lean|crouch|slouch|sitting|standing/i, 'pose'],
  [/desk|couch|door|window|floor|ceiling|tree|grass|sky|monitor|printer/i, 'background'],
  [/ring|necklace|bracelet|earring|bag|sunglasses|cap|bandana/i, 'accessory'],
];
function getRoastTargetCategory(target = '') {
  const t = String(target).toLowerCase();
  if (_nsvTargetCatMap[t]) return _nsvTargetCatMap[t];
  for (const [re, cat] of NSV_CAT_KEYWORD_FALLBACKS) {
    if (re.test(t)) return cat;
  }
  return 'misc';
}

const NSV_NEAR_DUPES = [
  ['grin', 'smile'], ['outfit', 'shirt'], ['outfit', 'fit'], ['fit', 'shirt'],
  ['background', 'garage'], ['background', 'room'], ['background', 'wall'],
  ['expression', 'stare'], ['expression', 'squint'], ['angle', 'head tilt'],
];
const _nsvDupeSet = new Set();
for (const [a, b] of NSV_NEAR_DUPES) { _nsvDupeSet.add(`${a}|${b}`); _nsvDupeSet.add(`${b}|${a}`); }

const NSV_STRONG_COMBOS = { 'face|clothing': 3, 'clothing|face': 3, 'face|background': 3, 'background|face': 3, 'pose|clothing': 2, 'clothing|pose': 2, 'pose|background': 2, 'background|pose': 2, 'accessory|face': 2, 'face|accessory': 2 };

function targetPairingScore(primary, secondary) {
  const pStr = String(primary).toLowerCase();
  const sStr = String(secondary).toLowerCase();
  if (_nsvDupeSet.has(`${pStr}|${sStr}`)) return -6;
  const pCat = getRoastTargetCategory(pStr);
  const sCat = getRoastTargetCategory(sStr);
  let score = 0;
  if (pCat === sCat) { score -= 4; }
  else { score += 4; score += (NSV_STRONG_COMBOS[`${pCat}|${sCat}`] || 0); }
  return score;
}

const NSV_CRITIQUE_POOL = [
  'you pressed post anyway and meant it',
  'you posted this on purpose for everyone to see',
  'you let this leave the camera roll willingly',
  'you gave this the green light without hesitation',
  'you backed this decision publicly',
  'you went public with this and stood by it',
  'you hit post and never looked back',
  'you uploaded this voluntarily and on purpose',
  'you let this go live in front of everyone',
  'you chose this over every other option',
  'the front camera tried to warn you first',
  'you really thought this was the one to post',
  'you submitted this to the timeline on purpose',
  'you greenlit this for the whole internet',
  'you looked at this and still hit share',
  'nobody asked for this but you delivered anyway',
];

const NSV_SOCIAL_FAIL_POOL = [
  'the group chat evidence folder', 'the group chat screenshot collection',
  'the drafts folder it should have stayed in', 'the archive nobody checks',
  'private stories nobody ever watched', 'the evidence file on your camera roll',
  'a story that deserved to stay unwatched', 'a profile nobody thinks about',
  'a screenshot forwarded to the wrong chat', 'the hidden album with good reason',
  'a draft that should have stayed permanently in drafts', 'a timeline nobody subscribed to',
];

const NSV_SOCIAL_PLACE_POOL = [
  'your drafts folder for a reason', 'the recently deleted album',
  'the camera roll graveyard where it belongs', 'the burner account nobody follows',
  'the archive collecting dust', 'the hidden album nobody was meant to find',
  'the folder specifically labeled do not post', 'the close friends list nobody added you to',
];

const NSV_SOCIAL_CONTEXT_POOL = [
  'public service announcement', 'cautionary tale', 'group chat exhibit',
  'case study in overconfidence', 'documented incident',
  'living warning label', 'front-page mistake', 'timeline disaster',
  'permanent record entry', 'social media crime scene',
];

// NSV_MICDROP_POOL removed — nuclear-sv now uses two-sentence escalation format

// --- Nuclear-SV Micro Templates ---
const NSV_MICRO_TEMPLATES = [
  '{TARGET}. Bold. Unfortunately.',
  'That {TARGET}. A decision. Publicly.',
  'That {TARGET}. Confidently wrong. Forever.',
  '{TARGET}. Committed fully. Regrettably.',
  'The {TARGET}. Documented. Permanently.',
  '{TARGET}. Public record. No appeal.',
  'That {TARGET}. On purpose. Apparently.',
  '{TARGET}. Beyond saving. Noted.',
];

// --- Nuclear-SV S2 payoff pattern families ---
// Groups S2 phrases by their rhetorical move so we can fatigue the pattern, not just the exact string.
// Categories: SEAL (finality), CONFIRM (agreement/proof), RUIN (destruction/collapse),
//   SOCIAL (group/public consequence), WITNESS (testimony/observation), ESCALATE (upgrade/worsen)
const NSV_S2_PATTERN = {
  EV01: 'CONFIRM', EV02: 'SEAL',    EV03: 'CONFIRM', EV04: 'CONFIRM', EV05: 'CONFIRM',
  SS01: 'SOCIAL',  SS02: 'SOCIAL',  SS03: 'SEAL',    SS04: 'RUIN',    SS05: 'SOCIAL',
  VD01: 'SEAL',    VD02: 'SEAL',    VD03: 'RUIN',    VD04: 'SOCIAL',  VD05: 'WITNESS',
  NR01: 'ESCALATE', NR02: 'ESCALATE', NR03: 'SOCIAL', NR04: 'CONFIRM', NR05: 'RUIN',
  CO01: 'CONFIRM', CO02: 'CONFIRM', CO03: 'ESCALATE', CO04: 'CONFIRM', CO05: 'ESCALATE',
  OB01: 'RUIN',    OB02: 'SOCIAL',  OB03: 'CONFIRM', OB04: 'WITNESS', OB05: 'ESCALATE',
  CT01: 'RUIN',    CT02: 'RUIN',    CT03: 'WITNESS', CT04: 'SEAL',    CT05: 'ESCALATE',
  PE01: 'SOCIAL',  PE02: 'SEAL',    PE03: 'SOCIAL',  PE04: 'SEAL',    PE05: 'ESCALATE',
};

// --- Per-client Nuclear-SV state ---
const nsvClientState = new Map();
const nsvStructureHistory = new Map();
const nsvFamilyHistory = new Map();

function getNsvClientState(clientId) {
  if (!nsvClientState.has(clientId)) {
    nsvClientState.set(clientId, { recentRoasts: [], recentTargets: [], recentStructures: [], recentS2Texts: [], recentS2Patterns: [] });
  }
  return nsvClientState.get(clientId);
}

function pushNsvClientRoast(clientId, roast, target, structureId) {
  const st = getNsvClientState(clientId);
  st.recentRoasts.push(roast);
  if (st.recentRoasts.length > 20) st.recentRoasts.shift();
  st.recentTargets.push(target);
  if (st.recentTargets.length > NSV_MAX_RECENT_TARGETS) st.recentTargets.shift();
  st.recentStructures.push(structureId);
  if (st.recentStructures.length > NSV_MAX_RECENT_STRUCTURES) st.recentStructures.shift();
  // Track S2 payoff fatigue
  const s2pat = NSV_S2_PATTERN[structureId] || 'MISC';
  st.recentS2Patterns.push(s2pat);
  if (st.recentS2Patterns.length > 5) st.recentS2Patterns.shift();
  st.recentS2Texts.push(structureId); // track template id as proxy for exact S2 text
  if (st.recentS2Texts.length > 5) st.recentS2Texts.shift();
}

function getNsvFamilyHistory(clientId) {
  return nsvFamilyHistory.get(clientId || 'anon') || [];
}

function pushNsvFamilyHistory(clientId, familyId) {
  const key = clientId || 'anon';
  const arr = nsvFamilyHistory.get(key) || [];
  arr.push(familyId);
  while (arr.length > 3) arr.shift();
  nsvFamilyHistory.set(key, arr);
}

// --- Nuclear-SV skeleton generator ---
function generateNuclearSvSkeletons(tags) {
  const state = getNsvClientState(tags.clientId);
  const recentFamilies = getNsvFamilyHistory(tags.clientId);
  const structHistory = nsvStructureHistory.get(tags.clientId) || [];
  const candidates = [];
  const batchRecentStructures = [...state.recentStructures];
  const batchRecentTargets = [...state.recentTargets];

  // Merge tag-derived targets with static pool (prefer tag targets)
  const tagTargets = [];
  if (tags.selfieAttrs && tags.selfieAttrs.length > 0) {
    tagTargets.push(...tags.selfieAttrs.filter(a => a && a.length > 1));
  }
  const combinedTargets = tagTargets.length > 0
    ? [...new Set([...tagTargets, ...NSV_TARGET_POOL])]
    : NSV_TARGET_POOL;

  // Track structure counts within this batch for variety cap
  const batchStructCounts = {};

  for (let i = 0; i < NSV_LOCAL_CANDIDATES; i++) {
    // Pick structure with avoidance + family fatigue reroll (same as savage)
    let structure = nv2SelectWithAvoidance(
      NSV_STRUCTURES, batchRecentStructures, NV2_MAX_SELECT_TRIES
    );
    let familyId = NSV_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';

    // Structure variety safety: hard cap any single structure to 2 per batch
    if ((batchStructCounts[structure.id] || 0) >= 2) {
      const altStructs = NSV_STRUCTURES.filter(t => (batchStructCounts[t.id] || 0) < 2);
      if (altStructs.length > 0) {
        structure = nv2SelectWithAvoidance(altStructs, batchRecentStructures, NV2_MAX_SELECT_TRIES);
        familyId = NSV_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';
      }
    }

    if (recentFamilies.includes(familyId)) {
      const altTemplates = NSV_STRUCTURES.filter(t => {
        const fam = NSV_TEMPLATE_FAMILY[t.id] || 'FAMILY_MISC';
        return fam !== familyId && (batchStructCounts[t.id] || 0) < 2;
      });
      if (altTemplates.length > 0) {
        structure = nv2SelectWithAvoidance(
          altTemplates, batchRecentStructures, NV2_MAX_SELECT_TRIES
        );
        familyId = NSV_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';
      }
    }
    batchStructCounts[structure.id] = (batchStructCounts[structure.id] || 0) + 1;
    batchRecentStructures.push(structure.id);
    if (batchRecentStructures.length > NSV_MAX_RECENT_STRUCTURES) batchRecentStructures.shift();

    const target = nv2SelectWithAvoidance(
      combinedTargets, batchRecentTargets, NV2_MAX_SELECT_TRIES
    );
    batchRecentTargets.push(typeof target === 'object' ? target.id : target);
    if (batchRecentTargets.length > NSV_MAX_RECENT_TARGETS) batchRecentTargets.shift();

    // Pick SECOND_TARGET: prefer complementary category to TARGET
    const avoidSet = new Set([target, ...batchRecentTargets]);
    const secondPool = combinedTargets.filter(t => t !== target && !avoidSet.has(t));
    let secondTarget;
    if (secondPool.length > 0) {
      // Score each candidate, pick from top tier with randomness
      const scored = secondPool.map(t => ({ t, ps: targetPairingScore(target, t) }));
      scored.sort((a, b) => b.ps - a.ps);
      const bestScore = scored[0].ps;
      const topTier = scored.filter(s => s.ps >= bestScore - 1);
      secondTarget = topTier[Math.floor(Math.random() * topTier.length)].t;
    } else {
      // Fallback: avoidance-based pick
      secondTarget = nv2SelectWithAvoidance(
        combinedTargets, [target, ...batchRecentTargets], NV2_MAX_SELECT_TRIES
      );
      if (secondTarget === target) {
        const altTargets = combinedTargets.filter(t => t !== target);
        if (altTargets.length > 0) secondTarget = altTargets[Math.floor(Math.random() * altTargets.length)];
      }
    }

    // Select singular or plural template variant for each target
    const isPlural = nsvIsPlural(typeof target === 'string' ? target : '');
    const isPlural2 = nsvIsPlural(typeof secondTarget === 'string' ? secondTarget : '');
    const s1Str = Array.isArray(structure.s1) ? structure.s1[isPlural ? 1 : 0] : structure.s1;
    const s2Str = Array.isArray(structure.s2) ? structure.s2[isPlural2 ? 1 : 0] : structure.s2;

    const s1Filled = s1Str.replace('{TARGET}', target);
    const s2Filled = s2Str.replace('{SECOND_TARGET}', secondTarget);
    const skeleton = s1Filled + ' ' + s2Filled;

    const wc = skeleton.split(/\s+/).length;

    // Scoring (nuclear-sv two-sentence escalation: prefer 16–20 total words)
    let wcScore = 0;
    const scoreBreakdown = [];
    if (wc >= 16 && wc <= 20) { wcScore += 14; scoreBreakdown.push('wcSweet+14'); }
    if (wc >= 17 && wc <= 19) { wcScore += 6; scoreBreakdown.push('wcIdeal+6'); }
    if (wc >= 21 && wc <= 22) { wcScore += 4; scoreBreakdown.push('wcOk+4'); }
    if (wc <= 13) { wcScore -= 8; scoreBreakdown.push('wcShort-8'); }
    if (wc >= 14 && wc <= 15) { wcScore -= 3; scoreBreakdown.push('wcBorder-3'); }
    if (wc > 24) { wcScore -= 12; scoreBreakdown.push('wcLong-12'); }

    // Structure fatigue: base penalty if used recently
    if (structHistory.includes(structure.id)) { wcScore -= 8; scoreBreakdown.push('structFatigue-8'); }

    // Consecutive repeat penalty: if last 2 winners used the same structure
    if (structHistory.length >= 2 && structHistory.slice(-2).every(s => s === structure.id)) {
      wcScore -= 18; scoreBreakdown.push('consecutiveRepeat-18');
    }

    // Family fatigue: penalize same family as last winner
    const lastFamily = recentFamilies.length > 0 ? recentFamilies[recentFamilies.length - 1] : null;
    if (lastFamily && lastFamily === familyId) {
      wcScore -= 6; scoreBreakdown.push('familyFatigue-6');
    }

    // Family fatigue: penalize if same family appears in 2 of last 3 winners
    if (recentFamilies.filter(f => f === familyId).length >= 2) {
      wcScore -= 10; scoreBreakdown.push('familySaturate-10');
    }

    // Target fatigue: base penalty
    if (state.recentTargets.includes(target)) { wcScore -= 8; scoreBreakdown.push('targetFatigue-8'); }

    // Target fatigue hardening: last 2 winners used same target
    const targetHist = state.recentTargets;
    if (targetHist.length >= 2 && targetHist.slice(-2).every(t => t === target)) {
      wcScore -= 10; scoreBreakdown.push('targetRepeat-10');
    }

    // Target fatigue hardening: 3+ uses in last 5 winners
    if (targetHist.length >= 3 && targetHist.slice(-5).filter(t => t === target).length >= 3) {
      wcScore -= 18; scoreBreakdown.push('targetSticky-18');
    }

    // --- Nuclear harshness biases ---
    const fullLower = skeleton.toLowerCase();

    // 1) Social-exposure framing anywhere: +14
    const NSV_SOCIAL_EXPOSURE_RE = /\b(group chat|drafts|archive|private stories|evidence folder|screenshot|screenshotted|hidden album|camera roll|timeline|burner account|close friends)\b/i;
    if (NSV_SOCIAL_EXPOSURE_RE.test(fullLower)) { wcScore += 14; scoreBreakdown.push('socialExposure+14'); }

    // 2) Public-consequence critique language: +6
    const NSV_CRITIQUE_EXPOSURE_RE = /\b(pressed post|posted this|hit post|uploaded|went public|backed this publicly|greenlit this in public|leave the camera roll|submitted this to the timeline)\b/i;
    if (NSV_CRITIQUE_EXPOSURE_RE.test(fullLower)) { wcScore += 6; scoreBreakdown.push('critiqueExposure+6'); }

    // 3) Irreversible / public exposure language anywhere: +8
    const NSV_IRREVERSIBLE_RE = /\b(public|forever|documented|record|archive|permanent|permanently|screenshotted|receipts|verdict|evidence)\b/i;
    if (NSV_IRREVERSIBLE_RE.test(fullLower)) { wcScore += 8; scoreBreakdown.push('irreversible+8'); }

    // 4) S2 escalation quality: reward aggressive escalation language: +10
    const s2Lower = s2Filled.toLowerCase();
    const NSV_ESCALATION_RE = /\b(catastrophe|ruined|permanently|trending|first result|finished the job|killed whatever|made it even worse|made sure it didn't|wrecked whatever|made it hopeless|shut.+down|showed up as backup|backed it up|agreed out loud|impossible to ignore|sealed the case|sealed it|confirmed everything|nobody forgets)\b/i;
    if (NSV_ESCALATION_RE.test(s2Lower)) { wcScore += 10; scoreBreakdown.push('s2Escalation+10'); }

    // 5) Anchor-and-payoff bonus: reward S2 that pays off S1's setup (+8)
    // S1 sets up with attempt/observation language, S2 lands with reversal/consequence language
    const s1Lower = s1Filled.toLowerCase();
    const S1_SETUP_RE = /\b(tried|looked|felt|suggested|almost|thought|could have|had potential|had a chance|started to|attempted)\b/;
    const S2_PAYOFF_RE = /\b(ruined|made sure|finished|killed|exposed|noticed|ended|destroyed|buried|ensured|upgraded|sided with|backed up|backed it up|brought.+down|picked the wrong|nodded along|wrecked|made it hopeless|shut.+down|showed up as|agreed out loud|even worse|meant it|sealed the case|sealed it|confirmed everything|nobody forgets|told on you)\b/;
    const s1HasSetup = S1_SETUP_RE.test(s1Lower);
    const s2HasPayoff = S2_PAYOFF_RE.test(s2Lower);
    if (s1HasSetup && s2HasPayoff) {
      wcScore += 8; scoreBreakdown.push('anchorPayoff+8');
    }

    // 6) S2 payoff-phrase fatigue: penalize repeated S2 patterns
    const s2PatternId = NSV_S2_PATTERN[structure.id] || 'MISC';
    // Exact S2 template recently used: -10
    if (state.recentS2Texts && state.recentS2Texts.includes(structure.id)) {
      wcScore -= 10; scoreBreakdown.push('s2ExactFatigue-10');
    }
    // Same S2 pattern family recently: -6
    if (state.recentS2Patterns && state.recentS2Patterns.includes(s2PatternId)) {
      wcScore -= 6; scoreBreakdown.push('s2PatternFatigue-6');
    }

    // 7) Soft narration/legal tone penalty
    const narrPen = nsvNarrationPenalty(skeleton);
    if (narrPen > 0) { wcScore -= narrPen; scoreBreakdown.push(`narration-${narrPen}`); }

    // 8) Weak family downweight (narration/verdict sound too essay-like)
    if (familyId === 'FAMILY_NARRATIVE') { wcScore -= 4; scoreBreakdown.push('weakFamNarr-4'); }
    if (familyId === 'FAMILY_VERDICT') { wcScore -= 2; scoreBreakdown.push('weakFamVerd-2'); }

    candidates.push({ structure, familyId, target, secondTarget, skeleton, wcScore, wordCount: wc, scoreBreakdown });
  }

  return candidates;
}

// --- Main Nuclear-SV generator ---
async function generateNuclearSv({ clientId = 'anon', imageBase64, dynamicTargets = [], selfieTags = null }) {
  const isDev = process.env.NODE_ENV !== 'production';
  const t0 = Date.now();
  let fallbackUsed = false;
  let pickedStructure = null;
  let pickedTarget = null;
  let finalRoast = null;
  let wordCount = 0;
  let skeletonsGenerated = 0;

  // Build selfie attrs list from tags (if available)
  const selfieAttrs = [];
  if (selfieTags && typeof selfieTags === 'object') {
    if (selfieTags.hair && selfieTags.hair !== 'unknown') selfieAttrs.push(selfieTags.hair);
    if (selfieTags.outfit && selfieTags.outfit !== 'unknown') selfieAttrs.push(selfieTags.outfit);
    if (selfieTags.expression && selfieTags.expression !== 'unknown') selfieAttrs.push(selfieTags.expression);
    if (selfieTags.grooming && selfieTags.grooming !== 'unknown') selfieAttrs.push(selfieTags.grooming);
    if (selfieTags.pose && selfieTags.pose !== 'unknown') selfieAttrs.push(selfieTags.pose);
    if (Array.isArray(selfieTags.objects)) selfieAttrs.push(...selfieTags.objects);
  }

  const _tAttrDone = Date.now();

  // 0. Micro-template fast path (10% chance)
  const useMicro = Math.random() < NSV_MICRO_TEMPLATE_RATE;
  if (useMicro) {
    const state = getNsvClientState(clientId);
    const microTarget = nv2SelectWithAvoidance(
      NSV_TARGET_POOL, state.recentTargets, NV2_MAX_SELECT_TRIES
    );
    const capTarget = microTarget.charAt(0).toUpperCase() + microTarget.slice(1);
    let microTpl = NSV_MICRO_TEMPLATES[Math.floor(Math.random() * NSV_MICRO_TEMPLATES.length)];
    let microResult = microTpl.replace(/\{TARGET\}/g, capTarget);
    let microWc = microResult.split(/\s+/).length;

    // Reroll once if too short
    if (microWc < 6) {
      microTpl = NSV_MICRO_TEMPLATES[Math.floor(Math.random() * NSV_MICRO_TEMPLATES.length)];
      microResult = microTpl.replace(/\{TARGET\}/g, capTarget);
      microWc = microResult.split(/\s+/).length;
    }

    if (microWc >= 6 && !nv2HasBannedPatterns(microResult) && isPlaySafe(microResult)) {
      pickedStructure = { id: 'MICRO' };
      pickedTarget = microTarget;
      finalRoast = microResult;
      wordCount = microWc;

      pushNsvClientRoast(clientId, finalRoast, pickedTarget, 'MICRO');
      pushNsvFamilyHistory(clientId, 'FAMILY_MISC');

      const t2 = Date.now();
      console.log(`[nuclear-sv] micro clientId=${clientId} target="${pickedTarget}" words=${wordCount}`);
      console.log(`[nuclear-sv] result="${finalRoast}"`);
      console.log(`[nuclear-sv] totalTime=${t2 - t0}ms`);

      return {
        roast: finalRoast,
        meta: {
          mode: 'nuclear-sv',
          tier: 'nuclear',
          useMicro: true,
          structureId: 'MICRO',
          familyId: 'FAMILY_MISC',
          target: pickedTarget,
          wordCount,
          skeletonsGenerated: 0,
          skeletonScoreTop: null,
          fallbackUsed: false,
          clientId,
          totalTime: t2 - t0,
        },
      };
    } else {
      if (isDev) console.log(`[nuclear-sv] micro failed validation, falling through to candidates`);
    }
  }

  // 1. Generate skeletons locally
  const candidates = generateNuclearSvSkeletons({ clientId, selfieAttrs });
  skeletonsGenerated = candidates.length;

  // 2. Sort: highest wcScore, tie-break by sweet-spot word count (14–18 preferred)
  candidates.sort((a, b) => {
    if (b.wcScore !== a.wcScore) return b.wcScore - a.wcScore;
    const aSweet = (a.wordCount >= 15 && a.wordCount <= 17) ? 1 : 0;
    const bSweet = (b.wordCount >= 15 && b.wordCount <= 17) ? 1 : 0;
    if (bSweet !== aSweet) return bSweet - aSweet;
    const aGood = (a.wordCount >= 14 && a.wordCount <= 18) ? 1 : 0;
    const bGood = (b.wordCount >= 14 && b.wordCount <= 18) ? 1 : 0;
    return bGood - aGood;
  });

  const skeletonScoreTop = candidates.length > 0 ? candidates[0].wcScore : 0;

  if (isDev) {
    const top3 = candidates.slice(0, 3).map((c, i) => `#${i + 1} tmpl=${c.structure.id} fam=${c.familyId} wc=${c.wordCount} score=${c.wcScore} [${(c.scoreBreakdown || []).join(',')}]`);
    console.log(`[nuclear-sv] skeletons=${skeletonsGenerated} top3: ${top3.join(' | ')}`);
  }

  const _tSkeletonDone = Date.now();

  // 3. Polish via single LLM call — try best, then 2nd-best
  async function nsvPolishAndValidate(candidate) {
    let polished = candidate.skeleton;
    if (!process.env.TUNING_MODE) {
      const polishPrompt = `Polish this two-sentence escalation roast so it sounds natural and sharp.\n\nRules:\n- Exactly 2 sentences\n- 14–22 words total preferred\n- Sentence 1: setup/observation about the subject (~9-12 words)\n- Sentence 2: escalation/punchline that hits harder (~5-9 words)\n- Keep the same meaning, both targets, and structure\n\nRoast:\n"${candidate.skeleton}"`;
      try {
        const polishResp = await openai.responses.create({
          model: 'gpt-4o',
          input: [
            { role: 'system', content: 'You are a ruthless roast polisher. Output ONLY the polished roast. No quotes, no explanation, no markdown. Exactly 2 sentences. Sentence 1 is the setup. Sentence 2 escalates and hits harder. 14–22 words total. Cold, sharp, nuclear.' },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: polishPrompt },
                { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
              ],
            },
          ],
          max_output_tokens: 80,
          temperature: 0.85,
          top_p: 0.9,
        });
        if (polishResp.output_text) polished = polishResp.output_text;
      } catch (err) {
        if (isDev) console.log(`[nuclear-sv] polish LLM error: ${err.message}`);
      }
    }

    // Clean + validate using nuclear cleaning pipeline
    let result = nv2SanitizeQuotes(nv2CleanOutput(polished));

    // Nuclear-SV validation: 2 sentences, 14-24 words, S2 4-10 words, target in S1
    if (!result || !result.trim()) return null;
    const sents = result.match(/[^.!?]*[.!?]+/g);
    if (!sents || sents.length !== 2) {
      if (isDev) console.log(`[nuclear-sv] validation fail: sentenceCount=${sents ? sents.length : 0} text="${result}"`);
      return null;
    }
    const wc = result.split(/\s+/).length;
    if (wc < 14 || wc > 24) {
      if (isDev) console.log(`[nuclear-sv] validation fail: wordCount=${wc} text="${result}"`);
      return null;
    }
    const s1 = sents[0].trim();
    if (!s1.toLowerCase().includes(candidate.target.toLowerCase())) {
      if (isDev) console.log(`[nuclear-sv] validation fail: noTargetInS1 target="${candidate.target}" s1="${s1}"`);
      return null;
    }
    const s2 = sents[1].trim();
    const s2Wc = s2.replace(/[.!?]+$/, '').trim().split(/\s+/).length;
    if (s2Wc < 4 || s2Wc > 10) {
      if (isDev) console.log(`[nuclear-sv] validation fail: s2Length=${s2Wc} s2="${s2}"`);
      return null;
    }
    if (!isPlaySafe(result)) {
      if (isDev) console.log(`[nuclear-sv] validation fail: safety text="${result}"`);
      return null;
    }
    if (nv2HasBannedPatterns(result)) {
      if (isDev) console.log(`[nuclear-sv] validation fail: bannedPattern text="${result}"`);
      return null;
    }
    if (nsvHasBannedPhrases(result)) {
      if (isDev) console.log(`[nuclear-sv] validation fail: nsvBannedPhrase text="${result}"`);
      return null;
    }

    return result;
  }

  // Try best candidate
  const best = candidates[0];
  finalRoast = await nsvPolishAndValidate(best);
  if (finalRoast) {
    pickedStructure = best.structure;
    pickedTarget = best.target;
    wordCount = finalRoast.split(/\s+/).length;
  }

  // Fallback: try 2nd-best candidate
  if (!finalRoast && candidates.length > 1) {
    const second = candidates[1];
    if (isDev) console.log(`[nuclear-sv] best failed, trying 2nd: tmpl=${second.structure.id}`);
    finalRoast = await nsvPolishAndValidate(second);
    if (finalRoast) {
      pickedStructure = second.structure;
      pickedTarget = second.target;
      wordCount = finalRoast.split(/\s+/).length;
    }
  }

  // Safe fallback (reuse existing nuclear safe fallbacks)
  if (!finalRoast) {
    fallbackUsed = true;
    finalRoast = NV2_SAFE_FALLBACKS[Math.floor(Math.random() * NV2_SAFE_FALLBACKS.length)];
    wordCount = finalRoast.split(/\s+/).length;
    pickedStructure = { id: 'FALLBACK' };
    pickedTarget = 'fallback';
    if (isDev) console.log('[nuclear-sv] all candidates failed, using safeFallback');
  }

  const t2 = Date.now();

  // Update client state
  pushNsvClientRoast(clientId, finalRoast, pickedTarget, pickedStructure.id);
  const prevHistory = nsvStructureHistory.get(clientId) || [];
  nsvStructureHistory.set(clientId, [pickedStructure.id, ...prevHistory].slice(0, 3));
  pushNsvFamilyHistory(clientId, NSV_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC');

  console.log(`[nuclear-sv] clientId=${clientId} structureId=${pickedStructure.id} target="${pickedTarget}" fallback=${fallbackUsed} words=${wordCount}`);
  console.log(`[nuclear-sv] result="${finalRoast}"`);
  console.log(`[nuclear-sv] skeletonsGenerated=${skeletonsGenerated} skeletonScoreTop=${skeletonScoreTop} totalTime=${t2 - t0}ms`);
  console.log('[nuclear-sv timing]', { attrPrepMs: _tAttrDone - t0, skeletonGenMs: _tSkeletonDone - _tAttrDone, polishMs: t2 - _tSkeletonDone, totalMs: t2 - t0 });

  return {
    roast: finalRoast,
    meta: {
      mode: 'nuclear-sv',
      tier: 'nuclear',
      useMicro: false,
      structureId: pickedStructure.id,
      familyId: NSV_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC',
      target: pickedTarget,
      wordCount,
      skeletonsGenerated,
      skeletonScoreTop,
      fallbackUsed,
      clientId,
      totalTime: t2 - t0,
    },
  };
}

// ============================================================
// MEDIUM V2: Template-based candidate pipeline
// Replaces old 12-call LLM vision pipeline.
// Architecture mirrors Savage V2: local skeleton gen → score → polish → validate.
// Tone: friendly roast, "oof" moment, 1 sentence, 10–16 words.
// ============================================================

// --- Medium V2 Structure Templates (1-sentence, {TARGET} + {CRITIQUE}) ---
// Each template has [singular, plural] variants for grammar correctness.
const MV2_STRUCTURE_TEMPLATES = [
  // ── FAMILY: YOUR (direct address) ──
  { id: 'M01', tpl: ['Your {TARGET} {CRITIQUE} and the photo proves it.', 'Your {TARGET} {CRITIQUE} and the photo proves it.'] },
  { id: 'M04', tpl: ['Your {TARGET} {CRITIQUE} and the camera caught all of it.', 'Your {TARGET} {CRITIQUE} and the camera caught all of it.'] },
  { id: 'M06', tpl: ['Your {TARGET} really {CRITIQUE} in this one.', 'Your {TARGET} really {CRITIQUE} in this one.'] },
  { id: 'M10', tpl: ['Your {TARGET} {CRITIQUE} and you just went with it.', 'Your {TARGET} {CRITIQUE} and you just went with it.'] },
  { id: 'M14', tpl: ['Your {TARGET} told the whole story before the caption could.', 'Your {TARGET} told the whole story before the caption could.'] },
  { id: 'M16', tpl: ['You gave that {TARGET} a lot of responsibility and it shows.', 'You gave those {TARGET} a lot of responsibility and it shows.'] },
  { id: 'M22', tpl: ['You seemed confident about the {TARGET} but the photo less so.', 'You seemed confident about the {TARGET} but the photo less so.'] },

  // ── FAMILY: THAT (pointing out) ──
  { id: 'M02', tpl: ['That {TARGET} {CRITIQUE} but you posted this anyway.', 'Those {TARGET} {CRITIQUE} but you posted this anyway.'] },
  { id: 'M05', tpl: ['That {TARGET} {CRITIQUE} and honestly fair enough.', 'Those {TARGET} {CRITIQUE} and honestly fair enough.'] },
  { id: 'M12', tpl: ['That {TARGET} {CRITIQUE} louder than you probably wanted.', 'Those {TARGET} {CRITIQUE} louder than you probably wanted.'] },
  { id: 'M15', tpl: ['That {TARGET} {CRITIQUE} and the background just watched.', 'Those {TARGET} {CRITIQUE} and the background just watched.'] },
  { id: 'M17', tpl: ['That {TARGET} choice raised more questions than answers.', 'Those {TARGET} raised more questions than answers.'] },
  { id: 'M20', tpl: ['That {TARGET} is making this harder to defend.', 'Those {TARGET} are making this harder to defend.'] },

  // ── FAMILY: THE (observational) ──
  { id: 'M03', tpl: ['The {TARGET} {CRITIQUE} and nobody said anything.', 'The {TARGET} {CRITIQUE} and nobody said anything.'] },
  { id: 'M09', tpl: ['The {TARGET} is doing all the talking in this photo.', 'The {TARGET} are doing all the talking in this photo.'] },
  { id: 'M13', tpl: ['The {TARGET} {CRITIQUE} before anyone even noticed the rest.', 'The {TARGET} {CRITIQUE} before anyone even noticed the rest.'] },
  { id: 'M18', tpl: ['The {TARGET} is not helping your case here.', 'The {TARGET} are not helping your case here.'] },
  { id: 'M21', tpl: ['The {TARGET} is doing a lot of explaining right now.', 'The {TARGET} are doing a lot of explaining right now.'] },
  { id: 'M24', tpl: ['The background is trying to stay neutral but the {TARGET} made it personal.', 'The background is trying to stay neutral but the {TARGET} made it personal.'] },

  // ── FAMILY: INDIRECT (photo/situation as subject) ──
  { id: 'M07', tpl: ['Somebody should have mentioned that {TARGET} before you posted.', 'Somebody should have mentioned those {TARGET} before you posted.'] },
  { id: 'M08', tpl: ['The photo might have worked without the {TARGET} getting involved.', 'The photo might have worked without the {TARGET} getting involved.'] },
  { id: 'M11', tpl: ['Not sure that {TARGET} was the move but here we are.', 'Not sure those {TARGET} were the move but here we are.'] },
  { id: 'M19', tpl: ['Everything else in this photo is fine and then there is the {TARGET}.', 'Everything else in this photo is fine and then there are the {TARGET}.'] },
  { id: 'M23', tpl: ['The rest of the photo had a plan and then the {TARGET} showed up.', 'The rest of the photo had a plan and then the {TARGET} showed up.'] },
];

const MV2_TEMPLATE_FAMILY = {
  M01: 'FAMILY_YOUR', M04: 'FAMILY_YOUR', M06: 'FAMILY_YOUR',
  M10: 'FAMILY_YOUR', M14: 'FAMILY_YOUR', M16: 'FAMILY_YOUR',
  M22: 'FAMILY_YOUR',
  M02: 'FAMILY_THAT', M05: 'FAMILY_THAT', M12: 'FAMILY_THAT',
  M15: 'FAMILY_THAT', M17: 'FAMILY_THAT', M20: 'FAMILY_THAT',
  M03: 'FAMILY_THE', M09: 'FAMILY_THE', M13: 'FAMILY_THE',
  M18: 'FAMILY_THE', M21: 'FAMILY_THE', M24: 'FAMILY_THE',
  M07: 'FAMILY_INDIRECT', M08: 'FAMILY_INDIRECT', M11: 'FAMILY_INDIRECT',
  M19: 'FAMILY_INDIRECT', M23: 'FAMILY_INDIRECT',
};

// --- Medium V2 Critiques (softer than Savage, "oof" not "ouch") ---
const MV2_CRITIQUE_POOL = [
  // effort/confidence
  'is trying its best', 'came in confident', 'went all in',
  'committed fully', 'showed up strong', 'took a swing',
  // observation
  'is pulling focus', 'is working overtime', 'is telling on you',
  'is not blending in', 'is carrying everything', 'is doing the most',
  // consequence
  'made a choice', 'set the tone early', 'changed the whole vibe',
  'shifted the energy immediately', 'got there first',
  // playful judgment
  'is making a strong argument and it might be the wrong one',
  'raised some questions', 'is not going unnoticed',
  'is fighting for attention', 'drew the eye for the wrong reasons',
  'has a lot to answer for', 'is on its own journey',
  'picked a side and it was not yours', 'brought the drama',
  // light contradiction
  'had a plan but the photo did not agree',
  'is confident but the lighting is not',
  'wanted to be the star and almost got there',
];

// --- Medium V2 Targets (shared pool — same visible features as other tiers) ---
const MV2_TARGET_POOL = [
  'hairline', 'posture', 'fit', 'smile', 'jawline', 'outfit', 'stance',
  'angle', 'hoodie', 'expression', 'shirt', 'glasses', 'beard', 'eyebrows',
  'crop', 'shoes', 'background', 'hat', 'hair', 'collar', 'squint',
  'head tilt', 'jacket', 'eye contact', 'watch', 'stare', 'grin',
];

const MV2_SAFE_FALLBACKS = [
  'That angle took some planning and it still did not quite land.',
  'Somebody saw this photo before you posted it and said nothing.',
  'The confidence in this photo is doing a lot of heavy lifting.',
  'Everything in this photo is trying except the one thing that matters.',
  'That outfit made a choice and the rest of the photo just went along with it.',
];

const MV2_LOCAL_CANDIDATES = 10;

// --- Medium V2 client state (per-client fatigue tracking) ---
const mediumClientState = new Map();
const mediumStructureHistory = new Map();
const mediumFamilyHistory = new Map();

function getMediumClientState(clientId) {
  if (!mediumClientState.has(clientId)) {
    mediumClientState.set(clientId, {
      recentRoasts: [],
      recentTargets: [],
      recentStructures: [],
    });
  }
  return mediumClientState.get(clientId);
}

function pushMediumClientRoast(clientId, roast, target, structureId) {
  const st = getMediumClientState(clientId);
  st.recentRoasts.push(roast);
  if (st.recentRoasts.length > 10) st.recentRoasts.shift();
  st.recentTargets.push(target);
  if (st.recentTargets.length > 6) st.recentTargets.shift();
  st.recentStructures.push(structureId);
  if (st.recentStructures.length > 6) st.recentStructures.shift();
}

function getMediumFamilyHistory(clientId) {
  return mediumFamilyHistory.get(clientId) || [];
}

function pushMediumFamilyHistory(clientId, familyId) {
  const hist = getMediumFamilyHistory(clientId);
  hist.push(familyId);
  while (hist.length > 3) hist.shift();
  mediumFamilyHistory.set(clientId, hist);
}

// --- Medium V2 output cleaner (1 sentence, clamp to first sentence) ---
function mv2CleanOutput(text) {
  let out = text.trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
  const sents = out.match(/[^.!?]*[.!?]+/g);
  if (sents && sents.length > 1) {
    out = sents[0].trim();
  }
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

// --- Medium V2 generator ---
async function generateMediumV2({ imageBase64, clientId = 'anon' }) {
  const _t0 = Date.now();
  const isDev = process.env.NODE_ENV !== 'production';
  const state = getMediumClientState(clientId);
  const recentFamilies = getMediumFamilyHistory(clientId);
  const structHistory = mediumStructureHistory.get(clientId) || [];
  let fallbackUsed = false;
  let pickedStructure = null;
  let pickedTarget = null;
  let finalRoast = null;
  let wordCount = 0;

  // 1. Build local skeleton candidates and score them
  const candidates = [];
  const batchRecentStructures = [...state.recentStructures];
  const batchRecentTargets = [...state.recentTargets];

  for (let i = 0; i < MV2_LOCAL_CANDIDATES; i++) {
    // Pick structure with avoidance + family fatigue reroll
    let structure = nv2SelectWithAvoidance(
      MV2_STRUCTURE_TEMPLATES, batchRecentStructures, NV2_MAX_SELECT_TRIES
    );
    let familyId = MV2_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';

    if (recentFamilies.includes(familyId)) {
      const altTemplates = MV2_STRUCTURE_TEMPLATES.filter(t => {
        const fam = MV2_TEMPLATE_FAMILY[t.id] || 'FAMILY_MISC';
        return fam !== familyId;
      });
      if (altTemplates.length > 0) {
        structure = nv2SelectWithAvoidance(
          altTemplates, batchRecentStructures, NV2_MAX_SELECT_TRIES
        );
        familyId = MV2_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';
      }
    }
    batchRecentStructures.push(structure.id);
    if (batchRecentStructures.length > 6) batchRecentStructures.shift();

    const target = nv2SelectWithAvoidance(
      MV2_TARGET_POOL, batchRecentTargets, NV2_MAX_SELECT_TRIES
    );
    batchRecentTargets.push(target);
    if (batchRecentTargets.length > 6) batchRecentTargets.shift();

    const critique = MV2_CRITIQUE_POOL[Math.floor(Math.random() * MV2_CRITIQUE_POOL.length)];

    // Plural detection for grammar agreement
    const mv2Plurals = new Set(['glasses', 'shoes', 'eyebrows', 'pants', 'jeans', 'socks']);
    const isPlural = mv2Plurals.has(target) || (target.endsWith('s') && !target.endsWith('ss'));

    // Plural verb agreement in critique: "is trying" → "are trying"
    let filledCritique = critique;
    if (isPlural) {
      filledCritique = filledCritique
        .replace(/^is /, 'are ')
        .replace(/^was /, 'were ')
        .replace(/^has /, 'have ')
        .replace(/ is not/, ' are not')
        .replace(/ its /, ' their ');
    }

    // Select singular or plural template variant
    const tplStr = Array.isArray(structure.tpl) ? structure.tpl[isPlural ? 1 : 0] : structure.tpl;

    const skeleton = tplStr
      .replace('{TARGET}', target)
      .replace('{CRITIQUE}', filledCritique);

    const wc = skeleton.split(/\s+/).length;

    // Scoring: prefer 10–16 words for a single-sentence Medium roast
    let wcScore = 0;
    const scoreBreakdown = [];
    if (wc >= 10 && wc <= 16) { wcScore += 14; scoreBreakdown.push('wcSweet+14'); }
    if (wc >= 11 && wc <= 14) { wcScore += 6; scoreBreakdown.push('wcIdeal+6'); }
    if (wc <= 8) { wcScore -= 10; scoreBreakdown.push('wcShort-10'); }
    if (wc === 9) { wcScore -= 2; scoreBreakdown.push('wcBorder-2'); }
    if (wc > 18) { wcScore -= 8; scoreBreakdown.push('wcLong-8'); }

    // Structure fatigue
    if (structHistory.includes(structure.id)) { wcScore -= 10; scoreBreakdown.push('structFatigue-10'); }

    // Family fatigue
    const lastFam = recentFamilies.length > 0 ? recentFamilies[recentFamilies.length - 1] : null;
    if (lastFam && lastFam === familyId) { wcScore -= 6; scoreBreakdown.push('familyFatigue-6'); }

    // Target fatigue
    if (state.recentTargets.includes(target)) { wcScore -= 8; scoreBreakdown.push('targetFatigue-8'); }

    candidates.push({ structure, familyId, target, critique: filledCritique, skeleton, wcScore, wordCount: wc, scoreBreakdown });
  }

  // 2. Sort: highest wcScore, tie-break by sweet-spot word count
  candidates.sort((a, b) => {
    if (b.wcScore !== a.wcScore) return b.wcScore - a.wcScore;
    const aSweet = (a.wordCount >= 11 && a.wordCount <= 14) ? 1 : 0;
    const bSweet = (b.wordCount >= 11 && b.wordCount <= 14) ? 1 : 0;
    return bSweet - aSweet;
  });

  if (isDev) {
    const top3 = candidates.slice(0, 3).map((c, i) =>
      `#${i + 1} tmpl=${c.structure.id} fam=${c.familyId} wc=${c.wordCount} score=${c.wcScore} [${(c.scoreBreakdown || []).join(',')}]`
    );
    console.log(`[medium-v2] skeletons=${candidates.length} top3: ${top3.join(' | ')}`);
  }

  const _tPrep = Date.now();

  // 3. Polish best candidate via single LLM call (production only)
  async function mv2PolishAndValidate(candidate) {
    let polished = candidate.skeleton;
    if (!process.env.TUNING_MODE) {
      const polishPrompt = `Rewrite this roast to sound natural and conversational. Keep it friendly but pointed — an "oof" not an insult. Do NOT add new ideas or change the target. Keep it as 1 sentence. 10–16 words preferred. Output ONLY the rewritten roast.\n\nRoast: "${candidate.skeleton}"`;
      try {
        const polishResp = await openai.responses.create({
          model: 'gpt-4o',
          input: [
            { role: 'system', content: 'You are a friendly roast rewriter. Output ONLY the rewritten roast. No quotes, no explanation. 1 sentence only. Conversational, not cruel. 10–16 words. NEVER mention not knowing who someone is. NEVER use assistant disclaimers. Roast only visible details.' },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: polishPrompt },
                { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
              ],
            },
          ],
          max_output_tokens: 60,
          temperature: 0.85,
          top_p: 0.9,
        });
        if (polishResp.output_text) polished = polishResp.output_text;
      } catch (err) {
        if (isDev) console.log(`[medium-v2] polish error: ${err.message}`);
      }
    }

    let result = mv2CleanOutput(polished);
    if (!result || result.length < 10) return null;
    if (nv2HasBannedPatterns(result)) {
      if (isDev) console.log(`[medium-v2] validation fail: bannedPattern text="${result}"`);
      return null;
    }
    if (isIdentityUncertainty(result) || isRefusalLike(result)) {
      if (isDev) console.log(`[medium-v2] identity-uncertainty/refusal rejected: "${result.slice(0, 60)}"`);
      return null;
    }
    if (!isPlaySafe(result)) {
      if (isDev) console.log(`[medium-v2] validation fail: safety text="${result}"`);
      return null;
    }
    return result;
  }

  // Try best candidate — skip polish if skeleton already passes quality gate
  const best = candidates[0];
  if (best && canSkipPolish(best.skeleton, 'medium')) {
    finalRoast = mv2CleanOutput(best.skeleton);
    pickedStructure = best.structure;
    pickedTarget = best.target;
    wordCount = finalRoast.split(/\s+/).length;
    if (isDev) console.log(`[medium-v2] polishSkipped=true skeleton="${finalRoast.slice(0, 60)}"`);
  }

  if (!finalRoast) {
    finalRoast = await mv2PolishAndValidate(best);
    if (finalRoast) {
      pickedStructure = best.structure;
      pickedTarget = best.target;
      wordCount = finalRoast.split(/\s+/).length;
    }
  }

  // Fallback: try 2nd-best candidate
  if (!finalRoast && candidates.length > 1) {
    const second = candidates[1];
    if (isDev) console.log(`[medium-v2] best failed, trying 2nd: tmpl=${second.structure.id}`);
    if (canSkipPolish(second.skeleton, 'medium')) {
      finalRoast = mv2CleanOutput(second.skeleton);
      pickedStructure = second.structure;
      pickedTarget = second.target;
      wordCount = finalRoast.split(/\s+/).length;
      if (isDev) console.log(`[medium-v2] polishSkipped=true (2nd) skeleton="${finalRoast.slice(0, 60)}"`);
    } else {
      finalRoast = await mv2PolishAndValidate(second);
      if (finalRoast) {
        pickedStructure = second.structure;
        pickedTarget = second.target;
        wordCount = finalRoast.split(/\s+/).length;
      }
    }
  }

  // Safe fallback
  if (!finalRoast) {
    fallbackUsed = true;
    finalRoast = MV2_SAFE_FALLBACKS[Math.floor(Math.random() * MV2_SAFE_FALLBACKS.length)];
    wordCount = finalRoast.split(/\s+/).length;
    pickedStructure = { id: 'FALLBACK' };
    pickedTarget = 'fallback';
    if (isDev) console.log('[medium-v2] all candidates failed, using safeFallback');
  }

  // Update client state
  pushMediumClientRoast(clientId, finalRoast, pickedTarget, pickedStructure.id);
  const prevHistory = mediumStructureHistory.get(clientId) || [];
  mediumStructureHistory.set(clientId, [pickedStructure.id, ...prevHistory].slice(0, 3));
  pushMediumFamilyHistory(clientId, MV2_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC');
  pushRecentMedium(finalRoast);

  if (isDev) {
    console.log(`[medium-v2] clientId=${clientId} structureId=${pickedStructure.id} target="${pickedTarget}" fallback=${fallbackUsed} words=${wordCount}`);
    console.log(`[medium-v2] result="${finalRoast}"`);
  }

  const winnerScore = (!fallbackUsed && best) ? best.wcScore : 0;
  const _tDone = Date.now();
  console.log('[medium-v2 timing]', { prepMs: _tPrep - _t0, polishMs: _tDone - _tPrep, totalMs: _tDone - _t0 });

  return {
    roast: finalRoast,
    meta: {
      tier: 'medium',
      structureId: pickedStructure.id,
      familyId: MV2_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC',
      target: pickedTarget,
      wordCount,
      candidatesCount: MV2_LOCAL_CANDIDATES,
      winnerScore,
      fallbackUsed,
    },
  };
}

// --- Mild V2 client state (per-client fatigue tracking) ---
const mildClientState = new Map();
const mildStructureHistory = new Map();
const mildFamilyHistory = new Map();

function getMildClientState(clientId) {
  if (!mildClientState.has(clientId)) {
    mildClientState.set(clientId, {
      recentRoasts: [],
      recentTargets: [],
      recentStructures: [],
    });
  }
  return mildClientState.get(clientId);
}

function pushMildClientRoast(clientId, roast, target, structureId) {
  const st = getMildClientState(clientId);
  st.recentRoasts.push(roast);
  if (st.recentRoasts.length > 10) st.recentRoasts.shift();
  st.recentTargets.push(target);
  if (st.recentTargets.length > 6) st.recentTargets.shift();
  st.recentStructures.push(structureId);
  if (st.recentStructures.length > 6) st.recentStructures.shift();
}

function getMildFamilyHistory(clientId) {
  return mildFamilyHistory.get(clientId) || [];
}

function pushMildFamilyHistory(clientId, familyId) {
  const hist = getMildFamilyHistory(clientId);
  hist.push(familyId);
  while (hist.length > 3) hist.shift();
  mildFamilyHistory.set(clientId, hist);
}

// --- Mild V2 output cleaner (1 sentence, clamp to first sentence) ---
function mlv2CleanOutput(text) {
  let out = text.trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
  const sents = out.match(/[^.!?]*[.!?]+/g);
  if (sents && sents.length > 1) {
    out = sents[0].trim();
  }
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

// --- Mild V2 generator (template-based, mirrors Medium architecture) ---
async function generateMildV2({ imageBase64, clientId = 'anon' }) {
  const _t0 = Date.now();
  const isDev = process.env.NODE_ENV !== 'production';
  const state = getMildClientState(clientId);
  const recentFamilies = getMildFamilyHistory(clientId);
  const structHistory = mildStructureHistory.get(clientId) || [];
  let fallbackUsed = false;
  let pickedStructure = null;
  let pickedTarget = null;
  let finalRoast = null;
  let wordCount = 0;

  // 1. Build local skeleton candidates and score them
  const candidates = [];
  const batchRecentStructures = [...state.recentStructures];
  const batchRecentTargets = [...state.recentTargets];

  for (let i = 0; i < MLV2_LOCAL_CANDIDATES; i++) {
    // Pick structure with avoidance + family fatigue reroll
    let structure = nv2SelectWithAvoidance(
      MLV2_STRUCTURE_TEMPLATES, batchRecentStructures, NV2_MAX_SELECT_TRIES
    );
    let familyId = MLV2_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';

    if (recentFamilies.includes(familyId)) {
      const altTemplates = MLV2_STRUCTURE_TEMPLATES.filter(t => {
        const fam = MLV2_TEMPLATE_FAMILY[t.id] || 'FAMILY_MISC';
        return fam !== familyId;
      });
      if (altTemplates.length > 0) {
        structure = nv2SelectWithAvoidance(
          altTemplates, batchRecentStructures, NV2_MAX_SELECT_TRIES
        );
        familyId = MLV2_TEMPLATE_FAMILY[structure.id] || 'FAMILY_MISC';
      }
    }
    batchRecentStructures.push(structure.id);
    if (batchRecentStructures.length > 6) batchRecentStructures.shift();

    const target = nv2SelectWithAvoidance(
      MLV2_TARGET_POOL, batchRecentTargets, NV2_MAX_SELECT_TRIES
    );
    batchRecentTargets.push(target);
    if (batchRecentTargets.length > 6) batchRecentTargets.shift();

    const observation = MLV2_OBSERVATION_POOL[Math.floor(Math.random() * MLV2_OBSERVATION_POOL.length)];

    // Plural detection for grammar agreement
    const mlv2Plurals = new Set(['glasses', 'eyebrows']);
    const isPlural = mlv2Plurals.has(target) || (target.endsWith('s') && !target.endsWith('ss'));

    // Plural verb agreement in observation: "is trying" → "are trying"
    let filledObs = observation;
    if (isPlural) {
      filledObs = filledObs
        .replace(/^is /, 'are ')
        .replace(/^was /, 'were ')
        .replace(/^has /, 'have ')
        .replace(/ is not/, ' are not')
        .replace(/ its /, ' their ');
    }

    // Select singular or plural template variant
    const tplStr = Array.isArray(structure.tpl) ? structure.tpl[isPlural ? 1 : 0] : structure.tpl;

    const skeleton = tplStr
      .replace('{TARGET}', target)
      .replace('{OBSERVATION}', filledObs);

    const wc = skeleton.split(/\s+/).length;

    // Scoring: prefer 9–11 words for a single-sentence Mild roast
    let wcScore = 0;
    const scoreBreakdown = [];
    if (wc >= 9 && wc <= 11) { wcScore += 16; scoreBreakdown.push('wcSweet+16'); }
    if (wc >= 8 && wc <= 13) { wcScore += 6; scoreBreakdown.push('wcOk+6'); }
    if (wc <= 6) { wcScore -= 10; scoreBreakdown.push('wcShort-10'); }
    if (wc > 13) { wcScore -= 8; scoreBreakdown.push('wcLong-8'); }

    // Structure fatigue
    if (structHistory.includes(structure.id)) { wcScore -= 10; scoreBreakdown.push('structFatigue-10'); }

    // Family fatigue
    const lastFam = recentFamilies.length > 0 ? recentFamilies[recentFamilies.length - 1] : null;
    if (lastFam && lastFam === familyId) { wcScore -= 6; scoreBreakdown.push('familyFatigue-6'); }

    // Target fatigue
    if (state.recentTargets.includes(target)) { wcScore -= 8; scoreBreakdown.push('targetFatigue-8'); }

    candidates.push({ structure, familyId, target, observation: filledObs, skeleton, wcScore, wordCount: wc, scoreBreakdown });
  }

  // 2. Sort: highest wcScore, tie-break by sweet-spot word count
  candidates.sort((a, b) => {
    if (b.wcScore !== a.wcScore) return b.wcScore - a.wcScore;
    const aSweet = (a.wordCount >= 9 && a.wordCount <= 11) ? 1 : 0;
    const bSweet = (b.wordCount >= 9 && b.wordCount <= 11) ? 1 : 0;
    return bSweet - aSweet;
  });

  if (isDev) {
    const top3 = candidates.slice(0, 3).map((c, i) =>
      `#${i + 1} tmpl=${c.structure.id} fam=${c.familyId} wc=${c.wordCount} score=${c.wcScore} [${(c.scoreBreakdown || []).join(',')}]`
    );
    console.log(`[mild-v2] skeletons=${candidates.length} top3: ${top3.join(' | ')}`);
  }

  const _tPrep = Date.now();

  // 3. Polish best candidate via single LLM call (production only)
  async function mlv2PolishAndValidate(candidate) {
    let polished = candidate.skeleton;
    if (!process.env.TUNING_MODE) {
      const polishPrompt = `Rewrite this roast to sound natural and conversational. Keep it gentle and playful — a "haha okay fair" not an insult. Do NOT add new ideas or change the target. Keep it as 1 sentence. 9–11 words preferred, max 13. Output ONLY the rewritten roast.\n\nRoast: "${candidate.skeleton}"`;
      try {
        const polishResp = await openai.responses.create({
          model: 'gpt-4o',
          input: [
            { role: 'system', content: 'You are a gentle roast rewriter. Output ONLY the rewritten roast. No quotes, no explanation. 1 sentence only. Playful and light, never harsh. 9–11 words preferred. NEVER mention not knowing who someone is. NEVER use assistant disclaimers. Roast only visible details.' },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: polishPrompt },
                { type: 'input_image', image_url: nv2ToDataUrl(imageBase64) },
              ],
            },
          ],
          max_output_tokens: 50,
          temperature: 0.8,
          top_p: 0.9,
        });
        if (polishResp.output_text) polished = polishResp.output_text;
      } catch (err) {
        if (isDev) console.log(`[mild-v2] polish error: ${err.message}`);
      }
    }

    let result = mlv2CleanOutput(polished);
    if (!result || result.length < 10) return null;
    if (nv2HasBannedPatterns(result)) {
      if (isDev) console.log(`[mild-v2] validation fail: bannedPattern text="${result}"`);
      return null;
    }
    if (isIdentityUncertainty(result) || isRefusalLike(result)) {
      if (isDev) console.log(`[mild-v2] identity-uncertainty/refusal rejected: "${result.slice(0, 60)}"`);
      return null;
    }
    if (!isPlaySafe(result)) {
      if (isDev) console.log(`[mild-v2] validation fail: safety text="${result}"`);
      return null;
    }
    return result;
  }

  // Try best candidate — skip polish if skeleton already passes quality gate
  const best = candidates[0];
  if (best && canSkipPolish(best.skeleton, 'mild')) {
    finalRoast = mlv2CleanOutput(best.skeleton);
    pickedStructure = best.structure;
    pickedTarget = best.target;
    wordCount = finalRoast.split(/\s+/).length;
    if (isDev) console.log(`[mild-v2] polishSkipped=true skeleton="${finalRoast.slice(0, 60)}"`);
  }

  if (!finalRoast) {
    finalRoast = await mlv2PolishAndValidate(best);
    if (finalRoast) {
      pickedStructure = best.structure;
      pickedTarget = best.target;
      wordCount = finalRoast.split(/\s+/).length;
    }
  }

  // Fallback: try 2nd-best candidate
  if (!finalRoast && candidates.length > 1) {
    const second = candidates[1];
    if (isDev) console.log(`[mild-v2] best failed, trying 2nd: tmpl=${second.structure.id}`);
    if (canSkipPolish(second.skeleton, 'mild')) {
      finalRoast = mlv2CleanOutput(second.skeleton);
      pickedStructure = second.structure;
      pickedTarget = second.target;
      wordCount = finalRoast.split(/\s+/).length;
      if (isDev) console.log(`[mild-v2] polishSkipped=true (2nd) skeleton="${finalRoast.slice(0, 60)}"`);
    } else {
      finalRoast = await mlv2PolishAndValidate(second);
      if (finalRoast) {
        pickedStructure = second.structure;
        pickedTarget = second.target;
        wordCount = finalRoast.split(/\s+/).length;
      }
    }
  }

  // Safe fallback
  if (!finalRoast) {
    fallbackUsed = true;
    finalRoast = MLV2_SAFE_FALLBACKS[Math.floor(Math.random() * MLV2_SAFE_FALLBACKS.length)];
    wordCount = finalRoast.split(/\s+/).length;
    pickedStructure = { id: 'FALLBACK' };
    pickedTarget = 'fallback';
    if (isDev) console.log('[mild-v2] all candidates failed, using safeFallback');
  }

  // Update client state
  pushMildClientRoast(clientId, finalRoast, pickedTarget, pickedStructure.id);
  const prevHistory = mildStructureHistory.get(clientId) || [];
  mildStructureHistory.set(clientId, [pickedStructure.id, ...prevHistory].slice(0, 3));
  pushMildFamilyHistory(clientId, MLV2_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC');
  pushRecentMild(finalRoast);

  if (isDev) {
    console.log(`[mild-v2] clientId=${clientId} structureId=${pickedStructure.id} target="${pickedTarget}" fallback=${fallbackUsed} words=${wordCount}`);
    console.log(`[mild-v2] result="${finalRoast}"`);
  }

  const winnerScore = (!fallbackUsed && best) ? best.wcScore : 0;
  const _tDone = Date.now();
  console.log('[mild-v2 timing]', { prepMs: _tPrep - _t0, polishMs: _tDone - _tPrep, totalMs: _tDone - _t0 });

  return {
    roast: finalRoast,
    meta: {
      tier: 'mild',
      structureId: pickedStructure.id,
      familyId: MLV2_TEMPLATE_FAMILY[pickedStructure.id] || 'FAMILY_MISC',
      target: pickedTarget,
      wordCount,
      candidatesCount: MLV2_LOCAL_CANDIDATES,
      winnerScore,
      fallbackUsed,
    },
  };
}

// Normalize bare base64 to a data URL so generators receive the same format as the tuning harness
function ensureDataUrl(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== 'string') return imageBase64;
  if (imageBase64.startsWith('data:image/')) return imageBase64;
  return `data:image/jpeg;base64,${imageBase64}`;
}

app.post('/api/roast', async (req, res) => {
  try {
    const started = Date.now();
    const { imageBase64, level = 'medium', clientId, useSavageV2, sceneHints, safeTags } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    // Guard: reject oversized base64 before sending to OpenAI
    if (imageBase64.length > 18_000_000) {
      return jsonError(res, 413, 'payload_too_large', 'Image is too large. Please use a smaller image.');
    }

    const normalizedImageBase64 = ensureDataUrl(imageBase64);
    const tierName = Object.hasOwn(INTENSITY_CONFIG, level) ? level : 'medium';
    const config = INTENSITY_CONFIG[tierName];
    const isDev = process.env.NODE_ENV !== 'production';
    const resolvedClientId = (typeof clientId === 'string' && clientId.trim()) ? clientId.trim() : 'anon';

    // --- Modern V2 engine routing (all tiers) ---

    if (tierName === 'mild') {
      const { roast, meta } = await generateMildV2({ imageBase64: normalizedImageBase64, clientId: resolvedClientId });
      if (isDev) {
        console.log(`[mild-v2] clientId=${resolvedClientId} struct=${meta.structureId} target="${meta.target}" fallback=${meta.fallbackUsed} words=${meta.wordCount} score=${meta.winnerScore}`);
        console.log(`[mild-v2] result="${roast}"`);
      }
      console.log('[api/roast] modern early route', { level: tierName, ms: Date.now() - started });
      return res.json({ roasts: filterRefusals([roast], tierName) });
    }

    if (tierName === 'medium') {
      const { roast, meta } = await generateMediumV2({ imageBase64: normalizedImageBase64, clientId: resolvedClientId });
      if (isDev) {
        console.log(`[medium-v2] clientId=${resolvedClientId} struct=${meta.structureId} target="${meta.target}" fallback=${meta.fallbackUsed} words=${meta.wordCount} score=${meta.winnerScore}`);
        console.log(`[medium-v2] result="${roast}"`);
      }
      console.log('[api/roast] modern early route', { level: tierName, ms: Date.now() - started });
      return res.json({ roasts: filterRefusals([roast], tierName) });
    }

    if (tierName === 'savage') {
      const { roast, meta } = await generateSavageV2({ clientId: resolvedClientId, imageBase64: normalizedImageBase64 });
      pushRecentSavage(roast);
      if (isDev) {
        console.log(`[savage-v2] served clientId=${meta.clientId} struct=${meta.pickedStructureId} target="${meta.pickedTarget}" attempts=${meta.attempts} fallback=${meta.fallbackUsed} words=${meta.wordCount}`);
      }
      console.log('[api/roast] modern early route', { level: tierName, ms: Date.now() - started });
      return res.json({ roasts: filterRefusals([roast], tierName) });
    }

    if (tierName === 'nuclear') {
      // Nuclear-SV (preferred) or Nuclear-V2 based on NUCLEAR_ENGINE env
      if (process.env.NUCLEAR_ENGINE === 'sv') {
        const _tTagStart = Date.now();
        let nsvSelfieTags = null;
        let tagsSource = 'none';

        if (safeTags && typeof safeTags === 'object' && !Array.isArray(safeTags)) {
          nsvSelfieTags = safeTags;
          tagsSource = 'request';
        } else if (process.env.NUCLEAR_SV_SKIP_TAGS === '1') {
          nsvSelfieTags = null;
          tagsSource = 'skipped';
        } else {
          nsvSelfieTags = await extractSafeSelfieTags(normalizedImageBase64);
          tagsSource = 'extracted';
        }

        const _tTagEnd = Date.now();
        console.log('[nuclear-sv route]', { tagsSource, tagMs: _tTagEnd - _tTagStart });
        if (isDev) console.log(`[nuclear-sv] clientId=${resolvedClientId}`);

        const { roast, meta } = await generateNuclearSv({ clientId: resolvedClientId, imageBase64: normalizedImageBase64, selfieTags: nsvSelfieTags });
        if (isDev) {
          console.log(`[nuclear-sv] served clientId=${meta.clientId} struct=${meta.structureId} target="${meta.target}" fallback=${meta.fallbackUsed} words=${meta.wordCount} skeletonsGenerated=${meta.skeletonsGenerated} skeletonScoreTop=${meta.skeletonScoreTop} totalTime=${meta.totalTime}ms`);
        }
        console.log('[api/roast] modern early route', { level: tierName, engine: 'sv', ms: Date.now() - started });
        return res.json({ roasts: filterRefusals([roast], tierName), meta: { mode: 'nuclear-sv' }, safeTags: nsvSelfieTags || null });
      }

      // Nuclear V2 fallback
      if (isDev) console.log(`[nuclear-v2] clientId=${resolvedClientId}`);

      const _tNv2TagStart = Date.now();
      let dynamicTargets = [];
      if (Array.isArray(sceneHints) && sceneHints.length > 0) {
        dynamicTargets = nv2FilterSceneNouns(sceneHints);
        if (isDev) console.log(`[nuclear-v2] using ${dynamicTargets.length} client-provided sceneHints (filtered)`);
      } else {
        dynamicTargets = await nv2ExtractSceneNouns(normalizedImageBase64);
        if (isDev) console.log(`[nuclear-v2] scene-tagger extracted ${dynamicTargets.length} targets: [${dynamicTargets.slice(0, 6).join(', ')}]`);
      }
      const _tNv2SceneDone = Date.now();

      let selfieTags = null;
      if (safeTags && typeof safeTags === 'object' && !Array.isArray(safeTags)) {
        selfieTags = safeTags;
        if (isDev) console.log(`[nuclear-v2] using client-provided safeTags`);
      } else {
        selfieTags = await extractSafeSelfieTags(normalizedImageBase64);
        if (isDev) console.log(`[nuclear-v2] selfie-tags extracted: objects=${selfieTags.objects.length} angle=${selfieTags.angle} lighting=${selfieTags.lighting} framing=${selfieTags.framing} setting=${selfieTags.setting} pose=${selfieTags.pose} hair=${selfieTags.hair} outfit=${selfieTags.outfit} expression=${selfieTags.expression} grooming=${selfieTags.grooming} bg_vibe=${selfieTags.bg_vibe} face_visible=${selfieTags.face_visible} face_obstructed=${selfieTags.face_obstructed} face_visibility=${selfieTags.face_visibility} face_confidence=${selfieTags.face_confidence} hair_confidence=${selfieTags.hair_confidence} person_present=${selfieTags.person_present} hair_visible=${selfieTags.hair_visible} outfit_visible=${selfieTags.outfit_visible}`);
      }

      const _tNv2TagDone = Date.now();
      console.log('[nuclear-v2 route timing]', { sceneMs: _tNv2SceneDone - _tNv2TagStart, selfieTagMs: _tNv2TagDone - _tNv2SceneDone, totalTagMs: _tNv2TagDone - _tNv2TagStart });

      const { roast, meta } = await generateNuclearV2({ clientId: resolvedClientId, imageBase64: normalizedImageBase64, dynamicTargets, selfieTags });
      if (isDev) {
        console.log(`[nuclear-v2] served clientId=${meta.clientId} candidates=${meta.candidateCount} valid=${meta.validCount} winnerScore=${meta.winnerScore} sceneRaw=${meta.sceneTargetCount} sceneFiltered=${meta.sceneTargetsAfterFilter} tagObjects=${meta.tagObjectCount} tagModifiers=[${meta.tagModifiers.join(',')}] selfieAttrs=[${meta.selfieAttrs.join(',')}] fallback=${meta.fallbackUsed} words=${meta.wordCount}`);
      }
      console.log('[api/roast] modern early route', { level: tierName, engine: 'v2', ms: Date.now() - started });
      return res.json({ roasts: filterRefusals([roast], tierName) });
    }

    // --- Legacy fallback (should not be reached for known tiers) ---
    console.log('[api/roast] legacy path reached', { level, tierName });

    const avoidThemes = recentThemes.length > 0 ? recentThemes.join(', ') : 'none yet';
    const prompt = buildPrompt(config, tierName, avoidThemes);
    const isHighTier = tierName === 'savage' || tierName === 'nuclear';

    const savageAvoidBlock = tierName === 'savage' && recentSavageRoasts.length > 0
      ? `\n\nDO NOT REPEAT OR PARAPHRASE ANY OF THESE:\n${recentSavageRoasts.slice(-25).map(r => `- ${r}`).join('\n')}`
      : '';

    const nuclearAvoidBlock = tierName === 'nuclear' && recentNuclearRoasts.length > 0
      ? `\n\nDO NOT REPEAT OR PARAPHRASE ANY OF THESE:\n${recentNuclearRoasts.slice(-20).map(r => `- ${r}`).join('\n')}`
      : '';

    // Savage style diversity: randomly pick a structural style hint each request
    const SAVAGE_STYLE_HINTS = [
      'Style: cold verdict — state what went wrong as fact, then drop the micdrop.',
      'Style: exposure — call out the gap between intent and result, then close it.',
      'Style: social read — describe how this reads to others, then shut it down.',
    ];
    const savageStyleHint = tierName === 'savage'
      ? ' ' + SAVAGE_STYLE_HINTS[Math.floor(Math.random() * SAVAGE_STYLE_HINTS.length)]
      : '';

    // Nuclear exposure verb bias disabled — no preferredExposure rotation
    const requiredExposure = null;

    // Nuclear style diversity: randomly pick a flavor each request
    const NUCLEAR_STYLE_HINTS = [
      'Angle: character assassination via competence — they are bad at what they think they are good at.',
      'Angle: social awkwardness exposure — describe how others perceive them in a room.',
      'Angle: try-hard / overcompensation exposure — the effort is visible and it makes it worse.',
      'Angle: status fraud / fake confidence — everything about them is borrowed or performed.',
      'Angle: grooming-to-personality pipeline — what the styling choices reveal about their judgment.',
      'Angle: short clauses, no metaphors — blunt staccato hits, pure declarative sentences.',
      'Angle: unflattering specificity — fixate on one visible detail and extrapolate a whole personality failure.',
      'Angle: the quiet cringe — describe the secondhand embarrassment of looking at this photo.',
      'Angle: no crutch verbs — avoid "screams", "gives off", "radiates", "exudes". Use blunt declarations instead.',
      'Angle: no diagnostic vibe — no therapy words, no "warning sign", no clinical framing. Just personal hits.',
    ];
    const nuclearStyleHint = tierName === 'nuclear'
      ? ' ' + NUCLEAR_STYLE_HINTS[Math.floor(Math.random() * NUCLEAR_STYLE_HINTS.length)]
      : '';

    // Nuclear lane rotation: pick a topical anchor that avoids last 4
    const nuclearLane = tierName === 'nuclear' ? pickNuclearLane() : null;
    let nuclearLaneBlock = '';
    if (nuclearLane) {
      nuclearLaneBlock = ` LANE=${nuclearLane}. Anchor primarily around this lane. Avoid focusing primarily on clothing unless lane is outfit. Avoid repeating themes from previous roasts.`;
      // Universal screams ban for ALL lanes
      nuclearLaneBlock += ` Never use the words: scream, screams, screaming. Use alternatives like: reads as, looks like, lands as, comes off as, registers as, feels like, gives, signals.`;
      // Lane-specific steering
      if (nuclearLane === 'camera angle') {
        nuclearLaneBlock += ` Use alternatives: "looks", "reads", "lands as", "comes off", "registers as", "plays like".`;
      } else if (nuclearLane === 'grooming') {
        nuclearLaneBlock += ` Preferred verbs: reads as, looks like, comes off as.`;
      } else if (nuclearLane === 'setting/background') {
        nuclearLaneBlock += ` Preferred verbs: registers as, signals, feels like. Avoid "neglect"/"depressing". Use: NPC backdrop, default environment, side-quest energy, placeholder scene.`;
      } else if (nuclearLane === 'posture') {
        nuclearLaneBlock += ` Preferred verbs: lands as, reads as, comes off as. Avoid "lost cause", "giving up", "defeated". Use: slack, uncommitted, half-sent, borrowed confidence, limp presence, unconvincing.`;
      } else if (nuclearLane === 'expression') {
        nuclearLaneBlock += ` Preferred verbs: reads as, looks like, registers as.`;
      } else if (nuclearLane === 'outfit') {
        nuclearLaneBlock += ` Do not repeat "deep"/"profound" across multiple sentences; use at most once.`;
      }
    }

    const systemMsg = tierName === 'savage'
      ? `You are a roast comedian. EXACTLY 2 sentences. 11–22 words total. Sentence 1: cold verdict referencing ONE visible detail, using "you" statements. Sentence 2: short decisive closer (1–4 words), ending with a period. NOT a question, NOT a command, NOT advice. Must NOT contain "you" or "your". Should be specific to what's visible in the photo — think verdict fragments like "Hard pass." or "Not convincing." but write your own. No emojis. No quote marks of any kind. NEVER use the phrase "you look like" or "looks like" — these are banned. Do not use "screams" or "your expression". Prefer verdict-framing starters for sentence 1: "You posted this like …", "You framed this like …", "You aimed for …", "This isn't …", "Not a flex …", "You called this …". No existential despair.${savageStyleHint} Respond with ONLY valid JSON. No markdown. No code fences.${savageAvoidBlock}`
      : tierName === 'nuclear'
        ? `You are a ruthless roast comedian specializing in social humiliation, not descriptive insults. The goal is exposing delusion in front of an audience. Write exactly 1–2 sentences total. No third sentence. No colon-style closer. Sentence 1: visual/trait observation — anchor on something visible (angle/hair/hoodie/posture, max 12 words). Sentence 2 (if present): social verdict — reference audience perception (anyone/people/everyone/nobody/they/buying it/fooled) OR a room-reaction phrase (the room/the whole room/anyone watching). Sentence 2 MUST NOT start with "You". BANNED WORDS: imagine, expect, insist, assume, pretend. BANNED PHRASES: "does you no favors", "isn't doing you any favors", "your expression", "the lighting". Do not use these under any circumstances.${nuclearStyleHint}${nuclearLaneBlock} Do NOT rely on "tired/drained/low energy/low battery" as the main punch. One safe absurd kicker allowed occasionally (e.g., "even the garage door isn't impressed" / "your RGB wants a refund") but avoid dehumanization and worthlessness. Avoid poetic metaphors. Cold and cutting. No existential despair. No "nobody cares" or "forgettable". Avoid substance references (hungover/drunk/high). Avoid diagnosis/therapy wording. Avoid "warning sign" phrasing. Avoid "screams" and "you clearly" templates. Avoid words like "detected", "confirmed", "exposed", "analyzed". FORMAT: output 1–2 sentences. No line breaks, no bullet points, no ellipsis-only fragments. Aim for 60–160 characters total. Respond with ONLY valid JSON: {"roasts":["Your sentences here."]}. No markdown. No code fences. No explanations.${nuclearAvoidBlock}`
        : `You are a sharp, observational roast comedian. You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanations.`;

    const imageContent = [
      { type: 'input_text', text: prompt },
      { type: 'input_image', image_url: nv2ToDataUrl(normalizedImageBase64) },
    ];

    // --- Build call options (with model params per tier) ---
    const buildCallOptions = (sysContent, { tempOverride } = {}) => {
      const opts = {
        model: 'gpt-4o',
        input: [
          { role: 'system', content: sysContent },
          { role: 'user', content: imageContent },
        ],
      };
      if (config.maxTokens) opts.max_output_tokens = config.maxTokens;
      opts.temperature = tempOverride != null ? tempOverride : (config.temperature ?? undefined);
      if (config.presence_penalty != null) opts.presence_penalty = config.presence_penalty;
      if (config.frequency_penalty != null) opts.frequency_penalty = config.frequency_penalty;
      if (config.top_p != null) opts.top_p = config.top_p;
      return opts;
    };

    let roasts = [];
    let themes = [];
    const levelFallbacks = FALLBACKS[tierName] || FALLBACKS.medium;

    if (isHighTier) {
      // --- Multi-sample generation for savage/nuclear ---
      const numCandidates = config.candidates || 4;
      const savageRejectCounts = {};
      const seenRound = new Set(); // dedupe candidates within this request

      const generateCandidates = async (sysContent, count = numCandidates, { tempOverride } = {}) => {
        const calls = Array.from({ length: count }, () =>
          openai.responses.create(buildCallOptions(sysContent, { tempOverride }))
            .then(r => r.output_text)
            .catch(() => null)
        );
        const outputs = await Promise.all(calls);
        const candidates = [];
        for (const raw of outputs) {
          if (!raw) continue;
          const result = parseModelOutput(raw, config);
          if (!result.jsonParsed || result.roasts.length === 0) {
            // Attempt salvage before rejecting
            const salvaged = extractRoastText(raw);
            if (salvaged) {
              if (isDev) console.log(`[nuclear] json-parse-fail recovered: "${salvaged.slice(0, 50)}…"`);
              result.roasts = [salvaged];
            } else {
              if (isDev) console.log(`[roast] candidate rejected: json-parse-fail`);
              continue;
            }
          }
          for (const r of result.roasts) {
            let clamped = clampRoast(r.replace(/\s+/g, ' ').trim(), config.maxSentences, config.maxChars, config.maxWords);
            if (!clamped) continue;
            // Savage-v2 hard clamp: keep first 2 sentences, 22-word cap
            if (tierName === 'savage') {
              const savSents = clamped.match(/[^.!?]*[.!?]+/g);
              if (savSents && savSents.length > 2) clamped = savSents.slice(0, 2).map(s => s.trim()).join(' ');
              const sw = clamped.trim().split(/\s+/);
              if (sw.length > 22) clamped = sw.slice(0, 22).join(' ').trim();
              if (!/[.!?]$/.test(clamped)) clamped = clamped + '.';
              if (!clamped || clamped.length < 10) continue;
            }
            const v = validateRoast(clamped, tierName);
            if (!v.valid) {
              if (isDev) {
                console.log(`[roast] candidate rejected: ${v.reasons.join(', ')} — "${clamped.slice(0, 60)}…"`);
                if (tierName === 'nuclear' && v.reasons.some(r => r.startsWith('nuclear-viral-ban:'))) {
                  console.log(`[nuclear] viral-ban hit: ${v.reasons.filter(r => r.startsWith('nuclear-viral-ban:')).join(', ')}`);
                }
              }
              if (tierName === 'savage') {
                for (const reason of v.reasons.slice(0, 2)) {
                  savageRejectCounts[reason] = (savageRejectCounts[reason] || 0) + 1;
                }
              }
              continue;
            }
            // Dedupe: skip if normalized text already seen this request
            const normKey = normalizeRoast(clamped);
            if (seenRound.has(normKey)) {
              if (isDev) console.log(`[${tierName}] candidate rejected: duplicate`);
              continue;
            }
            seenRound.add(normKey);
            // Nuclear quality gate: require 2+ sentences and >=60 chars; soft-score exposure verbs
            if (tierName === 'nuclear') {
              const sentenceCount = (clamped.match(/[.!?]+/g) || []).length;
              if (sentenceCount < 2) {
                if (isDev) console.log(`[nuclear] candidate rejected: one-liner`);
                continue;
              }
              if (clamped.length < 55) {
                if (isDev) console.log(`[nuclear] candidate rejected: too-short (${clamped.length}<55)`);
                continue;
              }
              // Reject sentence 2 starting with overused openers (hard reject — these are always bad)
              const s2Gate = getSentence2(clamped);
              if (s2Gate && /^\s*(You think|You act|You convinced yourself)\b/i.test(s2Gate)) {
                if (isDev) console.log(`[nuclear] candidate rejected: sent2-overused-opener`);
                continue;
              }
            }
            const score = scoreRoast(clamped, tierName, nuclearLane, { requiredExposure, clientState: tierName === 'nuclear' ? getClientState(clientId) : null });
            candidates.push({ text: clamped, score, themes: result.themes });
            if (isDev) console.log(`[roast] candidate score=${score} — "${clamped.slice(0, 60)}…"`);
          }
        }
        return candidates;
      };

      // Round 1: generate candidates (savage splits into face-focused + context-focused groups)
      let candidates;
      if (tierName === 'savage') {
        const groupACount = Math.ceil(numCandidates / 2);
        const groupBCount = numCandidates - groupACount;
        const groupASys = systemMsg + ' Anchor the roast primarily on a facial feature, posture, or stance. Avoid hair unless it is extremely distinctive. Surroundings may be mentioned but must not be the focus.';
        const groupBSys = systemMsg + ' Anchor the roast on clothing, tools, setup, or environment, but still insult the person directly.';
        const [groupA, groupB] = await Promise.all([
          generateCandidates(groupASys, groupACount),
          generateCandidates(groupBSys, groupBCount),
        ]);
        candidates = groupA.concat(groupB);
        if (isDev) console.log(`[savage-v2] round1: ${groupA.length} face-focused + ${groupB.length} context-focused = ${candidates.length} valid candidates from ${numCandidates} calls`);
      } else {
        candidates = await generateCandidates(systemMsg);
        if (isDev) console.log(`[${tierName}] round1: ${candidates.length} valid candidates from ${numCandidates} calls`);
      }

      // Nuclear adaptive rescue: two-step path when round1 is starved
      if (tierName === 'nuclear' && candidates.length < 2) {
        // Rescue Step 1: tightened format enforcement, batch of 8, lower temperature
        if (isDev) console.log(`[nuclear] rescue-step-1 triggered (have ${candidates.length})`);
        const rescueTemp = Math.max(0.78, (config.temperature || 1.0) - 0.3);
        const rescueSys = `You are a ruthless roast comedian. Write 1–2 sentences total. No third sentence. Sentence 1: visual observation anchored on something visible. Sentence 2 (if present): social verdict referencing audience (anyone/people/everyone/nobody/the room/group chat/timeline). Sentence 2 must NOT start with "You". BANNED WORDS: imagine, expect, insist, assume, pretend. BANNED PHRASES: "does you no favors", "isn't doing you any favors", "your expression", "the lighting".${nuclearLaneBlock} Keep all safety rules. Respond with ONLY valid JSON. No markdown.${nuclearAvoidBlock}`;
        const rescue1 = await generateCandidates(rescueSys, 8, { tempOverride: rescueTemp });
        candidates = candidates.concat(rescue1);
        if (isDev) console.log(`[nuclear] after rescue-step-1: ${candidates.length} candidates (temp=${rescueTemp})`);

        // Rescue Step 2: extra batch with same rules (2 sentences + >=60 chars)
        if (candidates.length < 2) {
          if (isDev) console.log(`[nuclear] rescue-step-2 triggered (have ${candidates.length})`);
          const rescue2 = await generateCandidates(rescueSys, 8, { tempOverride: rescueTemp });
          candidates = candidates.concat(rescue2);
          if (isDev) console.log(`[nuclear] after rescue-step-2: ${candidates.length} candidates`);
        }
      }

      // Round 2: if all failed or best score too low, retry with harder prompt
      // Savage: skip round2 when we already have >= 2 valid candidates
      const bestScore = candidates.length > 0
        ? Math.max(...candidates.map(c => c.score))
        : -1;

      const needsRound2 = tierName === 'savage'
        ? candidates.length < 2
        : (candidates.length === 0 || bestScore < 30);
      if (needsRound2) {
        if (isDev) console.log(`[${tierName}] round1 weak (count=${candidates.length}, bestScore=${bestScore}), triggering round2`);
        const harderSys = tierName === 'nuclear'
          ? systemMsg + ` BE HARSHER. Exactly 3 sentences. Sentence 1: vivid visual anchor (max 12 words). Sentence 2: ego hit using "you" statements (max 16 words). Sentence 3: knockout closer (2–5 words, caption-like). No questions. No filler. JSON ONLY.`
          : tierName === 'savage'
            ? systemMsg + ` EXACTLY 2 sentences. 11–22 words. Sentence 1: cold verdict about ONE visible thing. NEVER use "you look like" or "looks like". Sentence 2: short decisive closer (1–4 words) ending with period. Not a command. Not a question. No "you"/"your". Specific to the photo. JSON ONLY.`
            : systemMsg + ` BE MUCH SHORTER. RESPOND WITH ONLY JSON. NO ESSAYS.`;
        const round2 = await generateCandidates(harderSys);
        if (isDev) console.log(`[${tierName}] round2: ${round2.length} valid candidates`);
        candidates = candidates.concat(round2);
      }

      // --- Savage intra-batch repetition penalty ---
      if (tierName === 'savage' && candidates.length > 1) {
        const prefixes = candidates.map(c => {
          const w = c.text.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
          return { w2: w.slice(0, 2).join(' '), w3: w.slice(0, 3).join(' '), w4: w.slice(0, 4).join(' ') };
        });
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            if (prefixes[i].w4 === prefixes[j].w4) {
              candidates[i].score -= 30;
              candidates[j].score -= 30;
            } else if (prefixes[i].w3 === prefixes[j].w3) {
              candidates[i].score -= 20;
              candidates[j].score -= 20;
            } else if (prefixes[i].w2 === prefixes[j].w2) {
              candidates[i].score -= 10;
              candidates[j].score -= 10;
            }
          }
        }
      }

      // --- Savage round 3: last-ditch retry before fallback (only when starved) ---
      if (tierName === 'savage' && candidates.length < 2) {
        if (isDev) console.log(`[savage-v2] round1+2 starved (have ${candidates.length}), triggering round3 rewrite`);
        const rewriteSys = systemMsg + ` EXACTLY 2 sentences. 11–22 words. Sentence 1: cold verdict about ONE visible detail. NEVER use "you look like" or "looks like". Sentence 2: short decisive closer (1–4 words) ending with period. Not a command. Not a question. No "you"/"your". Specific to the photo. Avoid repeating prior roasts. JSON ONLY.`;
        const round3 = await generateCandidates(rewriteSys);
        if (isDev) console.log(`[savage-v2] round3: ${round3.length} valid candidates`);
        candidates = candidates.concat(round3);
      }

      // --- Nuclear round 3: relaxed retry (allow 2–3 sentences, lower temp) ---
      if (tierName === 'nuclear' && candidates.length === 0) {
        const round3Temp = Math.max(0.7, (config.temperature || 1.0) - 0.1);
        if (isDev) console.log(`[nuclear] round3 relaxed temp=${round3Temp}`);
        const relaxedSys = systemMsg.replace('exactly 2 sentences', '2 or 3 sentences') + ` Write 2 or 3 sentences. Keep all safety rules. JSON ONLY.`;
        const round3Nuclear = await generateCandidates(relaxedSys, 6, { tempOverride: round3Temp });
        if (isDev) console.log(`[nuclear] round3: ${round3Nuclear.length} valid candidates`);
        candidates = round3Nuclear;
      }

      // Dev: log savage-v2 rejection distribution (mirror nuclear-v2 shape)
      if (isDev && tierName === 'savage' && Object.keys(savageRejectCounts).length > 0) {
        console.log(`[savage-v2] candidates=${numCandidates} valid=${candidates.length} rejected=${JSON.stringify(savageRejectCounts)}`);
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);

        // Savage: pick highest candidate that avoids repeating last 2 anchors, last 2 structures, AND comparison templates
        let best = candidates[0];
        if (tierName === 'savage' && candidates.length > 1) {
          const last2A = recentSavageAnchors.slice(-2);
          const last2S = recentSavageStructures.slice(-2);
          const topScore = candidates[0].score;
          for (const c of candidates) {
            const a = detectSavageAnchor(c.text);
            const s = detectSavageStructure(c.text);
            if (!last2A.includes(a) && (s === 'direct-verdict' || !last2S.includes(s)) && !hasSavageComparisonTemplate(c.text)) {
              best = c;
              break;
            }
          }
          // Hair de-emphasis: if best is "hair" and a non-hair candidate exists within 15 pts, prefer it
          if (detectSavageAnchor(best.text) === 'hair') {
            const nonHair = candidates.find(c => detectSavageAnchor(c.text) !== 'hair' && c.score >= topScore - 15 && !hasSavageComparisonTemplate(c.text));
            if (nonHair) best = nonHair;
          }
        }

        // Nuclear: hard safety filter — never pick an exact repeat of a recent roast
        if (tierName === 'nuclear' && candidates.length > 1) {
          const recentNorms = new Set(recentNuclearRoasts.map(r => normalizeRoast(r)));
          const nonRepeat = candidates.find(c => !recentNorms.has(normalizeRoast(c.text)));
          if (nonRepeat) best = nonRepeat;
        }

        // Legacy nuclear post-processing: trim to 2 sentences, clamp body, append mic-drop
        // NOTE: This block is unreachable for nuclear tier — nuclear-v2 intercept returns early above.
        // Guard kept for safety in case the intercept is ever disabled.
        let nuclearBodyText = null; // pre-micdrop text for overlap tracking
        if (tierName === 'nuclear' && false) { // disabled: nuclear-v2 handles micdrops
          const winSents = best.text.match(/[^.!?]*[.!?]+/g) || [best.text];
          let trimmed = winSents.slice(0, 2).map(s => s.trim()).join(' ');
          const { text: micdrop, tier: micdropTier, spiced: micdropSpiced } = pickMicdrop(nuclearLane, trimmed, best.score);
          // Integrate micdrop into the final sentence (em-dash + lowercase micdrop)
          // instead of appending as a separate third sentence. Keeps total <=2 sentences.
          const micdropLower = micdrop.replace(/\.$/, '').replace(/^./, c => c.toLowerCase());
          const micdropSuffix = ' \u2014 ' + micdropLower + '.';
          // Strip trailing punctuation from body before joining
          const bodyStripped = trimmed.replace(/[.!?]+$/, '');
          const bodyBudget = (config.maxChars || 450) - micdropSuffix.length;
          if (bodyStripped.length > bodyBudget && bodyBudget > 40) {
            trimmed = bodyStripped.slice(0, bodyBudget);
            // Back up to word boundary
            if (/[a-zA-Z]$/.test(trimmed)) {
              const lastSpace = trimmed.lastIndexOf(' ');
              if (lastSpace > 0) trimmed = trimmed.slice(0, lastSpace);
            }
            trimmed = trimmed.trim();
          } else {
            trimmed = bodyStripped;
          }
          nuclearBodyText = trimmed + '.'; // pre-micdrop text for overlap tracking
          best.text = trimmed + micdropSuffix;
          if (isDev) console.log(`[nuclear] micdropTier=${micdropTier}${micdropSpiced ? ' (spiced)' : ''} micdrop="${micdrop}"`);
        }

        roasts = [best.text];
        themes = best.themes || [];
        // Track savage roasts for anti-repeat
        if (tierName === 'savage') {
          pushRecentSavage(best.text);
          pushRecentSavageAnchor(best.text);
          pushRecentSavageStructure(best.text);
        }
        if (isDev) {
          console.log(`[${tierName}] PICKED score=${best.score} from ${candidates.length} total — "${best.text.slice(0, 80)}…"`);
          if (tierName === 'savage') {
            const _svSents = best.text.match(/[^.!?]*[.!?]+/g) || [best.text];
            const _svS2 = _svSents.length >= 2 ? _svSents[1].trim() : '';
            const _svS2Wc = _svS2.split(/\s+/).filter(w => w).length;
            const _svWc = best.text.trim().split(/\s+/).length;
            console.log(`[savage-v2] winner score=${best.score} text="${best.text}"`);
            console.log(`[savage-v2] anchor=${detectSavageAnchor(best.text)} structure=${detectSavageStructure(best.text)} s2="${_svS2}" s2words=${_svS2Wc} wordCount=${_svWc}`);
          }
          if (tierName === 'nuclear') {
            const _candNorm = normalizeForOverlap(nuclearBodyText || best.text);
            let _maxOvl = 0;
            let _maxOvlIdx = -1;
            let _maxOvlPrev = '';
            for (let _i = 0; _i < recentNuclearRoasts.length; _i++) {
              const prev = recentNuclearRoasts[_i];
              const prevNorm = normalizeForOverlap(prev);
              if (prevNorm === _candNorm) {
                console.log(`[overlap] exact-match idx=${_i} (self/duplicate) preview="${prev.slice(0, 60)}…"`);
                continue;
              }
              const o = tokenOverlap(nuclearBodyText || best.text, prev);
              console.log(`[overlap] vs${_i}=${o.toFixed(2)} preview="${prev.slice(0, 60)}…"`);
              if (o > _maxOvl) { _maxOvl = o; _maxOvlIdx = _i; _maxOvlPrev = prev; }
            }
            const _sents = best.text.match(/[^.!?]*[.!?]+/g) || [best.text];
            const _openers = _sents.map(s => s.trim().split(/\s+/)[0]?.toLowerCase() || '');
            const _finalSent = (_sents[_sents.length - 1] || '').trim();
            console.log(`[nuclear] maxOverlap=${_maxOvl.toFixed(2)} idx=${_maxOvlIdx} overlapPenalty=${_maxOvl > 0.55} recentPool=${recentNuclearRoasts.length}`);
            if (_maxOvlPrev) console.log(`[nuclear] closest-prev: "${_maxOvlPrev.slice(0, 60)}…"`);
            const _s2 = getSentence2(nuclearBodyText || best.text);
            console.log(`[nuclear] lane=${nuclearLane} openers=[${_openers.join(',')}] sentence2Start="${_s2.slice(0, 12)}" closer: "${_finalSent}"`);
          }
          if (candidates.length > 1) console.log(`[${tierName}] runner-up score=${candidates[1].score}`);
        }
        // Track nuclear roasts for anti-repeat (AFTER logging to avoid self-comparison)
        // Use nuclearBodyText (pre-micdrop) for overlap/anchor tracking
        if (tierName === 'nuclear') {
          const trackText = nuclearBodyText || best.text;
          pushRecentNuclear(trackText);
          // Outfit cooldown: track whether this winner mentioned shirt or lane was outfit
          const isOutfitWinner = nuclearLane === 'outfit' || /(shirt|t-shirt)/i.test(trackText);
          recentNuclearOutfitFlags.push(isOutfitWinner);
          if (recentNuclearOutfitFlags.length > MAX_OUTFIT_TRACK) recentNuclearOutfitFlags.shift();
          // (Anchor tracking removed — handled by nv2ValidateCandidate phrase fatigue)
        }
      } else {
        if (isDev) console.log(`[${tierName}] NO valid candidates, falling back`);
      }

    } else {
      // --- Standard single-call for mild/medium ---
      const callOptions = buildCallOptions(systemMsg);

      let attempt = 0;
      while (attempt < 2) {
        attempt++;
        const response = await openai.responses.create(callOptions);
        const result = parseModelOutput(response.output_text, config);
        roasts = result.roasts;
        themes = result.themes;
        if (roasts.length > 0 && result.jsonParsed) break;
        if (attempt < 2) {
          callOptions.input[0].content += ' RESPOND WITH ONLY A JSON OBJECT. NOTHING ELSE.';
        }
      }
    }

    // --- Deduplicate ---
    const seen = new Set();
    roasts = roasts.filter(r => {
      const key = r.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    roasts = roasts.slice(0, config.count);

    // --- Fill with fallbacks if needed ---
    if (tierName === 'savage' && roasts.length < config.count) {
      // Pick least-overlapping fallback relative to recent savage roasts
      const recentWindow = recentSavageRoasts.slice(-25);
      const lastRecent = recentSavageRoasts.length > 0
        ? recentSavageRoasts[recentSavageRoasts.length - 1] : null;
      const allOptions = levelFallbacks
        .map(fb => {
          const text = (config.maxSentences || config.maxChars)
            ? clampRoast(fb, config.maxSentences, config.maxChars, config.maxWords) : fb;
          if (!text || seen.has(text.toLowerCase())) return null;
          const maxOverlap = recentWindow.length > 0
            ? Math.max(...recentWindow.map(prev => tokenOverlap(text, prev)))
            : 0;
          const isExactLast = lastRecent && text.toLowerCase() === lastRecent;
          return { text, maxOverlap, isExactLast };
        })
        .filter(Boolean);
      // Filter out exact-match with most recent, unless it's the only option
      const nonExact = allOptions.filter(e => !e.isExactLast);
      const scored = (nonExact.length > 0 ? nonExact : allOptions)
        .sort((a, b) => a.maxOverlap - b.maxOverlap);
      // Log skipped exact matches
      if (isDev) {
        for (const e of allOptions) {
          if (e.isExactLast && nonExact.length > 0) console.log(`[savage-v2] fallback-skip-exact: "${e.text.slice(0, 60)}"`);
        }
      }
      if (scored.length > 0 && roasts.length < config.count) {
        // Randomize among top 3 least-overlapping options
        const top = scored.filter(e => e.maxOverlap < 0.45).slice(0, 3);
        const pick = top.length > 0
          ? top[Math.floor(Math.random() * top.length)]
          : scored[0];
        roasts.push(pick.text);
        seen.add(pick.text.toLowerCase());
        pushRecentSavage(pick.text);
        pushRecentSavageAnchor(pick.text);
        pushRecentSavageStructure(pick.text);
        if (isDev) console.log(`[savage-v2] fallback=true text="${pick.text.slice(0, 60)}"`);
      }
    } else {
      for (const fb of levelFallbacks) {
        if (roasts.length >= config.count) break;
        const text = (config.maxSentences || config.maxChars)
          ? clampRoast(fb, config.maxSentences, config.maxChars, config.maxWords)
          : fb;
        if (text.length > 0 && !seen.has(text.toLowerCase())) {
          roasts.push(text);
          seen.add(text.toLowerCase());
          if (tierName === 'savage') {
            pushRecentSavage(text);
            pushRecentSavageAnchor(text);
            pushRecentSavageStructure(text);
            if (isDev) console.log(`[savage-v2] fallback=true text="${text.slice(0, 60)}"`);
          }
        }
      }
    }

    roasts = roasts.slice(0, config.count);

    // --- Final hard clamp (safety net) — skip nuclear (mic-drop already assembled) ---
    if ((config.maxSentences || config.maxChars || config.maxWords) && tierName !== 'nuclear') {
      roasts = roasts
        .map(r => clampRoast(r, config.maxSentences, config.maxChars, config.maxWords))
        .filter(r => r.length > 0);
    }

    // --- Savage-v2 post-clamp: 22-word hard cap + ensure punctuation ---
    if (tierName === 'savage') {
      roasts = roasts.map(r => {
        const words = r.split(/\s+/);
        if (words.length > 22) {
          r = words.slice(0, 22).join(' ').trim();
        }
        if (!/[.!]$/.test(r.trim())) r = r.trim() + '.';
        return r;
      });
    }

    // Update rolling theme tracker
    if (themes.length > 0) {
      recentThemes.push(...themes.map(t => t.trim()).filter(t => t.length > 0));
      while (recentThemes.length > MAX_RECENT_THEMES) recentThemes.shift();
    }

    if (isDev) {
      const usedFallback = roasts.length > 0 && levelFallbacks.some(fb => roasts[0].startsWith(fb.slice(0, 20)));
      console.log(`[roast] level=${tierName} returned=${roasts.length} fallback=${usedFallback} chars=${roasts[0]?.length || 0}`);
    }

    res.json({ roasts: filterRefusals(roasts, tierName) });
  } catch (error) {
    console.error('Roast error:', error);
    // Return 200 with fallback roast so client always gets valid JSON (never HTML error pages)
    const safeTier = req.body?.level;
    const errorFallbacks = FALLBACKS[safeTier] || FALLBACKS.medium;
    const fallback = errorFallbacks[Math.floor(Math.random() * errorFallbacks.length)];
    res.status(200).json({ roasts: [fallback] });
  }
});

// ========================================================
// POST /api/roast-v3 — single-call, no pipeline
// ========================================================
const V3_PERSONAS = {
  default: '',
  butler: 'Voice: aristocratic British butler — politely condescending, dry, restrained. Vary your opener every time — draw from the tone of words like "Evidently," "Remarkable," "Curious," "How unfortunate," "One does wonder," but never repeat the same opener twice. One simple clause — no semicolons, no compound sentences. 8–14 words max.',
  mean_girl: 'Voice: petty mean girl — sarcastic, socially cutting, dripping with fake concern. Use gossip-style phrasing.',
  gym_bro: 'Voice: gym trash talk. Cocky bro roasting a friend. Every roast must include exactly one gym term (reps, sets, spotter, PR, warmup, cardio, cutting, bulking, rest day, gains, or form). BANNED openers: "Looks like", "Confidence level", "Your expression says". Keep it short — 6–12 words. Think locker room one-liner, not stand-up bit.',
  anime_villain: 'Voice: anime villain — dramatic, theatrical, overconfident monologue energy. Use grandiose phrasing.',
  therapist: 'Voice: therapist making a calm observation. Start with "Interesting." or "Fascinating." or "I notice..." then one short clinical observation about what you see. Deadpan, analytical, no jokes. 8–12 words after the opener.',
};

const V3_VALID_PERSONAS = Object.keys(V3_PERSONAS);

const V3_TONES = {
  mild:    [
    'Tone: light, playful teasing — like friends roasting each other. Witty but never cruel.',
    'No harsh insults, no appearance attacks, no aggression, no profanity. Target 8–14 words, hard max 18. No trailing clauses unless they improve the punchline.',
    'NEVER start with "That" — it is banned as a sentence opener. Also banned: "With that...", "Is that...".',
    'Vary openers — try: "Your...", "Even...", "Looks like...", "This photo...", "The background...", "Confidence...", "Apparently...", "Somehow...", or any other fresh start.',
    'Avoid questions unless the joke truly needs it. Avoid quoted dialogue unless it clearly improves the line.',
    'Write like a meme caption — direct punchline, no setup. Lead with the observation, land on the joke.',
    'Pick the MOST noticeable detail to roast — clothing, pose, camera angle, expression, background, pets, environment, or overall vibe. Do NOT default to hair.',
    'Angles to try: ironic observations, mock compliments, deadpan commentary, unexpected comparisons, casual understatement.',
    'End punchy and meme-worthy.',
  ].join(' '),
  medium:  [
    'Tone: sarcastic and embarrassing — sharper than friendly teasing, clearly a roast. Playful but cutting.',
    'No mild-style compliments, no gentle teasing. This should sting a little. Still app-safe. Target 8–14 words, hard max 18. No trailing clauses unless they improve the punchline.',
    'NEVER start with "That" — it is banned as a sentence opener. Also banned: "With that...", "Is that...".',
    'BANNED templates: "Your X looks like...", "Your X screams...", "Your X says...". Never use these structures.',
    'Vary openers — try: "Even...", "Looks like...", "This photo...", "Somehow...", "Nobody asked for...", "Apparently...", "Confidence...", or any fresh start.',
    'No long setups or explanations. Write like a meme caption — direct punchline, no filler.',
    'Pick the MOST noticeable detail to roast — clothing, pose, camera angle, expression, background, pets, environment, or overall vibe. Do NOT default to hair.',
    'Angles to try: sarcastic observations, backhanded compliments, deadpan dismissals, embarrassing comparisons, ironic narration, casual brutality.',
    'Never repeat the same joke structure. Each roast should feel structurally unique.',
    'End with a sharp, quotable punchline.',
  ].join(' '),
  savage:  [
    'Tone: brutal, mocking, and aggressive — significantly harsher than medium. This should hurt to read. Make it sting.',
    'No compliments, no soft language, no medium-style teasing. Go for the throat. Still funny and shareable. Target 8–14 words, hard max 18. No trailing clauses unless they improve the punchline.',
    'NEVER start with "That" or "Looks like" — both are banned as sentence openers. Also banned: "With that...", "Is that...".',
    'BANNED templates: "Your X looks like...", "Your X screams...", "Your X says...". Never use these structures.',
    'Vary openers — try: "Even...", "Somehow...", "Nobody warned you...", "This photo...", "Confidence...", "Apparently...", "Someone should have...", or any fresh start.',
    'No setups, no explanations. Hit them with a direct insult about what you see — clothing, pose, camera angle, expression, background, pets, environment, or overall vibe. Do NOT default to hair.',
    'Prefer direct brutal observations over clever wordplay. Be mean, not cute.',
    'Angles to try: savage mockery, brutal comparisons, deadpan cruelty, exaggerated disappointment, public humiliation.',
    'Never repeat the same joke structure. Each roast should feel structurally unique.',
    'End with a brutal punchline that hits like an insult you remember for years.',
  ].join(' '),
  nuclear: [
    'Tone: ruthless, humiliating, and unforgiving — the harshest tier, significantly more brutal than savage. Maximum cruelty.',
    'No compliments, no soft language, no savage-style cleverness. Pure destruction. Still funny and shareable. Target 8–14 words, hard max 18. No trailing clauses unless they improve the punchline.',
    'Play Store safe — no slurs, no threats, no harassment, no sexual content. Destroy them within the rules.',
    'NEVER start with "That" or "Looks like" — both are banned as sentence openers. Also banned: "With that...", "Is that...".',
    'BANNED templates: "Your X looks like...", "Your X screams...", "Your X says...". Never use these structures.',
    'Vary openers — try: "Even...", "Somehow...", "Nobody warned you...", "This photo...", "Apparently...", "Someone should have...", "Your barber...", "The audacity...", or any fresh start.',
    'No setups, no explanations. Go straight for the kill — one brutal observation about what you see.',
    'Roast the MOST noticeable visible detail — clothing, pose, camera angle, expression, background, pets, environment, or overall vibe. Do NOT default to hair.',
    'Prefer maximum-impact insults over wordplay. Be ruthless, not clever.',
    'Angles to try: public humiliation, brutal mockery, exaggerated disgust, merciless comparisons, deadpan devastation.',
    'Never repeat the same joke structure. Each roast should feel structurally unique.',
    'End with a punchline so brutal it could end a friendship.',
  ].join(' '),
};

const V3_FALLBACKS = {
  mild: [
    'You look like you peaked in a participation trophy ceremony.',
    'Even your camera tried to unfocus.',
    'You look like you Google "how to be cool" daily.',
  ],
  medium: [
    'You look like you got dressed in the dark during an earthquake.',
    'Your vibe says "I peaked in middle school and never recovered."',
    'That look screams "my personality is my Netflix queue."',
  ],
  savage: [
    'You look like a before photo that never got an after.',
    'Evolution really phoned it in with you.',
    'You look like you were assembled from spare parts at a clearance sale.',
  ],
  nuclear: [
    'If disappointment had a face, it would sue you for copyright.',
    'You look like a AI-generated image of "rock bottom."',
    'Your face is proof that God has a sense of humor and zero quality control.',
  ],
};

const V3_REJECTED = [/\bi can'?t\b/i, /\bsorry\b/i, /\bas an ai\b/i];

const V3_REJECT_LABELS = ['i_cant', 'sorry', 'as_an_ai'];

const V3_MAX_WORDS = { mild: 20, medium: 20, savage: 20, nuclear: 20 };

function v3Validate(text, tier) {
  if (!text || typeof text !== 'string') {
    console.log(`[roast-v3] rejected: empty_or_invalid -> ${JSON.stringify(text)}`);
    return { ok: false, reason: 'empty_or_invalid' };
  }
  const trimmed = text.trim();
  const maxWords = V3_MAX_WORDS[tier] || 20;
  const wc = trimmed.split(/\s+/).length;
  if (wc > maxWords) {
    console.log(`[roast-v3] rejected: too_many_words (${wc}/${maxWords}) -> "${trimmed}"`);
    return { ok: false, reason: 'too_many_words' };
  }
  for (let i = 0; i < V3_REJECTED.length; i++) {
    if (V3_REJECTED[i].test(trimmed)) {
      const label = V3_REJECT_LABELS[i] || 'banned_phrase';
      console.log(`[roast-v3] rejected: ${label} -> "${trimmed}"`);
      return { ok: false, reason: label };
    }
  }
  return { ok: true, reason: null };
}

app.post('/api/roast-v3', async (req, res) => {
  const t0 = Date.now();
  try {
    const { imageBase64, level, persona: rawPersona } = req.body || {};
    const tier = ['mild', 'medium', 'savage', 'nuclear'].includes(level) ? level : 'medium';
    const persona = V3_VALID_PERSONAS.includes(rawPersona) ? rawPersona : 'default';

    if (!imageBase64) {
      return res.status(400).json({ error: 'missing_image', message: 'imageBase64 is required.' });
    }

    // Strip data-url header to get raw base64
    const rawBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const originalBytes = Buffer.byteLength(rawBase64, 'base64');

    // Resize & compress: 512px longest side, JPEG q70
    const tResize = Date.now();
    const compressed = await sharp(Buffer.from(rawBase64, 'base64'))
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    const resizeMs = Date.now() - tResize;
    const compressedBytes = compressed.length;
    const dataUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;

    console.log(`[roast-v3] image originalKB=${(originalBytes / 1024).toFixed(0)} compressedKB=${(compressedBytes / 1024).toFixed(0)} reduction=${(((originalBytes - compressedBytes) / originalBytes) * 100).toFixed(0)}% resizeMs=${resizeMs}`);

    const personaBlock = V3_PERSONAS[persona] || '';
    const systemPrompt = 'Roast comedian. One-liner selfie roasts. ' + V3_TONES[tier] + (personaBlock ? ' ' + personaBlock : '') + ' ONE sentence, no preamble, no quotes. NEVER say you can\'t identify someone. NEVER apologise or say sorry. No hedging, no disclaimers.';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 40,
      temperature: tier === 'nuclear' ? 1.1 : tier === 'savage' ? 1.0 : 0.9,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
            { type: 'text', text: 'Roast them.' },
          ],
        },
      ],
    });

    let roast = (completion.choices?.[0]?.message?.content || '').trim();

    // Strip wrapping quotes if present
    if ((roast.startsWith('"') && roast.endsWith('"')) || (roast.startsWith("'") && roast.endsWith("'"))) {
      roast = roast.slice(1, -1).trim();
    }

    const { ok, reason } = v3Validate(roast, tier);
    let usedFallback = false;
    if (!ok) {
      const fb = V3_FALLBACKS[tier];
      roast = fb[Math.floor(Math.random() * fb.length)];
      usedFallback = true;
    }

    const totalTime = Date.now() - t0;
    console.log(`[roast-v3] tier=${tier} persona=${persona} totalTime=${totalTime}ms fallback=${usedFallback}${reason ? ' reason=' + reason : ''}`);

    const meta = { usedFallback };
    if (usedFallback && reason) meta.rejectReason = reason;
    return res.json({ roasts: [roast], meta });
  } catch (err) {
    const totalTime = Date.now() - t0;
    console.error(`[roast-v3] error after ${totalTime}ms:`, err.message || err);
    const tier = req.body?.level || 'medium';
    const fb = V3_FALLBACKS[tier] || V3_FALLBACKS.medium;
    return res.status(200).json({ roasts: [fb[Math.floor(Math.random() * fb.length)]] });
  }
});

// --- Dev-only: Nuclear V2 repetition hammer test ---
if (process.env.NV2_DEBUG === '1' || process.env.NODE_ENV !== 'production') {
  app.get('/debug/nuclear-hammer', async (req, res) => {
    const clientId = req.query.clientId || 'hammer-' + Date.now();
    const n = Math.min(Math.max(parseInt(req.query.n, 10) || 20, 1), 500);
    // Tiny 1x1 white JPEG as placeholder image
    const tinyImg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AAAf/2Q==';

    const samples = [];
    const structureCounts = {};
    const targetCounts = {};
    const allRoasts = [];

    for (let i = 0; i < n; i++) {
      const { roast, meta } = await generateNuclearV2({ clientId, imageBase64: tinyImg });
      allRoasts.push(roast);
      if (i < 10) samples.push(roast);
      structureCounts[meta.targetSource || 'freeform'] = (structureCounts[meta.targetSource || 'freeform'] || 0) + 1;
      targetCounts['freeform'] = (targetCounts['freeform'] || 0) + 1;
    }

    // Unique roasts (exact match)
    const uniqueRoasts = new Set(allRoasts).size;

    // 2–3 word ngram frequency
    const ngramFreq = {};
    for (const roast of allRoasts) {
      const words = roast.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
      for (let size = 2; size <= 3; size++) {
        for (let j = 0; j <= words.length - size; j++) {
          const ng = words.slice(j, j + size).join(' ');
          ngramFreq[ng] = (ngramFreq[ng] || 0) + 1;
        }
      }
    }
    const topRepeatedPhrases = Object.entries(ngramFreq)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([phrase, count]) => ({ phrase, count }));

    res.json({
      total: n,
      clientId,
      uniqueRoasts,
      uniqueRatio: +(uniqueRoasts / n).toFixed(3),
      topRepeatedPhrases,
      structureCounts,
      targetCounts,
      samples,
    });
  });

  // --- Dev-only: Savage V2 repetition hammer test ---
  app.get('/debug/savage-hammer', async (req, res) => {
    const clientId = req.query.clientId || 'shammer-' + Date.now();
    const n = Math.min(Math.max(parseInt(req.query.n, 10) || 20, 1), 500);
    const tinyImg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AAAf/2Q==';

    const samples = [];
    const structureCounts = {};
    const targetCounts = {};
    const allRoasts = [];

    for (let i = 0; i < n; i++) {
      const { roast, meta } = await generateSavageV2({ clientId, imageBase64: tinyImg });
      allRoasts.push(roast);
      if (i < 10) samples.push(roast);
      structureCounts[meta.pickedStructureId] = (structureCounts[meta.pickedStructureId] || 0) + 1;
      targetCounts[meta.pickedTarget] = (targetCounts[meta.pickedTarget] || 0) + 1;
    }

    const uniqueRoasts = new Set(allRoasts).size;

    const ngramFreq = {};
    for (const roast of allRoasts) {
      const words = roast.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
      for (let size = 2; size <= 3; size++) {
        for (let j = 0; j <= words.length - size; j++) {
          const ng = words.slice(j, j + size).join(' ');
          ngramFreq[ng] = (ngramFreq[ng] || 0) + 1;
        }
      }
    }
    const topRepeatedPhrases = Object.entries(ngramFreq)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([phrase, count]) => ({ phrase, count }));

    res.json({
      total: n,
      clientId,
      uniqueRoasts,
      uniqueRatio: +(uniqueRoasts / n).toFixed(3),
      topRepeatedPhrases,
      structureCounts,
      targetCounts,
      samples,
    });
  });
}

// Error-handling middleware: return JSON for oversized payloads (prevents HTML 413 pages)
app.use((err, req, res, _next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'payload_too_large', message: 'Image is too large. Please use a smaller image.' });
  }
  res.status(err.status || 500).json({ error: 'server_error', message: err.message });
});

if (!process.env.TUNING_MODE) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Roast server running at http://0.0.0.0:${port}`);
    console.log('[config] NUCLEAR_ENGINE=', process.env.NUCLEAR_ENGINE || '(default:v2)');
  });
}

export { generateNuclearV2, generateSavageV2, generateNuclearSv, generateMediumV2, generateMildV2, nv2ExtractSceneNouns, extractSafeSelfieTags };
