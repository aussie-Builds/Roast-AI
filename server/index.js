import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

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
    count: 3,
    minChars: 0,
    style: 'playful, light teasing',
    format: 'short one-liners',
  },
  medium: {
    count: 5,
    minChars: 0,
    style: 'playful, teasing, clever',
    format: 'short punchy lines (1–2 sentences each, 15–35 words)',
  },
  savage: {
    count: 1,
    minChars: 0,
    maxChars: 120,
    maxWords: 18,
    maxSentences: 1,
    maxTokens: 50,
    candidates: 12,
    temperature: 1.0,
    top_p: 0.9,
    presence_penalty: 0.8,
    frequency_penalty: 0.5,
    style: 'short nuclear — one sharp sentence, direct ego hit',
    format: 'ONE sentence, 10–18 words, ends on a punch verdict; no list',
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
  'but your', "but it's", 'but the',
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
    "Your selfie game is… developing. Like a Polaroid from 2003.",
    "You look like you'd apologize to a revolving door.",
    "That smile says 'I peaked in a group project once.'",
    "You give off strong 'reply-all by accident' energy.",
    "Bless your heart, you really tried with that angle.",
  ],
  medium: [
    "You look like autocorrect keeps changing your name to something better.",
    "That outfit screams 'I dressed in the dark and called it a vibe.'",
    "Your confidence is inspirational — completely unearned, but inspirational.",
    "You have the energy of a participation trophy giving a TED talk.",
    "Everything about this photo says 'close enough.'",
    "You look like your inner monologue needs subtitles.",
    "Your vibe is buffering.",
  ],
  savage: [
    "You dress like you lost a bet and just kept going.",
    "That smile is doing community service for the rest of your face.",
    "Confidence like yours should require a permit.",
    "You peaked and somehow kept going downhill.",
    "That effort was generous, the result was not.",
    "Bold of you to post this without a filter.",
    "You rehearsed this and it still flopped.",
    "Everything about this screams overcompensation.",
    "You confused confidence with delusion again.",
    "That stance says main character but the results say background.",
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

// Short-term anchor repetition tracking
const NUCLEAR_ANCHOR_KEYWORDS = ['smile', 'half-smile', 'lighting', 'dim', 'exhaust', 'drain', 'tired'];
const recentNuclearAnchors = []; // array of arrays of matched keywords per winner
const MAX_NUCLEAR_ANCHOR_TRACK = 4;

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
- 1–2 sentences per roast. 15–35 words each.
- Tone: playful, teasing, clever. Observational humour.
- Light punch, not brutal. No life insults.
- End on the joke.`;
  } else if (tierName === 'savage') {
    tierRules = `
SAVAGE RULES (short nuclear):
- ONE sentence only. 10–18 words. Max 120 characters.
- Mention one visible detail (face feature, posture, outfit, hair, expression, prop, surroundings).
- Direct ego or status hit — stated as cold fact, not a guess. Use "you" statements.
- End on a punch verdict word (e.g. pathetic, cringe, fraud, awkward, tragic, delusion, embarrassing).
- No questions. No advice. No imperatives (no "upgrade", "fix", "try", "stop").
- Do NOT imply the person has no value, is forgotten, invisible, or hopeless.
- No existential despair or worthlessness language.
- Tone: cold, direct, personal. One sharp stab.`;
  } else if (tierName === 'nuclear') {
    tierRules = `
NUCLEAR RULES (STRICT — must be significantly harsher than Savage):
- Exactly 3 sentences. Each sentence MUST escalate in intensity.
- Sentence 1: short visual anchor about a visible detail (expression, posture, grooming, clothing) — max 12 words. Do NOT spend more than one clause on background or lighting.
- Sentence 2: ego exposure or social read — stated as cold fact, not a guess. Use "you" statements. Max 16 words. Be harsh.
- Sentence 3: knockout closer — 2–5 words, caption-like, blunt declarative. The most brutal sentence. Lands hardest.
- Do NOT imply the person is socially irrelevant or forgotten.
- Do NOT imply nobody notices them.
- Do NOT imply they have no value.
- Attack ego, overconfidence, styling, vibe, posture — not life worth.
- Humiliate presentation, not existence.
- The FINAL sentence must ALWAYS be the shortest and most brutal line (2–5 words, caption-like).
- Final sentence: blunt declarative statement, max 5 words preferred. No question marks. No philosophical tone.
- Do NOT use closers like "you're irrelevant", "nobody cares", "forgettable", "lost cause", "living ghost". These are existential, not funny.
- Good knockout examples: "That angle lied.", "Confidence sold separately.", "Your vibe expired.", "Even the camera gave up."
- Avoid words like "detected", "confirmed", "exposed", "analyzed", "diagnosed", "warning" — they sound clinical, not memeable.
- AVOID "setting horror" framing: no warehouse, basement, alley, dungeon, shed-as-habitat, horror-movie vibes, industrial atmosphere descriptions, doom poetry.
- Prefer direct personal judgments about competence, confidence, likability, social status over cinematic scene-setting.
- Avoid generic phrases like "wasted potential", "your expression screams", "life achievements". Be specific to what you see.
- Escalate into ego humiliation, overconfidence exposure, or embarrassing personality flaws.
- Do NOT imply the person has no value, is forgotten, invisible, or hopeless. No "lost cause", "nobody respects", "nobody notices".
- Humiliate presentation, not existence. Mock effort, not worth.
- Do NOT use phrases starting with: "Your expression matches", "You project", "It's like", "You radiate". These sound AI-written.
- Avoid poetic comparisons. Use blunt declarative sentences.
- No philosophical commentary. No moral advice. No reflective tone.
- No soft endings. No witty callbacks. No questions. No over-explaining.
- No generic insults. No filler analogies. No generic movie/horror references.
- NEVER use: ${BANNED_HEDGING.join(', ')}
- No abstract adjectives: blank, lifeless, empty, indifferent, hollow, existential, aesthetic, monotony.
- Tone: cold, direct, personal, cutting. No humour padding. Less "clever" than savage — more "cold/direct".
- Do NOT imply the subject should disappear, die, or not exist.
- Avoid hopelessness language (e.g. "hope isn't coming", "nothing will change", "no one would miss you").
- Focus on social humiliation and competence — brutal but not despair-driven.
- Avoid existential framing (ghost, invisible forever, nobody would notice, living ghost). These feel bleak, not brutal.
- Focus on awkwardness, misplaced confidence, try-hard energy, social incompetence.
- Brutal but comedic, not bleak. The goal is social humiliation, not existential sadness.
- Avoid "invisible/forgettable/nobody notices you" themes. Avoid lifeless/dead-eyed phrasing.
- No advice or commands. No imperatives (upgrade, fix, try, stop, learn, get, go, start).
- No questions. End with a short declarative verdict (<= 6 words).
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

  // JSON contamination
  for (const m of JSON_MARKERS) {
    if (text.includes(m)) { reasons.push(`json-marker:${m}`); break; }
  }

  // Banned soft/therapy language
  for (const phrase of BANNED_SOFT) {
    if (lower.includes(phrase)) { reasons.push(`banned:${phrase}`); break; }
  }

  // Length limits
  if (tierName === 'savage' && text.length > 120) reasons.push(`too-long:${text.length}/120`);
  if (tierName === 'nuclear' && text.length > 400) reasons.push(`too-long:${text.length}/400`);

  // Must reference a visible detail (hard-fail for savage, scoring penalty for nuclear)
  const hasVisual = VISUAL_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasVisual && tierName !== 'nuclear') reasons.push('no-visual-detail');

  // Savage-only validation (short nuclear — minimal bans, nuclear-level safety)
  if (tierName === 'savage') {
    const savageWordCount = text.trim().split(/\s+/).length;
    // 10–18 words
    if (savageWordCount > 18) reasons.push(`savage-too-many-words:${savageWordCount}/18`);
    if (savageWordCount < 10) reasons.push(`savage-too-few-words:${savageWordCount}/10`);
    // Exactly 1 sentence
    const sSentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    if (sSentences.length > 1) reasons.push(`savage-multi-sentence:${sSentences.length}`);
    // No questions
    if (text.includes('?')) reasons.push('savage-question');
    // No digits / count words
    if (/\d/.test(text)) reasons.push('savage-contains-digit');
    if (/\b(one|two|three|four|five|six|seven|eight|nine|ten|once|twice|thrice|times|couple|few|several)\b/i.test(text)) reasons.push('savage-count-word');
    // No imperative openers
    for (const s of sSentences) {
      const fw = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (SAVAGE_IMPERATIVES.includes(fw)) {
        reasons.push(`savage-imperative:${fw}`);
        break;
      }
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
    // Crutch phrases (AI-template phrasing)
    for (const crutch of SAVAGE_CRUTCHES) {
      if (lower.includes(crutch)) { reasons.push(`savage-crutch:${crutch}`); break; }
    }
    // Environment as punchline (env token in last 3 words)
    const last3 = text.trim().split(/\s+/).slice(-3).join(' ').toLowerCase().replace(/[^a-z\s]/g, '');
    if (SAVAGE_ENV_TOKENS.some(t => last3.includes(t))) reasons.push('savage-env-punchline');
    // Bleak/defeated language (savage-only, not nuclear list)
    for (const term of SAVAGE_BLEAK) {
      if (lower.includes(term)) { reasons.push(`savage-bleak:${term}`); break; }
    }
    // Comparative template patterns (keep faster/harder/brighter as hard rejects)
    if (/\bfaster\b.+\bthan\b/i.test(text)) reasons.push('savage-template:faster-than');
    if (/\bharder\b.+\bthan\b/i.test(text)) reasons.push('savage-template:harder-than');
    if (/\bbrighter\b.+\bthan\b/i.test(text)) reasons.push('savage-template:brighter-than');
    // No commas
    if (text.includes(',')) reasons.push('savage-comma');
    // Opener bans (start-of-sentence only)
    if (/^\s*you look like\b/i.test(text)) reasons.push('savage-opener:you-look-like');
    if (/^\s*with that\b/i.test(text)) reasons.push('savage-opener:with-that');
    if (/^\s*even your\b/i.test(text)) reasons.push('savage-opener:even-your');
    // Template: "auditioning for"
    if (/\bauditioning for\b/i.test(text)) reasons.push('savage-template:auditioning');
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

function scoreRoast(text, tierName, lane = null, { requiredExposure = null } = {}) {
  let score = 50;
  const lower = text.toLowerCase();

  // Reward: contains visual keyword (capped lower for nuclear — anchor matters, shouldn't dominate)
  const visualHits = VISUAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
  score += Math.min(visualHits, 2) * (tierName === 'nuclear' ? 5 : 10);

  // Reward: brevity (closer to target = better)
  const targetLen = tierName === 'savage' ? 80 : tierName === 'nuclear' ? 220 : 250;
  const lenDiff = Math.abs(text.length - targetLen);
  // Gentler curve for nuclear so punchy 45-word nukes aren't crushed
  score -= Math.floor(lenDiff / (tierName === 'nuclear' ? 25 : 15));

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
  if (tierName === 'savage' && sentenceCount > 1) score -= 15;
  if (tierName === 'nuclear' && sentenceCount > 4) score -= 10;

  // --- Savage-specific scoring (short nuclear) ---
  if (tierName === 'savage') {
    const words = text.trim().split(/\s+/);
    const wordCount = words.length;
    const lastWord = words[words.length - 1]?.toLowerCase().replace(/[^a-z-]/g, '') || '';

    // Word count sweet spot
    if (wordCount >= 10 && wordCount <= 14) score += 15;
    else if (wordCount >= 15 && wordCount <= 18) score += 5;
    if (wordCount > 18) score -= 30;
    if (wordCount < 10) score -= 20;

    // Reward: direct address ("you" / "your")
    if (/\byou(r|'re|'ve|'ll)?\b/.test(lower)) score += 10;
    else score -= 15;

    // Reward: punch verdict ending
    if (SAVAGE_PUNCH_ENDINGS.includes(lastWord)) score += 15;
    // Penalize: neutral filler ending
    const neutralEndings = ['the', 'a', 'an', 'it', 'is', 'was', 'and', 'but', 'or', 'of', 'to', 'in', 'on', 'for', 'that', 'this', 'with'];
    if (neutralEndings.includes(lastWord)) score -= 10;

    // Reward: visual detail present
    if (VISUAL_KEYWORDS.some(kw => lower.includes(kw))) score += 10;

    // Reward: ego/status hit language
    const statusWords = ['confidence', 'competence', 'embarrassing', 'pathetic', 'delusional',
      'overconfident', 'awkward', 'desperate', 'audacity', 'delusion', 'fraud', 'cringe',
      'performing', 'pretending', 'rehearsed', 'fronting', 'bravado', 'try-hard', 'tryhard'];
    if (statusWords.some(w => lower.includes(w))) score += 10;

    // Reward: ends with punctuation
    if (/[.!]$/.test(text.trim())) score += 5;

    // Penalize: repeated punch ending across recent outputs
    if (lastWord) {
      const recentEndings = recentSavageRoasts.slice(-5).map(r => {
        const rw = r.replace(/[^a-z\s-]/g, '').trim().split(/\s+/);
        return rw[rw.length - 1] || '';
      });
      const endingRepeats = recentEndings.filter(e => e === lastWord).length;
      if (endingRepeats >= 2) score -= 30;
      else if (endingRepeats === 1) score -= 15;
    }

    // Penalize: too similar to recent savage outputs
    for (const prev of recentSavageRoasts) {
      if (tokenOverlap(text, prev) > 0.5) { score -= 30; break; }
    }

    // Anchor tracking: force rotation across last 5
    const anchor = detectSavageAnchor(text);
    const last5Anchors = recentSavageAnchors.slice(-5);
    const last2Anchors = last5Anchors.slice(-2);
    // Same anchor as any of last 2 roasts
    if (last2Anchors.includes(anchor)) score -= 40;
    // Same anchor appears 3+ times in last 5
    if (last5Anchors.filter(a => a === anchor).length >= 3) score -= 60;

    // Structure tracking: penalize repeated structures
    const structure = detectSavageStructure(text);
    const last2Structs = recentSavageStructures.slice(-2);
    if (structure !== 'direct-verdict' && last2Structs.includes(structure)) score -= 20;

    // Penalize: no direct address at all
    if (!/\byou(r|'re|'ve|'ll)?\b/.test(lower)) score -= 20;

    // Penalize: env-only (env tokens but no personal anchor) — allowed if YOU anchor exists
    const hasEnvToken = SAVAGE_ENV_TOKENS.some(t => lower.includes(t));
    const hasPersonalAnchor = SAVAGE_PERSONAL_ANCHORS.some(t => lower.includes(t));
    if (hasEnvToken && !hasPersonalAnchor && !/\byou(r|'re|'ve|'ll)?\b/.test(lower)) score -= 25;

    // Penalize: "screams" crutch
    if (/\bscream(s|ing|ed)?\b/i.test(text)) score -= 15;

    // Penalize: "more...than" comparative — heavier if repeated structure
    if (/\bmore\b.+\bthan\b/i.test(text)) {
      score -= (last2Structs.includes(structure) ? 20 : 10);
    }

    // Tie-breaker
    score -= text.length % 7;
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
    }

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

    // Short-term anchor repetition pressure
    const candidateAnchors = NUCLEAR_ANCHOR_KEYWORDS.filter(kw => lower.includes(kw));
    // Count how many times each anchor appeared in recent winners
    const anchorFreq = {};
    for (const prevAnchors of recentNuclearAnchors) {
      for (const a of prevAnchors) { anchorFreq[a] = (anchorFreq[a] || 0) + 1; }
    }
    for (const a of candidateAnchors) {
      if ((anchorFreq[a] || 0) >= 2) { score -= 15; break; }
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
  { id: 'S01', tpl: 'You posted your {TARGET} and got {SOCIAL} muted instantly.' },
  { id: 'S02', tpl: 'You showed up with that {TARGET} and your {SOCIAL} went silent.' },
  { id: 'S03', tpl: 'You really posted your {TARGET} like {SOCIAL} wouldn\'t notice.' },
  { id: 'S04', tpl: 'You walked in with that {TARGET} and got archived from {SOCIAL}.' },
  { id: 'S05', tpl: 'You led with your {TARGET} and {SOCIAL} ratio\'d you on sight.' },
  { id: 'S06', tpl: 'You brought that {TARGET} and your {SOCIAL} is still recovering.' },
  { id: 'S07', tpl: 'Showed up with your {TARGET} and got reported on {SOCIAL}.' },
  { id: 'S08', tpl: 'You let your {TARGET} do the talking and {SOCIAL} hit mute.' },
  { id: 'S09', tpl: 'You tried posting your {TARGET} but {SOCIAL} already archived you.' },
  { id: 'S10', tpl: 'Got caught flexing your {TARGET} and {SOCIAL} went quiet.' },
  // "Served / Acting / Looking like" starters
  { id: 'S11', tpl: 'Serving rejected-draft energy with that {TARGET} — your {SOCIAL} moved on.' },
  { id: 'S12', tpl: 'Acting like your {TARGET} would carry you but {SOCIAL} said otherwise.' },
  { id: 'S13', tpl: 'Looking like your {TARGET} {CRITIQUE} — {SOCIAL} has receipts.' },
  { id: 'S14', tpl: 'Pulled up with your {TARGET} like {SOCIAL} wouldn\'t screenshot this.' },
  { id: 'S15', tpl: 'Tried to flex your {TARGET} but you got muted on {SOCIAL}.' },
  // Social consequence emphasis
  { id: 'S16', tpl: 'You posted your {TARGET} and {SOCIAL} reported you for spam.' },
  { id: 'S17', tpl: 'You chose that {TARGET} on purpose and {SOCIAL} chose to archive you.' },
  { id: 'S18', tpl: 'You walked in rocking your {TARGET} and your {SOCIAL} clocked out.' },
  { id: 'S19', tpl: 'You uploaded your {TARGET} and {SOCIAL} unfollowed in real time.' },
  { id: 'S20', tpl: 'Showed your {TARGET} to {SOCIAL} and got blocked on sight.' },
  // Platform-action starters
  { id: 'S21', tpl: 'Posted your {TARGET} to {SOCIAL} — comments disabled within seconds.' },
  { id: 'S22', tpl: 'You gave your {TARGET} a close-up and {SOCIAL} turned off notifications.' },
  { id: 'S23', tpl: 'Brought your {TARGET} to {SOCIAL} and got ratio\'d before loading.' },
  { id: 'S24', tpl: 'You committed to that {TARGET} and {SOCIAL} committed to muting you.' },
  { id: 'S25', tpl: 'You showed your {TARGET} and {SOCIAL} archived you mid-scroll.' },
  // Escalation combos (still accusation-first)
  { id: 'S26', tpl: 'You hit upload on your {TARGET} and {SOCIAL} {CRITIQUE}.' },
  { id: 'S27', tpl: 'You doubled down on your {TARGET} — even {SOCIAL} {CRITIQUE}.' },
  { id: 'S28', tpl: 'Got caught posting your {TARGET} and {SOCIAL} hasn\'t recovered.' },
  { id: 'S29', tpl: 'You made your {TARGET} everyone\'s problem — {SOCIAL} is filing reports.' },
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
  'is on its last software update', 'bricked on arrival',
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
  'Your confidence did not read the room before entering.',
  'This photo has the energy of a cover letter nobody asked for.',
  'Bold strategy going with this look. Bold, not effective.',
  'You posed like you rehearsed this. The rehearsal needed rehearsal.',
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
const NV2_SOCIAL_CONTEXT_TERMS = [
  { term: 'group chat', weight: 0.25 },
  { term: 'timeline', weight: 1 },
  { term: 'comments', weight: 1 },
  { term: 'close friends', weight: 1 },
  { term: 'story', weight: 1 },
  { term: 'For You page', weight: 1 },
  { term: 'Discord', weight: 1 },
  { term: 'Slack', weight: 1 },
  { term: 'LinkedIn feed', weight: 1 },
  { term: 'Reddit thread', weight: 1 },
  { term: 'the replies', weight: 1 },
  { term: 'quote-tweets', weight: 1 },
  { term: 'archive', weight: 1 },
  { term: 'drafts', weight: 1 },
  { term: 'camera roll', weight: 1 },
  { term: 'notifications', weight: 1 },
  { term: 'DMs', weight: 1 },
  { term: 'IG story', weight: 1 },
  { term: 'TikTok comments', weight: 1 },
  { term: 'HR', weight: 1 },
  { term: 'the algorithm', weight: 1 },
];
const NV2_MAX_RECENT_SOCIAL = 5;

function nv2PickSocialContext(clientId) {
  const st = getClientState(clientId);
  const avoid = new Set(st.recentSocialContexts.slice(-NV2_MAX_RECENT_SOCIAL));
  // Hard rule: never "group chat" if used in last 3
  const groupChatRecent = st.recentSocialContexts.slice(-3).filter(t => t === 'group chat').length;

  for (let i = 0; i < 10; i++) {
    // Weighted random pick
    const totalW = NV2_SOCIAL_CONTEXT_TERMS.reduce((s, t) => s + t.weight, 0);
    let r = Math.random() * totalW;
    let pick = NV2_SOCIAL_CONTEXT_TERMS[0].term;
    for (const entry of NV2_SOCIAL_CONTEXT_TERMS) {
      r -= entry.weight;
      if (r <= 0) { pick = entry.term; break; }
    }
    if (avoid.has(pick)) continue;
    if (pick === 'group chat' && groupChatRecent >= 1) continue;
    st.recentSocialContexts.push(pick);
    if (st.recentSocialContexts.length > 10) st.recentSocialContexts.shift();
    return pick;
  }
  // Fallback: pick anything not in last 3
  const fallbacks = NV2_SOCIAL_CONTEXT_TERMS.filter(t => !avoid.has(t.term));
  const fb = fallbacks.length > 0 ? fallbacks[Math.floor(Math.random() * fallbacks.length)].term : 'timeline';
  st.recentSocialContexts.push(fb);
  if (st.recentSocialContexts.length > 10) st.recentSocialContexts.shift();
  return fb;
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
  if (!st.lastSentenceStarter) st.lastSentenceStarter = null;
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

async function nv2ExtractSceneNouns(imageBase64) {
  const isDev = process.env.NODE_ENV !== 'production';
  try {
    const resp = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'system', content: 'You list concrete objects/background elements in photos. Output ONLY a JSON array of 6–12 short nouns (1–2 words each). No people/body attributes. Example: ["monitor","keyboard","LED strip","posters","desk"]' },
        { role: 'user', content: [
          { type: 'input_text', text: 'List 6–12 concrete objects or background elements visible in this photo as short nouns (1–2 words each). No people or body attributes. JSON array only.' },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
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
const NV2_SELFIE_TAG_ALLOWED_ANGLES = new Set(['low angle','high angle','straight-on','tilted','off-center']);
const NV2_SELFIE_TAG_ALLOWED_LIGHTING = new Set(['dim','harsh','backlit','screen glow','bright','mixed']);
const NV2_SELFIE_TAG_ALLOWED_FRAMING = new Set(['close crop','too far','awkward crop','centered']);
const NV2_SELFIE_TAG_ALLOWED_POSE = new Set(['stiff','forced casual','over-serious','trying-to-look-cool','deadpan']);
const NV2_SELFIE_TAG_ALLOWED_HAIR = new Set([
  'messy','greasy','flat','overgrown','slicked','helmet hair',
  'bed head','windswept','frizzy','unkempt','freshly cut',
  'dyed','parted','buzzed'
]);
const NV2_SELFIE_TAG_ALLOWED_OUTFIT = new Set([
  'wrinkled','oversized','too tight','mismatched','graphic tee',
  'athleisure','pajamas','formal','layered','plain',
  'branded','vintage','basic','gym clothes','uniform'
]);
const NV2_SELFIE_TAG_ALLOWED_EXPRESSION = new Set([
  'blank','smug','confused','bored','forced smile',
  'duck face','squinting','surprised','zoned out','intense',
  'unbothered','cringe','awkward grin','side-eye','pouty'
]);
const NV2_SELFIE_TAG_ALLOWED_GROOMING = new Set([
  'unshaved','over-groomed','low-effort',
  'freshly trimmed','scraggly','clean-shaven','five-o-clock shadow',
  'peach fuzz','handlebar','soul patch'
]);
const NV2_SELFIE_TAG_ALLOWED_BG_VIBE = new Set([
  'cluttered','sterile','chaotic','bare','staged',
  'dingy','flex-heavy','trying too hard','lived-in',
  'fluorescent','grim','corporate','basement'
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

async function extractSafeSelfieTags(imageInput) {
  const isDev = process.env.NODE_ENV !== 'production';
  const emptyResult = { objects: [], angle: null, lighting: null, framing: null, setting: null, pose: null, hair: null, outfit: null, expression: null, grooming: null, bg_vibe: null };
  try {
    const resp = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'system', content: 'You analyze photos for safe visual qualities only. Output ONLY valid JSON. Never mention identity, race, gender, age, body size, attractiveness, or protected traits. Never mention nudity or sexual content.' },
        { role: 'user', content: [
          { type: 'input_text', text: 'Look at the image. Output ONLY valid JSON matching this schema: {"objects":[],"angle":null,"lighting":null,"framing":null,"setting":null,"pose":null,"hair":null,"outfit":null,"expression":null,"grooming":null,"bg_vibe":null}. objects: 0-12 nouns (monitor, keyboard, desk, tools, etc.). angle: one of "low angle","high angle","straight-on","tilted","off-center" or null. lighting: one of "dim","harsh","backlit","screen glow","bright","mixed" or null. framing: one of "close crop","too far","awkward crop","centered" or null. setting: short label like "garage","bedroom","office","outdoors","plain wall" or null. pose: one of "stiff","forced casual","over-serious","trying-to-look-cool","deadpan" or null. hair: one of "messy","greasy","flat","overgrown","slicked","helmet hair","bed head","windswept","frizzy","unkempt","freshly cut","dyed","parted","buzzed" or null. outfit: one of "wrinkled","oversized","too tight","mismatched","graphic tee","athleisure","pajamas","formal","layered","plain","branded","vintage","basic","gym clothes","uniform" or null. expression: one of "blank","smug","confused","bored","forced smile","duck face","squinting","surprised","zoned out","intense","unbothered","cringe","awkward grin","side-eye","pouty" or null. grooming: one of "unshaved","over-groomed","low-effort","freshly trimmed","scraggly","clean-shaven","five-o-clock shadow","peach fuzz","handlebar","soul patch" or null. bg_vibe: one of "cluttered","sterile","chaotic","bare","staged","dingy","flex-heavy","trying too hard","lived-in","fluorescent","grim","corporate","basement" or null. Only describe visible objects and SAFE photo/style qualities. Do NOT mention identity, race, gender, age, body size, attractiveness, or protected traits. Do NOT mention nudity/sexual content. If unsure, use null or empty arrays.' },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${imageInput}` },
        ]},
      ],
      max_output_tokens: 300,
      temperature: 0.2,
    });
    const raw = (resp.output_text || '').trim();
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Filter objects: keep only safe nouns
    const objects = (Array.isArray(parsed.objects) ? parsed.objects : [])
      .map(s => String(s).trim().toLowerCase())
      .filter(s => s.length >= 2 && s.length <= 30)
      .filter(s => !NV2_SELFIE_TAG_OBJECT_DENYLIST.has(s) && !NV2_SELFIE_TAG_OBJECT_DENYLIST.has(s.split(/\s+/)[0]))
      .slice(0, 12);

    // Validate enum fields
    const angle = typeof parsed.angle === 'string' && NV2_SELFIE_TAG_ALLOWED_ANGLES.has(parsed.angle.toLowerCase()) ? parsed.angle.toLowerCase() : null;
    const lighting = typeof parsed.lighting === 'string' && NV2_SELFIE_TAG_ALLOWED_LIGHTING.has(parsed.lighting.toLowerCase()) ? parsed.lighting.toLowerCase() : null;
    const framing = typeof parsed.framing === 'string' && NV2_SELFIE_TAG_ALLOWED_FRAMING.has(parsed.framing.toLowerCase()) ? parsed.framing.toLowerCase() : null;
    const pose = typeof parsed.pose === 'string' && NV2_SELFIE_TAG_ALLOWED_POSE.has(parsed.pose.toLowerCase()) ? parsed.pose.toLowerCase() : null;
    const setting = typeof parsed.setting === 'string' && parsed.setting.length <= 30 ? parsed.setting.toLowerCase().trim() : null;
    const hair = typeof parsed.hair === 'string' && NV2_SELFIE_TAG_ALLOWED_HAIR.has(parsed.hair.toLowerCase()) ? parsed.hair.toLowerCase() : null;
    const outfit = typeof parsed.outfit === 'string' && NV2_SELFIE_TAG_ALLOWED_OUTFIT.has(parsed.outfit.toLowerCase()) ? parsed.outfit.toLowerCase() : null;
    const expression = typeof parsed.expression === 'string' && NV2_SELFIE_TAG_ALLOWED_EXPRESSION.has(parsed.expression.toLowerCase()) ? parsed.expression.toLowerCase() : null;
    const grooming = typeof parsed.grooming === 'string' && NV2_SELFIE_TAG_ALLOWED_GROOMING.has(parsed.grooming.toLowerCase()) ? parsed.grooming.toLowerCase() : null;
    const bg_vibe = typeof parsed.bg_vibe === 'string' && NV2_SELFIE_TAG_ALLOWED_BG_VIBE.has(parsed.bg_vibe.toLowerCase()) ? parsed.bg_vibe.toLowerCase() : null;

    return { objects, angle, lighting, framing, setting, pose, hair, outfit, expression, grooming, bg_vibe };
  } catch (err) {
    if (isDev) console.log(`[nuclear-v2] selfie-tags error: ${err.message}`);
    return emptyResult;
  }
}

// --- Modifier-phrase structure templates (use {MODIFIER} and {ESCALATION}) ---
// These REQUIRE modifierPhrase. 1–2 sentences, screenshot-friendly, no questions.
const NV2_MODIFIER_TEMPLATES = [
  { id: 'M01', tpl: 'You really went {MODIFIER} and posted to {SOCIAL} like nobody would notice.' },
  { id: 'M02', tpl: 'You chose {MODIFIER} on purpose and your {SOCIAL} archived you instantly.' },
  { id: 'M03', tpl: 'You committed to {MODIFIER} and {SOCIAL} committed to muting you.' },
  { id: 'M04', tpl: 'You hit upload going {MODIFIER} — {SOCIAL} reported you on sight.' },
  { id: 'M05', tpl: 'You went {MODIFIER} like it was a flex and {SOCIAL} ratio\'d you.' },
  { id: 'M06', tpl: 'Showed up {MODIFIER} and your {SOCIAL} went completely silent.' },
  { id: 'M07', tpl: 'You posted yourself {MODIFIER} and {SOCIAL} turned off notifications.' },
  { id: 'M08', tpl: 'Shot this {MODIFIER} and thought {SOCIAL} would be impressed.' },
  { id: 'M09', tpl: 'You leaned into {MODIFIER} and {SOCIAL} unfollowed in real time.' },
  { id: 'M10', tpl: 'Got caught going {MODIFIER} — your {SOCIAL} has screenshots.' },
  { id: 'M11', tpl: 'You doubled down on {MODIFIER} and {SOCIAL} blocked you mid-scroll.' },
  { id: 'M12', tpl: 'Tried {MODIFIER} like your {SOCIAL} wouldn\'t notice the difference.' },
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
  if (wc < 3) return false;
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
    const socialFeedContexts = /\b(feed|story|stories|replies|comments|DMs|posted|upload)\b/i;
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

// --- Main Nuclear V2 generator ---
async function generateNuclearV2({ clientId = 'anon', imageBase64, dynamicTargets = [], selfieTags = null }) {
  const isDev = process.env.NODE_ENV !== 'production';
  const state = getClientState(clientId);
  const maxAttempts = 3;
  let attempts = 0;
  let fallbackUsed = false;
  let pickedTarget = null;
  let pickedStructure = null;
  let pickedOpenerType = null;
  let finalRoast = null;
  let wordCount = 0;
  let truncationApplied = false;
  let targetFromScene = false;
  let minWordRetry = false;
  let targetSource = 'base'; // 'base', 'scene', 'tags'
  let modifierUsed = null;
  let sceneTargetsAfterFilter = 0;
  let micdropUsed = false;
  let micdropText = null;
  let micdropReplacedSentence2 = false;
  let punchlineUsed = false;
  let punchlineText = null;

  // Build enriched dynamic targets from selfie tags if available
  const tags = selfieTags || { objects: [], angle: null, lighting: null, framing: null, setting: null, pose: null, hair: null, outfit: null, expression: null, grooming: null, bg_vibe: null };

  // Apply enhanced scene-noun filtering to dynamicTargets
  const filteredSceneTargets = nv2FilterSceneNouns(dynamicTargets);
  sceneTargetsAfterFilter = filteredSceneTargets.length;

  const tagDynamicTargets = [...filteredSceneTargets];
  if (tags.objects.length > 0) {
    for (const obj of tags.objects) {
      if (!tagDynamicTargets.includes(obj)) tagDynamicTargets.push(obj);
    }
  }
  if (tags.angle) tagDynamicTargets.push('camera angle');
  if (tags.lighting) tagDynamicTargets.push('lighting choice');
  if (tags.setting && !tagDynamicTargets.includes(tags.setting)) tagDynamicTargets.push(tags.setting);

  // Build selfie-attribute target pools: primary (personal) vs bgVibe
  const _primaryPool = new Set();
  const _bgVibePool = new Set();
  if (tags.hair)       { _primaryPool.add('hair'); _primaryPool.add(tags.hair + ' hair'); }
  if (tags.outfit)     { _primaryPool.add('outfit'); _primaryPool.add(tags.outfit + ' fit'); }
  if (tags.expression) { _primaryPool.add('expression'); _primaryPool.add(tags.expression + ' look'); }
  if (tags.pose)       { _primaryPool.add('pose'); _primaryPool.add(tags.pose + ' pose'); }
  if (tags.grooming)   { _primaryPool.add('grooming'); _primaryPool.add(tags.grooming + ' grooming'); }
  if (tags.bg_vibe)    { _bgVibePool.add(tags.bg_vibe + ' vibe'); }
  const selfieAttrPrimary = [..._primaryPool];
  const selfieAttrBgVibe = [..._bgVibePool];
  const selfieAttrTargets = [...selfieAttrPrimary, ...selfieAttrBgVibe];

  // Two-pool picker: <=15% bgVibe when primary exists
  function nv2PickWeightedSelfieAttr(recentList) {
    const avoidSet = new Set(recentList.slice(-NV2_AVOID_LAST_N));
    let pool;
    if (selfieAttrPrimary.length > 0 && selfieAttrBgVibe.length > 0) {
      pool = Math.random() < 0.87 ? selfieAttrPrimary : selfieAttrBgVibe;
    } else {
      pool = selfieAttrTargets;
    }
    const candidates = pool.filter(t => !avoidSet.has(t));
    const pick = candidates.length > 0 ? candidates : pool;
    return pick[Math.floor(Math.random() * pick.length)];
  }
  if (isDev && selfieAttrTargets.length > 0) {
    console.log(`[nuclear-v2] selfieAttrTargets primary=${selfieAttrPrimary.length} bgVibe=${selfieAttrBgVibe.length} total=${selfieAttrTargets.length}`);
  }

  // Build modifier phrase from selfie tags (always pick up to 2 parts)
  const modifierParts = [tags.angle, tags.lighting, tags.framing, tags.pose, tags.setting].filter(Boolean);
  const hasHighPriorityModifier = !!(tags.framing || tags.lighting);
  let modifierPhrase = null;
  if (modifierParts.length > 0) {
    // If framing or lighting present, always include at least one of them
    let picked = [];
    if (hasHighPriorityModifier) {
      const priority = [tags.framing, tags.lighting].filter(Boolean);
      picked.push(priority[Math.floor(Math.random() * priority.length)]);
      const remaining = modifierParts.filter(p => p !== picked[0]);
      if (remaining.length > 0) {
        picked.push(remaining[Math.floor(Math.random() * remaining.length)]);
      }
    } else {
      const shuffled = [...modifierParts].sort(() => Math.random() - 0.5);
      picked = shuffled.slice(0, 2);
    }
    modifierPhrase = picked.join(', ');
  }

  let lastAttemptOpenerType = null; // tracks opener across attempts within this request
  while (attempts < maxAttempts) {
    attempts++;

    // 1. Decide template pool:
    //    - If framing or lighting tags exist → always use modifier template
    //    - If any modifier phrase exists → 75% chance modifier template
    //    - Else → standard templates
    //    - Never MODIFIER twice in a row (across requests OR across attempts)
    const forceModifier = modifierPhrase && hasHighPriorityModifier;
    const lastOpener = state.recentOpenerTypes.length > 0 ? state.recentOpenerTypes[state.recentOpenerTypes.length - 1] : null;
    const modifierBlockedByPrevAttempt = lastAttemptOpenerType === 'MODIFIER';
    if (modifierBlockedByPrevAttempt && isDev) console.log(`[nuclear-v2] forcing standard pool (prev attempt was MODIFIER)`);
    const useModifierTpl = modifierPhrase && (forceModifier || Math.random() < 0.75) && lastOpener !== 'MODIFIER' && !modifierBlockedByPrevAttempt;

    let structure;
    if (useModifierTpl) {
      // Pick from modifier templates with avoidance
      structure = nv2SelectWithAvoidance(NV2_MODIFIER_TEMPLATES, state.recentStructures, NV2_MAX_SELECT_TRIES);
    } else {
      // Select structure with weighted scoring + opener diversity + 2-sentence bias
      //    ~80% chance pick from 2-sentence templates, 20% allow any
      const prefer2Sent = Math.random() < 0.8;
      const structPool = prefer2Sent
        ? NV2_STRUCTURE_TEMPLATES.filter(t => NV2_TWO_SENTENCE_IDS.has(t.id))
        : NV2_STRUCTURE_TEMPLATES;
      const effectivePool = structPool.length > 0 ? structPool : NV2_STRUCTURE_TEMPLATES;

      const avoidOpeners = new Set(state.recentOpenerTypes.slice(-2));
      const avoidStructs = new Set(state.recentStructures.slice(-NV2_AVOID_LAST_N));
      structure = null;
      for (let t = 0; t < 10; t++) {
        const candidate = nv2WeightedStructurePick(effectivePool, avoidStructs);
        const ot = nv2GetOpenerType(candidate.tpl);
        if (!avoidOpeners.has(ot) || t === 9) {
          structure = candidate;
          break;
        }
      }
      if (!structure) structure = nv2WeightedStructurePick(effectivePool, new Set());
    }

    // 1b. Target selection — 4-tier with selfie attr bias when available
    //    selfieAttrTargets non-empty: 55% selfie attr, 20% scene, 15% tags, 10% base
    //    selfieAttrTargets empty:     45% scene, 35% tags, 20% base (original)
    let target;
    targetSource = 'base';
    targetFromScene = false;
    const roll = Math.random();
    const hasSelfieAttrs = selfieAttrTargets.length > 0;
    const primaryCount = selfieAttrPrimary.length;
    if (hasSelfieAttrs && roll < 0.55) {
      target = nv2PickWeightedSelfieAttr(state.recentTargets);
      targetSource = 'selfie_attr';
    } else if (filteredSceneTargets.length > 0 && roll < (hasSelfieAttrs ? 0.75 : 0.45)) {
      target = nv2SelectWithAvoidance(filteredSceneTargets, state.recentTargets, NV2_MAX_SELECT_TRIES);
      targetSource = 'scene';
      targetFromScene = true;
    } else if (tags.objects.length > 0 && roll < (hasSelfieAttrs ? 0.90 : 0.80)) {
      target = nv2SelectWithAvoidance(tagDynamicTargets, state.recentTargets, NV2_MAX_SELECT_TRIES);
      targetSource = 'tags';
      targetFromScene = true;
    } else {
      target = nv2SelectWithAvoidance(NV2_TARGET_BUCKET, state.recentTargets, NV2_MAX_SELECT_TRIES);
    }
    // 1b2. Block "lighting choice" when primary selfie attrs exist
    if (target.toLowerCase() === 'lighting choice' && primaryCount > 0) {
      if (isDev) console.log(`[nuclear-v2] targetBlocked=lighting choice reason=primarySelfieAttrsPresent primaryCount=${primaryCount}`);
      target = nv2PickWeightedSelfieAttr(state.recentTargets);
      targetSource = 'selfie_attr';
    }
    // 1c. Non-roastable target guard: re-pick if target is environment-only
    if (NV2_NON_ROASTABLE_TARGETS.has(target.toLowerCase())) {
      if (isDev) console.log(`[nuclear-v2] nonRoastableTargetFiltered=true target="${target}"`);
      if (selfieAttrTargets.length > 0) {
        target = nv2PickWeightedSelfieAttr(state.recentTargets);
        targetSource = 'selfie_attr';
      } else {
        const roastableTagObjects = tags.objects.filter(o => !NV2_NON_ROASTABLE_TARGETS.has(o.toLowerCase()));
        if (roastableTagObjects.length > 0) {
          target = nv2SelectWithAvoidance(roastableTagObjects, state.recentTargets, NV2_MAX_SELECT_TRIES);
          targetSource = 'tags';
        } else {
          target = nv2SelectWithAvoidance(NV2_TARGET_BUCKET, state.recentTargets, NV2_MAX_SELECT_TRIES);
          targetSource = 'base';
          targetFromScene = false;
        }
      }
    }
    // 1d. Context-only object guard: re-pick if target is clutter that shouldn't be the main subject
    if (NV2_CONTEXT_ONLY_OBJECTS.has(target.toLowerCase()) && (targetSource === 'scene' || targetSource === 'tags')) {
      if (isDev) console.log(`[nuclear-v2] contextOnlyTargetFiltered=true target="${target}"`);
      const usableTagObjects = tags.objects.filter(o =>
        !NV2_CONTEXT_ONLY_OBJECTS.has(o.toLowerCase()) && !NV2_NON_ROASTABLE_TARGETS.has(o.toLowerCase())
      );
      const sceneAllowable = ['monitor', 'keyboard', 'car', 'laptop', 'phone', 'headphones', 'microphone'];
      const usableScene = filteredSceneTargets.filter(o =>
        !NV2_CONTEXT_ONLY_OBJECTS.has(o.toLowerCase()) && !NV2_NON_ROASTABLE_TARGETS.has(o.toLowerCase())
      );
      if (usableTagObjects.length > 0) {
        target = nv2SelectWithAvoidance(usableTagObjects, state.recentTargets, NV2_MAX_SELECT_TRIES);
        targetSource = 'tags';
      } else if (usableScene.length > 0) {
        target = nv2SelectWithAvoidance(usableScene, state.recentTargets, NV2_MAX_SELECT_TRIES);
        targetSource = 'scene';
      } else {
        target = nv2SelectWithAvoidance(NV2_TARGET_BUCKET, state.recentTargets, NV2_MAX_SELECT_TRIES);
        targetSource = 'base';
        targetFromScene = false;
      }
    }

    const critique = NV2_CRITIQUE_BUCKET[Math.floor(Math.random() * NV2_CRITIQUE_BUCKET.length)];
    const escalation = NV2_ESCALATION_BUCKET[Math.floor(Math.random() * NV2_ESCALATION_BUCKET.length)];

    pickedStructure = structure;
    pickedTarget = target;
    pickedOpenerType = useModifierTpl ? 'MODIFIER' : nv2GetOpenerType(structure.tpl);
    lastAttemptOpenerType = pickedOpenerType;
    modifierUsed = useModifierTpl ? modifierPhrase : null;

    // 2. Pick social context (before skeleton so {SOCIAL} can be injected)
    const socialContext = nv2PickSocialContext(clientId);
    if (isDev) console.log(`[nuclear-v2] socialContext="${socialContext}"`);

    // 2a. Assemble skeleton
    let skeleton = structure.tpl
      .replace('{TARGET}', target)
      .replace('{CRITIQUE}', critique)
      .replace('{ESCALATION}', escalation)
      .replace('{MODIFIER}', modifierPhrase || target)
      .replace(/\{SOCIAL\}/g, socialContext);

    // 2a2. Scene punchline injection: if target comes from scene or setting matches,
    //       50% chance to splice a punchline fragment into sentence 1
    punchlineUsed = false;
    punchlineText = null;
    const settingLower = (tags.setting || '').toLowerCase();
    const triggerPunchline = targetSource === 'scene' ||
      settingLower.includes('garage') || settingLower.includes('outdoor') || settingLower.includes('office');
    if (triggerPunchline && Math.random() < 0.5) {
      // Find matching punchlines: check target, then setting
      const targetLower = target.toLowerCase();
      let punchlines = NV2_SCENE_PUNCHLINES[targetLower] || null;
      if (!punchlines) {
        for (const key of Object.keys(NV2_SCENE_PUNCHLINES)) {
          if (targetLower.includes(key) || settingLower.includes(key)) {
            punchlines = NV2_SCENE_PUNCHLINES[key];
            break;
          }
        }
      }
      if (punchlines && punchlines.length > 0) {
        const frag = punchlines[Math.floor(Math.random() * punchlines.length)];
        // Inject fragment into end of sentence 1 (before the period)
        const skelSents = skeleton.match(/[^.!?]*[.!?]+/g);
        if (skelSents && skelSents.length >= 1) {
          const s1Base = skelSents[0].replace(/[.!?]+$/, '').trim();
          const rest = skelSents.slice(1).map(s => s.trim()).join(' ');
          skeleton = s1Base + ' \u2014 ' + frag + '.' + (rest ? ' ' + rest : '');
        } else {
          skeleton = skeleton.replace(/[.!?]+$/, '').trim() + ' \u2014 ' + frag + '.';
        }
        punchlineUsed = true;
        punchlineText = frag;
        if (isDev) console.log(`[nuclear-v2] punchlineInjected="${frag}" target="${target}" setting="${tags.setting || 'none'}"`);
      }
    }

    // 2b. Pre-rewrite skeleton length check: if skeleton is extremely short (<10 words),
    //     append an escalation fragment BEFORE sending to rewriter to avoid refusal on tiny input
    let skeletonTooShortAdjusted = false;
    const skeletonWc = skeleton.split(/\s+/).length;
    if (skeletonWc < 10) {
      const extraEsc = NV2_ESCALATION_BUCKET[Math.floor(Math.random() * NV2_ESCALATION_BUCKET.length)];
      const base = skeleton.replace(/[.!?]+$/, '').trim();
      skeleton = base + '. ' + extraEsc + '.';
      skeletonTooShortAdjusted = true;
      if (isDev) console.log(`[nuclear-v2] skeletonTooShortAdjusted=true (was ${skeletonWc} words, appended "${extraEsc}")`);
    }

    // 2c. Micdrop decision: always use a micdrop ending (nuclear = every roast gets one)
    const micdropLane = nv2DetectMicdropLane(target, tags.setting, tags.angle, tags.lighting, tags.pose);
    let chosenMicdrop = nv2SelectMicdrop(clientId, micdropLane);
    // Fallback to nuclear meme pool if main pool returned a banned entry
    if (!chosenMicdrop || nv2HasBannedPatterns(chosenMicdrop)) {
      const nucPool = NV2_MICDROPS_NUCLEAR;
      chosenMicdrop = nucPool[Math.floor(Math.random() * nucPool.length)];
    }

    if (isDev) console.log(`[nuclear-v2] attempt=${attempts} opener=${pickedOpenerType} micdrop=${chosenMicdrop ? '"' + chosenMicdrop + '"' : 'none'} skeleton="${skeleton}"`);

    // 3. GPT polish (rewrite-only, no new ideas)
    //    Build a facts block so the model stays faithful to extracted tags
    const allowedObjects = [...filteredSceneTargets, ...tags.objects].filter(Boolean).slice(0, 8);
    const selfieCalloutStr = [
      tags.hair       ? `hair: ${tags.hair}` : null,
      tags.outfit     ? `outfit: ${tags.outfit}` : null,
      tags.expression ? `expression: ${tags.expression}` : null,
      tags.pose       ? `pose: ${tags.pose}` : null,
      tags.grooming   ? `grooming: ${tags.grooming}` : null,
      tags.bg_vibe    ? `bg_vibe: ${tags.bg_vibe}` : null,
    ].filter(Boolean).join(', ');
    const factsBlock = `HARD CONSTRAINTS (do not contradict):\n- Target: "${target}"\n- Modifier: ${modifierUsed || 'none'}\n- Lighting: ${tags.lighting || 'unknown'}\n- Angle: ${tags.angle || 'unknown'}\n- Setting: ${tags.setting || 'unknown'}\n- SocialContext: "${socialContext}" (use THIS term for the status hit — do not substitute another)\n- SelfieCallouts: ${selfieCalloutStr || 'none'}\n- Allowed objects: [${allowedObjects.map(o => '"' + o + '"').join(', ')}]\nDo NOT contradict these facts (e.g. do not say "off-center" if modifier says "centered"; do not say "dark" if lighting is "bright"). Do NOT invent objects not in the allowed list. If SelfieCallouts are available, PREFER referencing one in the visual callout. If unsure, restate neutrally.`;

    const NV2_POLISH_BANS = `Do NOT use these phrases: "confidence was a mistake", "evidence submitted", "read that back", "try again", "impact: none", "confirmed on arrival". Do NOT start with: "With that", "Your vibe", "Your expression", "It's giving". No softeners: kind of, maybe, a bit, low-key. No advice. No kindness. No questions. Do NOT reference body shape, weight, height, skin, facial features, or physical attributes. Roast CHOICES (hair style, outfit, expression, pose, grooming), not the person's body.`;

    let polishPrompt;
    let polishSystemMsg;
    if (chosenMicdrop) {
      // Extract first sentence from skeleton to form the rewrite input
      const skelSents = skeleton.match(/[^.!?]*[.!?]+/g);
      const sent1 = skelSents ? skelSents[0].trim() : skeleton.replace(/[.!?]+$/, '').trim() + '.';
      polishPrompt = `Rewrite ONLY sentence 1 into a NUCLEAR roast caption. Target: "${target}".\n\nSentence 1 rules:\n- 12–16 words.\n- Must NOT start with: In, With, This, That, Here, Your, I'm sorry, Sorry. Start with a direct verb or accusation (Posted, Walked in, Tried, Serving, Acting, Showed up, Got caught, Looking like, Pulled up).\n- Must include ONE specific visual callout from the facts. PRIORITIZE personal callouts (hair/outfit/expression/pose/grooming choice) over objects/setting when SelfieCallouts are available.\n- Must include a concrete platform consequence using the SocialContext term "${socialContext}": e.g. "${socialContext} muted", "archived from ${socialContext}", "reported on ${socialContext}".\n- Tone: savage, viral, screenshot-worthy. Direct accusation, not scene-setting.\n\nSentence 2: Keep EXACTLY as provided — do NOT change, remove, or paraphrase it. 2–6 words.\nOutput EXACTLY 2 sentences.\n\nNEVER REFUSE. NEVER APOLOGIZE. Never mention policy, safety, rules, guidelines, or being an AI. Do not use: "I'm sorry", "I can't", "I cannot", "unable to", "as an AI". If you feel constrained, roast ONLY neutral visible elements (lighting, angle, pose, clothes, furniture, room, background). Always output exactly 2 sentences.\n\n${NV2_POLISH_BANS}\nNo threats/hate/slurs. No protected-class insults. Google Play safe. Roast the styling/pose/outfit/grooming choice, not the person's body. Target decisions and effort, never anatomy or identity.\n\n${factsBlock}\n\nSentence 1: "${sent1}"\nSentence 2: "${chosenMicdrop}"`;
      polishSystemMsg = 'You are a ruthless social-media roast caption writer. Never refuse, never apologize, never mention being an AI. Output EXACTLY 2 sentences. Sentence 1: 12–16 words, starts with a verb/accusation (never In/With/This/That/Here/Your/Sorry), includes a visual callout and platform consequence. Sentence 2: the provided micdrop word-for-word, 2–6 words. If constrained, roast style choices (hair, outfit, expression, pose, grooming). Never roast body or identity. No quotes, no explanation, no markdown.';
    } else {
      polishPrompt = `Rewrite this roast into a NUCLEAR 2-sentence caption. Target: "${target}".\n\nSentence 1 rules:\n- 12–16 words.\n- Must NOT start with: In, With, This, That, Here, Your, I'm sorry, Sorry. Start with a direct verb or accusation (Posted, Walked in, Tried, Serving, Acting, Showed up, Got caught, Looking like, Pulled up).\n- Must include ONE specific visual callout from the facts. PRIORITIZE personal callouts (hair/outfit/expression/pose/grooming choice) over objects/setting when SelfieCallouts are available.\n- Must include a concrete platform consequence using the SocialContext term "${socialContext}": e.g. "${socialContext} muted", "archived from ${socialContext}", "reported on ${socialContext}".\n- Tone: savage, viral, screenshot-worthy. Direct accusation, not scene-setting.\n\nSentence 2: A short captionable micdrop (2–6 words). Meme energy. Think "Muted." or "Archived." or "Log off."\nOutput EXACTLY 2 sentences.\n\nNEVER REFUSE. NEVER APOLOGIZE. Never mention policy, safety, rules, guidelines, or being an AI. Do not use: "I'm sorry", "I can't", "I cannot", "unable to", "as an AI". If you feel constrained, roast ONLY neutral visible elements (lighting, angle, pose, clothes, furniture, room, background). Always output exactly 2 sentences.\n\n${NV2_POLISH_BANS}\nNo threats/hate/slurs. No protected-class insults. Google Play safe. Roast the styling/pose/outfit/grooming choice, not the person's body. Target decisions and effort, never anatomy or identity.\n\n${factsBlock}\n\nRoast: "${skeleton}"`;
      polishSystemMsg = 'You are a ruthless social-media roast caption writer. Never refuse, never apologize, never mention being an AI. Output EXACTLY 2 sentences. Sentence 1: 12–16 words, starts with a verb/accusation (never In/With/This/That/Here/Your/Sorry), includes a visual callout and platform consequence. Sentence 2: short meme micdrop, 2–6 words. If constrained, roast style choices (hair, outfit, expression, pose, grooming). Never roast body or identity. No quotes, no explanation, no markdown.';
    }

    let polished = chosenMicdrop
      ? skeleton.replace(/[.!?]+$/, '').trim() + '. ' + chosenMicdrop
      : skeleton; // fallback to skeleton if LLM fails
    let polishFailed = false;
    const polishOpts = {
      model: 'gpt-4o',
      input: [
        { role: 'system', content: polishSystemMsg },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: polishPrompt },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
          ],
        },
      ],
      max_output_tokens: 80,
      temperature: 0.7,
      top_p: 0.92,
    };
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      const polishResp = await openai.responses.create(polishOpts, { signal: ac.signal });
      clearTimeout(timer);
      if (polishResp.output_text) {
        polished = polishResp.output_text;
      }
    } catch (err) {
      if (isDev) console.log(`[nuclear-v2] polish LLM error: ${err.message}`);
      // One quick retry for transient/connection errors (not 4xx content errors)
      const isTransient = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
        err.name === 'AbortError' || (err.status && err.status >= 500);
      if (isTransient) {
        try {
          if (isDev) console.log(`[nuclear-v2] polish retry (transient)`);
          const ac2 = new AbortController();
          const timer2 = setTimeout(() => ac2.abort(), 8000);
          const retryResp = await openai.responses.create(
            { ...polishOpts, temperature: 0.4, max_output_tokens: 60 },
            { signal: ac2.signal }
          );
          clearTimeout(timer2);
          if (retryResp.output_text) {
            polished = retryResp.output_text;
          } else {
            polishFailed = true;
          }
        } catch (retryErr) {
          if (isDev) console.log(`[nuclear-v2] polish retry failed: ${retryErr.message}`);
          polishFailed = true;
        }
      } else {
        polishFailed = true;
      }
    }

    // 4. Clean output (enforce 1–2 sentences) + sanitize quotes
    let result = nv2SanitizeQuotes(nv2CleanOutput(polished));
    if (isDev) console.log('[nuclear-v2] POLISH_RAW:', polished);
    if (isDev) console.log('[nuclear-v2] POLISH_CLEAN:', result);

    // 4a-pre. Verb tightening: replace soft expression/pose verbs
    result = result.replace(/\bnail(ed|ing) the (blank|deadpan|bored|confused|smug|forced|intense|zoned out|awkward) (expression|look|stare|face)\b/gi,
      (_, verb, adj, noun) => `committed to that ${adj} ${noun}`);
    result = result.replace(/\bnail(ed|ing) the (stiff|forced casual|over-serious|trying-to-look-cool|deadpan) (pose)\b/gi,
      (_, verb, adj, noun) => `locked in that ${adj} ${noun}`);

    // 4a. Tone fix: "Looking like" -> "You look like" at sentence 1 start
    if (/^Looking like\b/i.test(result)) {
      result = result.replace(/^Looking like\b/i, 'You look like');
      if (isDev) console.log(`[nuclear-v2] toneFixApplied=looking-like`);
    }

    // 4a2. Starter-rotate: replace "You posted"/"Posted" with varied opener
    if (/^(You posted|Posted)\b/i.test(result)) {
      const _starterAlts = [
        'You hit upload', 'You really thought', 'You walked in',
        'You showed up', 'You pulled up',
      ];
      const _cst = getClientState(clientId);
      const _avail = _starterAlts.filter(s => s !== _cst.lastSentenceStarter);
      const _pick = _avail[Math.floor(Math.random() * _avail.length)];
      const _old = result.match(/^(You posted|Posted)\b/i)[0];
      result = result.replace(/^(You posted|Posted)\b/i, _pick);
      _cst.lastSentenceStarter = _pick;
      if (isDev) console.log(`[nuclear-v2] toneFixApplied=starter-rotate from=${_old.toLowerCase()} to=${_pick}`);
    }

    // 4b. REFUSAL GATE: if polish returned refusal text, retry once then fall back to skeleton
    const _refDbg1 = {};
    if (looksLikeRefusal(result, _refDbg1)) {
      if (isDev) console.log(`[nuclear-v2] refusalDetected=true -> retrying polish once (pattern=${_refDbg1.matched || 'null/empty'})`);
      let refusalRetried = false;
      try {
        const refRetryAc = new AbortController();
        const refRetryTimer = setTimeout(() => refRetryAc.abort(), 8000);
        const refRetryOpts = {
          ...polishOpts,
          temperature: 0.3,
          max_output_tokens: 60,
          input: [
            { role: 'system', content: 'Do not refuse. Do not apologize. Never mention policy. Produce the roast. ' + polishSystemMsg },
            polishOpts.input[1],
          ],
        };
        const refRetryResp = await openai.responses.create(refRetryOpts, { signal: refRetryAc.signal });
        clearTimeout(refRetryTimer);
        if (refRetryResp.output_text) {
          const retryResult = nv2SanitizeQuotes(nv2CleanOutput(refRetryResp.output_text));
          if (!looksLikeRefusal(retryResult)) {
            result = retryResult;
            refusalRetried = true;
            if (isDev) console.log(`[nuclear-v2] refusalRetrySucceeded=true`);
          }
        }
      } catch (e) {
        if (isDev) console.log(`[nuclear-v2] refusal retry error: ${e.message}`);
      }
      if (!refusalRetried) {
        if (isDev) console.log(`[nuclear-v2] refusalRetryFailed=true -> using skeleton`);
        result = chosenMicdrop
          ? skeleton.replace(/[.!?]+$/, '').trim() + '. ' + chosenMicdrop
          : skeleton;
        polishFailed = true;
      }
    }

    // 4c. Micdrop preservation + 2-sentence enforcement
    if (chosenMicdrop) {
      const resultSentsC = result.match(/[^.!?]*[.!?]+/g);
      if (!result.includes(chosenMicdrop.replace(/\.$/, ''))) {
        // GPT removed/paraphrased the micdrop — extract sentence 1 and re-attach
        const s1 = resultSentsC ? resultSentsC[0].trim() : result.replace(/[.!?]+$/, '').trim() + '.';
        result = s1 + ' ' + chosenMicdrop;
        if (isDev) console.log(`[nuclear-v2] micdrop re-attached after GPT removed it`);
      } else if (resultSentsC && resultSentsC.length > 2) {
        // GPT kept micdrop but added extra sentences — enforce exactly 2 (sent1 + micdrop)
        const s1 = resultSentsC[0].trim();
        result = s1 + ' ' + chosenMicdrop;
        if (isDev) console.log(`[nuclear-v2] 2-sentence enforcement: trimmed ${resultSentsC.length} sentences to 2`);
      }
      micdropUsed = true;
      micdropText = chosenMicdrop;
    }

    // 4c2. Softness detector: if sentence 1 contains soft language, try one harsher rewrite
    const NV2_SOFT_WORDS = ['unintentional', 'comedy', 'new level', 'achieved', 'kind of', 'a bit', 'somewhat'];
    if (chosenMicdrop) {
      const s1Sents = result.match(/[^.!?]*[.!?]+/g);
      const s1Text = s1Sents ? s1Sents[0].trim() : result;
      const s1Lower = s1Text.toLowerCase();
      if (NV2_SOFT_WORDS.some(w => s1Lower.includes(w))) {
        if (isDev) console.log(`[nuclear-v2] softnessDetected=true in sentence 1, retrying harsher rewrite`);
        try {
          const harshResp = await openai.responses.create({
            model: 'gpt-4o',
            input: [
              { role: 'system', content: 'You are a sharp roast rewriter. Output EXACTLY 2 sentences. No soft language. No quotes, no explanation, no markdown.' },
              { role: 'user', content: [{ type: 'input_text', text: `Rewrite sentence 1 to be harsher and more direct. No soft language. Keep same idea. Output exactly 2 sentences with the same sentence 2.\n\nSentence 1: "${s1Text}"\nSentence 2: "${chosenMicdrop}"` }] },
            ],
            max_output_tokens: 80,
            temperature: 0.9,
          });
          if (harshResp && harshResp.output_text) {
            const harsh = nv2SanitizeQuotes(nv2CleanOutput(harshResp.output_text));
            if (!looksLikeRefusal(harsh) && !nv2HasBannedPatterns(harsh) && isPlaySafe(harsh)) {
              // Re-enforce micdrop on the harsh result
              if (!harsh.includes(chosenMicdrop.replace(/\.$/, ''))) {
                const hSents = harsh.match(/[^.!?]*[.!?]+/g);
                const hS1 = hSents ? hSents[0].trim() : harsh.replace(/[.!?]+$/, '').trim() + '.';
                result = hS1 + ' ' + chosenMicdrop;
              } else {
                result = harsh;
              }
              if (isDev) console.log(`[nuclear-v2] softnessRewrite applied`);
            }
          }
        } catch (err) {
          if (isDev) console.log(`[nuclear-v2] softnessRewrite error: ${err.message}`);
        }
      }
    }

    // 4c3. Contradiction check: reject outputs that contradict extracted tags
    const contradictionFacts = { modifier: modifierUsed, lighting: tags.lighting, setting: tags.setting, allowedObjects };
    const contradictions = nv2ContradictsFacts(result, contradictionFacts);
    if (contradictions) {
      if (isDev) console.log(`[nuclear-v2] contradictionDetected=[${contradictions.join(',')}] result="${result}", regenerating`);
      continue;
    }

    // 4d. Micdrop post-hoc: if no micdrop was pre-chosen but result has a weak sentence 2, replace it
    if (!chosenMicdrop) {
      const sents = result.match(/[^.!?]*[.!?]+/g);
      if (sents && sents.length >= 2) {
        const sent2 = sents[1].trim();
        const sent2Lower = sent2.toLowerCase();
        const sent2Wc = sent2.split(/\s+/).length;
        const isWeak = sent2Wc > 10 ||
          NV2_WEAK_SENTENCE2_WORDS.some(w => sent2Lower.includes(w));
        if (isWeak) {
          const replacementMicdrop = nv2SelectMicdrop(clientId, micdropLane);
          result = sents[0].trim() + ' ' + replacementMicdrop;
          micdropUsed = true;
          micdropText = replacementMicdrop;
          micdropReplacedSentence2 = true;
          if (isDev) console.log(`[nuclear-v2] micdropReplacedSentence2=true weak="${sent2}" -> "${replacementMicdrop}"`);
        }
      }
    }

    // 5. Punch-length enforcement
    truncationApplied = false;
    minWordRetry = false;
    const preferredMinWords = 14;
    wordCount = result.split(/\s+/).length;

    // 5a. Too long (>22 words): trim sentence 1 to fit with micdrop
    if (wordCount > 22) {
      if (micdropUsed && micdropText) {
        // Keep micdrop, shorten sentence 1 via hard-trim
        const sents = result.match(/[^.!?]*[.!?]+/g);
        if (sents && sents.length >= 2) {
          let s1 = sents[0].trim();
          const micdropWc = micdropText.split(/\s+/).length;
          const maxS1Words = 22 - micdropWc;
          const s1Words = s1.split(/\s+/);
          if (s1Words.length > maxS1Words) {
            s1 = s1Words.slice(0, maxS1Words).join(' ');
            if (!/[.!?]$/.test(s1)) s1 += '.';
          }
          result = s1 + ' ' + micdropText;
          wordCount = result.split(/\s+/).length;
          truncationApplied = true;
          if (isDev) console.log(`[nuclear-v2] micdrop-aware trim: ${wordCount} words`);
        }
      } else {
        try {
          const shortenResp = await openai.responses.create({
            model: 'gpt-4o',
            input: [
              { role: 'system', content: 'You shorten roasts. Output ONLY the shortened roast. No quotes, no explanation. 1–2 sentences, 12–22 words max.' },
              { role: 'user', content: [{ type: 'input_text', text: `Shorten this roast to under 22 words while keeping the punch. Do NOT add new ideas. Output ONLY the roast.\n\n"${result}"` }] },
            ],
            max_output_tokens: 60,
            temperature: 0.7,
          });
          if (shortenResp.output_text) {
            const shortened = nv2SanitizeQuotes(nv2CleanOutput(shortenResp.output_text));
            if (!looksLikeRefusal(shortened)) {
              const swc = shortened.split(/\s+/).length;
              if (swc <= 22 && swc >= 5 && !nv2HasBannedPatterns(shortened)) {
                result = shortened;
                wordCount = swc;
                truncationApplied = true;
                if (isDev) console.log(`[nuclear-v2] shorten-rewrite applied: ${wordCount} words`);
              }
            }
          }
        } catch (err) {
          if (isDev) console.log(`[nuclear-v2] shorten-rewrite error: ${err.message}`);
        }

        // Hard-trim fallback: cut trailing clause after last comma/em-dash
        wordCount = result.split(/\s+/).length;
        if (wordCount > 22) {
          const lastComma = result.lastIndexOf(',');
          const lastDash = result.lastIndexOf('\u2014');
          const cutPoint = Math.max(lastComma, lastDash);
          if (cutPoint > 20) {
            result = result.slice(0, cutPoint).trim();
            if (!/[.!?]$/.test(result)) result += '.';
            wordCount = result.split(/\s+/).length;
            truncationApplied = true;
            if (isDev) console.log(`[nuclear-v2] hard-trim applied: ${wordCount} words`);
          }
        }
      }
    }

    // 5b. Too short (<10 words): expand sentence 1 only, then re-attach micdrop
    wordCount = result.split(/\s+/).length;
    if (wordCount < 10) {
      minWordRetry = true;
      // Extract sentence 1 for expansion (preserve micdrop separately)
      const expandSents = result.match(/[^.!?]*[.!?]+/g);
      const expandS1 = expandSents ? expandSents[0].trim() : result.replace(/[.!?]+$/, '').trim() + '.';
      if (isDev) console.log(`[nuclear-v2] expandRewriteTriggered=true (${wordCount} words)`);
      try {
        const expandResp = await openai.responses.create({
          model: 'gpt-4o',
          input: [
            { role: 'system', content: 'You expand short roast sentence 1 into a punchier, longer version. Output ONLY the single expanded sentence. No quotes, no explanation. 12–16 words. Must feel shareable and harsh. No questions.' },
            { role: 'user', content: [{ type: 'input_text', text: `Make this sentence longer, meaner, and more quotable. Same target "${target}". Add a specific, cutting observation. 12–16 words, output ONLY the single sentence.\n\n"${expandS1}"` }] },
          ],
          max_output_tokens: 60,
          temperature: 0.8,
        });
        if (expandResp.output_text) {
          let expandedS1 = nv2SanitizeQuotes(expandResp.output_text.trim().replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^["'`]+|["'`]+$/g, ''));
          const _refDbg2 = {};
          if (looksLikeRefusal(expandedS1, _refDbg2)) {
            if (isDev) console.log(`[nuclear-v2] refusalDetected=true after expand-rewrite pattern=${_refDbg2.matched || 'null/empty'}, regenerating`);
            continue;
          }
          if (!/[.!?]$/.test(expandedS1)) expandedS1 += '.';
          const ewc = expandedS1.split(/\s+/).length;
          if (ewc >= 8 && ewc <= 18 && !nv2HasBannedPatterns(expandedS1)) {
            // Rebuild result: expanded sentence 1 + micdrop (if exists)
            result = micdropUsed && micdropText ? expandedS1 + ' ' + micdropText : expandedS1;
            wordCount = result.split(/\s+/).length;
            if (isDev) console.log(`[nuclear-v2] expand-rewrite applied: ${wordCount} words`);
          }
        }
      } catch (err) {
        if (isDev) console.log(`[nuclear-v2] expand-rewrite error: ${err.message}`);
      }

      // Escalation append ONLY if still too short and no micdrop to help
      wordCount = result.split(/\s+/).length;
      if (wordCount < 10 && !looksLikeRefusal(result)) {
        if (!micdropUsed) {
          const shortMicdrop = nv2SelectMicdrop(clientId, micdropLane);
          const base = result.replace(/[.!?]+$/, '').trim();
          result = base + '. ' + shortMicdrop;
          micdropUsed = true;
          micdropText = shortMicdrop;
        } else {
          const shortEscalations = NV2_ESCALATION_BUCKET.filter(e => e.split(/\s+/).length <= 4);
          if (shortEscalations.length > 0) {
            const appendEsc = shortEscalations[Math.floor(Math.random() * shortEscalations.length)];
            const base = result.replace(/[.!?]+$/, '').trim();
            result = base + '. ' + appendEsc + '.';
          }
        }
        wordCount = result.split(/\s+/).length;
        if (isDev) console.log(`[nuclear-v2] short-text appended -> ${wordCount} words`);
      } else if (wordCount < 10) {
        if (isDev) console.log(`[nuclear-v2] refusalDetected=true short text, regenerating`);
        continue;
      }
    }

    // 6. Final refusal gate (catch any that slipped through)
    const _refDbg3 = {};
    if (looksLikeRefusal(result, _refDbg3)) {
      if (isDev) console.log(`[nuclear-v2] refusalDetected=true at final gate pattern=${_refDbg3.matched || 'null/empty'}, regenerating`);
      continue;
    }

    // 7. Validate
    const _banDbg = {};
    if (nv2HasBannedPatterns(result, _banDbg)) {
      if (isDev) console.log(`[nuclear-v2] banned pattern detected="${_banDbg.matched}", retrying`);
      continue;
    }
    if (!isPlaySafe(result)) {
      if (isDev) console.log(`[nuclear-v2] play-safe filter triggered, retrying`);
      continue;
    }
    if (nv2HasBrokenSentenceEnd(result)) {
      // Auto-repair: trim dangling words from each sentence end, then ensure punctuation
      const repairSents = result.match(/[^.!?]*[.!?]+/g);
      if (repairSents) {
        const repaired = repairSents.map(s => {
          let t = s.trim();
          // Strip dangling article/preposition before final punctuation
          t = t.replace(/\s+\b(a|an|the|of|to|on|in|at|for|with|from|by|as)\s*([.!?])$/, '$2');
          // Strip two-token dangling (prep + the)
          t = t.replace(/\s+\b(on|in|at|of|to|for|with)\s+the\s*([.!?])$/, '$2');
          return t;
        });
        result = repaired.join(' ');
      }
      // Ensure final punctuation
      if (!/[.!?]$/.test(result)) result += '.';
      if (isDev) console.log(`[nuclear-v2] brokenSentenceEndDetected=true -> repaired`);
    }
    // 7a. Soft-penalty check: retry once on attempt 1 if B-terms present, accept on 2+
    const softPen = nv2SoftPenalty(result, isDev);
    if (softPen < 0 && attempts === 1) {
      if (isDev) console.log(`[nuclear-v2] softPenalty=${softPen} on attempt 1, retrying for cleaner output`);
      continue;
    }
    if (softPen < 0 && isDev) {
      console.log(`[nuclear-v2] softPenalty=${softPen} on attempt ${attempts}, accepting`);
    }

    // 7b. Object-subject guard + tag-glued object guard
    //     Detect when sentence 1 treats a scene object as the main subject, or glues tag
    //     descriptors onto an object ("Your car's mixed, garage look...")
    //     SKIP if polish already failed (don't cascade more LLM calls on connection issues)
    if (!polishFailed) {
      const resultSents7 = result.match(/[^.!?]*[.!?]+/g);
      const sent1_7 = resultSents7 ? resultSents7[0].trim() : result;
      const needsObjectSubjectFix = nv2Sentence1ObjectSubject(sent1_7, allowedObjects, targetSource);
      const needsTagGlueFix = nv2HasTagGluedObject(result);
      if (needsObjectSubjectFix || needsTagGlueFix) {
        const guardName = needsObjectSubjectFix ? 'objectSubjectGuard' : 'tagGluedObjectDetected';
        if (isDev) console.log(`[nuclear-v2] ${guardName}=true sent1="${sent1_7}"`);
        // One rewrite retry to fix subject
        try {
          const subjAc = new AbortController();
          const subjTimer = setTimeout(() => subjAc.abort(), 8000);
          const fixSubjResp = await openai.responses.create({
            model: 'gpt-4o',
            input: [
              { role: 'system', content: 'You rewrite roast captions so the PERSON is always the subject (YOU/YOUR). Do NOT start sentence 1 with "Your <object>", "The <object>", or "That <object>". Objects may appear only as comparison/context after YOU/YOUR. Keep the tone nuclear, punchy, Google Play safe.' },
              { role: 'user', content: [{ type: 'input_text', text: `${factsBlock}\n\nRewrite sentence 1 only so it roasts the PERSON first (you/your). If an object is referenced, use it as comparison AFTER the person. Do not invent objects; use at most 1 allowed object. Keep sentence 2 EXACTLY unchanged if it is a micdrop. Output ONLY the corrected roast.\n\nCurrent roast: "${result}"` }] },
            ],
            max_output_tokens: 80,
            temperature: 0.7,
          }, { signal: subjAc.signal });
          clearTimeout(subjTimer);
          if (fixSubjResp && fixSubjResp.output_text) {
            let fixed = nv2SanitizeQuotes(nv2CleanOutput(fixSubjResp.output_text));
            // Re-enforce micdrop if needed
            if (micdropUsed && micdropText && !fixed.includes(micdropText.replace(/\.$/, ''))) {
              const fSents = fixed.match(/[^.!?]*[.!?]+/g);
              const fS1 = fSents ? fSents[0].trim() : fixed.replace(/[.!?]+$/, '').trim() + '.';
              fixed = fS1 + ' ' + micdropText;
            }
            // Re-run contradiction + safety checks
            const fixContradictions = nv2ContradictsFacts(fixed, contradictionFacts);
            if (!looksLikeRefusal(fixed) && !nv2HasBannedPatterns(fixed) && isPlaySafe(fixed) && !fixContradictions && /\byou\b|\byour\b/i.test(fixed)) {
              result = fixed;
              wordCount = result.split(/\s+/).length;
              if (isDev) console.log(`[nuclear-v2] objectSubjectRewrite applied`);
            } else {
              if (isDev) console.log(`[nuclear-v2] objectSubjectRewrite failed checks, regenerating`);
              continue;
            }
          } else {
            continue;
          }
        } catch (err) {
          // On connection/timeout error, keep current text instead of cascading
          if (isDev) console.log(`[nuclear-v2] objectSubjectRewrite error: ${err.message}, keeping current text`);
        }
      }
    } else {
      if (isDev) console.log(`[nuclear-v2] skipping objectSubjectGuard (polish failed)`);
    }

    // 8. FINAL micdrop enforcement: guarantee sentence 2 = micdrop verbatim
    if (micdropUsed && micdropText) {
      const finalSents = result.match(/[^.!?]*[.!?]+/g);
      const finalS1 = finalSents ? finalSents[0].trim() : result.replace(/[.!?]+$/, '').trim() + '.';
      if (!result.includes(micdropText.replace(/\.$/, ''))) {
        result = finalS1 + ' ' + micdropText;
        if (isDev) console.log(`[nuclear-v2] final micdrop enforcement: re-attached`);
      } else if (finalSents && finalSents.length > 2) {
        result = finalS1 + ' ' + micdropText;
        if (isDev) console.log(`[nuclear-v2] final micdrop enforcement: trimmed to 2 sentences`);
      }
      wordCount = result.split(/\s+/).length;
    }

    // 9. You/your check: if sentence 1 has no "you/your", prepend "You look like"
    {
      const youSents = result.match(/[^.!?]*[.!?]+/g);
      const youS1 = youSents ? youSents[0].trim() : result;
      if (!/\byou\b|\byour\b/i.test(youS1)) {
        // Local rephrase: prepend "You look like" + lowercase first char
        const stripped = youS1.replace(/[.!?]+$/, '').trim();
        const rephrased = 'You look like ' + stripped.charAt(0).toLowerCase() + stripped.slice(1);
        const newS1 = (rephrased.length > 0 && !/[.!?]$/.test(rephrased)) ? rephrased + '.' : rephrased;
        const rest = youSents && youSents.length > 1 ? ' ' + youSents.slice(1).map(s => s.trim()).join(' ') : '';
        result = newS1 + rest;
        wordCount = result.split(/\s+/).length;
        if (isDev) console.log(`[nuclear-v2] you/your prepend applied`);
      }
    }

    // 10. Local punch-up when polish failed (deterministic, no LLM call)
    if (polishFailed) {
      const _punchUpAttrs = [];
      if (tags.hair) _punchUpAttrs.push(tags.hair + ' hair');
      if (tags.outfit) _punchUpAttrs.push(tags.outfit + ' fit');
      if (tags.expression) _punchUpAttrs.push(tags.expression + ' look');
      if (tags.pose) _punchUpAttrs.push(tags.pose + ' pose');
      if (tags.grooming) _punchUpAttrs.push(tags.grooming + ' grooming');
      result = nv2LocalPunchUp(result, {
        target,
        targetSource,
        socialContext,
        primaryAttrs: _punchUpAttrs,
      });
      wordCount = result.split(/\s+/).length;
    }

    finalRoast = result;
    break;
  }

  // If all attempts failed or final roast is a refusal, use safe fallback
  if (!finalRoast || looksLikeRefusal(finalRoast)) {
    fallbackUsed = true;
    finalRoast = NV2_SAFE_FALLBACKS[Math.floor(Math.random() * NV2_SAFE_FALLBACKS.length)];
    wordCount = finalRoast.split(/\s+/).length;
    pickedStructure = { id: 'FALLBACK' };
    pickedTarget = 'fallback';
    pickedOpenerType = 'OTHER';
    if (isDev) console.log(`[nuclear-v2] all attempts failed, using safe fallback`);
  }

  // Tone fix: ensure sentence 1 starts with "You" for accusatory tone
  const accSents = finalRoast.match(/[^.!?]*[.!?]+/g);
  if (accSents) {
    let s1 = accSents[0].trim();
    const rest = accSents.slice(1).map(s => s.trim()).join(' ');
    let fixed = false;
    if (/^Showed up\b/i.test(s1))       { s1 = s1.replace(/^Showed up\b/i, 'You showed up'); fixed = true; }
    else if (/^Serving\b/i.test(s1))    { s1 = s1.replace(/^Serving\b/i, "You're serving"); fixed = true; }
    else if (/^Got caught\b/i.test(s1)) { s1 = s1.replace(/^Got caught\b/i, 'You got caught'); fixed = true; }
    else if (/^Posted\b/i.test(s1))     { s1 = s1.replace(/^Posted\b/i, 'You posted'); fixed = true; }
    else if (/^Pulled up\b/i.test(s1))  { s1 = s1.replace(/^Pulled up\b/i, 'You pulled up'); fixed = true; }
    else if (/^Walked in\b/i.test(s1))  { s1 = s1.replace(/^Walked in\b/i, 'You walked in'); fixed = true; }
    else if (/^Tried\b/i.test(s1))      { s1 = s1.replace(/^Tried\b/i, 'You tried'); fixed = true; }
    else if (/^Acting like\b/i.test(s1)){ s1 = s1.replace(/^Acting like\b/i, "You're acting like"); fixed = true; }
    else if (/^Brought\b/i.test(s1))    { s1 = s1.replace(/^Brought\b/i, 'You brought'); fixed = true; }
    else if (/^Rolled up\b/i.test(s1)) { s1 = s1.replace(/^Rolled up\b/i, 'You rolled up'); fixed = true; }
    else if (/^Rocked\b/i.test(s1))    { s1 = s1.replace(/^Rocked\b/i, 'You rocked'); fixed = true; }
    else if (/^Chose\b/i.test(s1))     { s1 = s1.replace(/^Chose\b/i, 'You chose'); fixed = true; }
    else if (/^Committed\b/i.test(s1)) { s1 = s1.replace(/^Committed\b/i, 'You committed'); fixed = true; }
    else if (!/^you\b/i.test(s1)) {
      // Modifier phrase or other non-You opener — prepend "You went"
      s1 = 'You went ' + s1.charAt(0).toLowerCase() + s1.slice(1);
      fixed = true;
    }
    if (fixed) {
      finalRoast = rest ? s1 + ' ' + rest : s1;
      if (isDev) console.log(`[nuclear-v2] toneFixApplied=skeleton-accusatory`);
    }
  }
  // Grammar cleanup: fix doubled prepositions from tone rewrites
  finalRoast = finalRoast.replace(/\brolled out up\b/gi, 'rolled up');
  finalRoast = finalRoast.replace(/\brolled out in\b/gi, 'rolled in');
  finalRoast = finalRoast.replace(/\brolled out with\b/gi, 'rolled up with');

  // Push to client state (includes openerType)
  pushClientRoast(clientId, finalRoast, pickedTarget, pickedStructure.id, pickedOpenerType);

  // Logging
  const tagModifiers = [tags.angle, tags.lighting, tags.framing, tags.pose, tags.setting].filter(Boolean);
  const selfieAttrs = [tags.hair, tags.outfit, tags.expression, tags.grooming, tags.bg_vibe].filter(Boolean);
  if (isDev) {
    console.log(`[nuclear-v2] clientId=${clientId} structureId=${pickedStructure.id} target="${pickedTarget}" opener=${pickedOpenerType} targetSource=${targetSource} sceneTargetsRaw=${dynamicTargets.length} sceneTargetsAfterFilter=${sceneTargetsAfterFilter} tagObjects=${tags.objects.length} tagModifiers=[${tagModifiers.join(',')}] selfieAttrs=[${selfieAttrs.join(',')}] selfieAttrTargetCount=${selfieAttrTargets.length} modifierPhrase=${modifierPhrase ? '"' + modifierPhrase + '"' : 'none'} modifierUsed=${modifierUsed ? '"' + modifierUsed + '"' : 'none'} punchlineUsed=${punchlineUsed} punchlineText=${punchlineText ? '"' + punchlineText + '"' : 'none'} micdropUsed=${micdropUsed} micdropText=${micdropText ? '"' + micdropText + '"' : 'none'} micdropReplacedSentence2=${micdropReplacedSentence2} attempts=${attempts} fallback=${fallbackUsed} finalWords=${wordCount} truncated=${truncationApplied} minWordRetry=${minWordRetry}`);
    console.log(`[nuclear-v2] result="${finalRoast}"`);
  }

  // MICDROP ENFORCEMENT: final post-process — guarantee micdrop is verbatim in output
  if (micdropUsed && micdropText && !fallbackUsed) {
    const micdropClean = micdropText.replace(/\.$/, '').trim();
    if (!finalRoast.includes(micdropClean)) {
      // Micdrop is missing after all rewrites/trimming — re-attach
      if (isDev) console.log(`[nuclear-v2] micdropMissingAfterRewrite=true, reattaching`);
      const enforceSents = finalRoast.match(/[^.!?]*[.!?]+/g);
      const enforceS1 = enforceSents ? enforceSents[0].trim() : finalRoast.replace(/[.!?]+$/, '').trim() + '.';
      finalRoast = enforceS1 + ' ' + micdropText;
    }
    // Enforce exactly 2 sentences: sentence 1 + micdrop
    const postSents = finalRoast.match(/[^.!?]*[.!?]+/g);
    if (postSents && postSents.length > 2) {
      // Too many sentences — keep only sentence 1 + micdrop
      finalRoast = postSents[0].trim() + ' ' + micdropText;
      if (isDev) console.log(`[nuclear-v2] micdropEnforced: trimmed to 2 sentences`);
    } else if (postSents && postSents.length === 2) {
      // 2 sentences — ensure sentence 2 IS the micdrop
      const s2 = postSents[1].trim();
      if (s2 !== micdropText && !s2.includes(micdropClean)) {
        finalRoast = postSents[0].trim() + ' ' + micdropText;
        if (isDev) console.log(`[nuclear-v2] micdropEnforced: replaced sentence 2 with micdrop`);
      }
    } else if (!postSents || postSents.length === 1) {
      // 1 sentence — append micdrop
      const base = finalRoast.replace(/[.!?]+$/, '').trim() + '.';
      finalRoast = base + ' ' + micdropText;
      if (isDev) console.log(`[nuclear-v2] micdropEnforced: appended micdrop as sentence 2`);
    }
    // Ensure punctuation is correct
    if (!/[.!?]$/.test(finalRoast)) finalRoast += '.';
    wordCount = finalRoast.split(/\s+/).length;
  }

  // Absolute final refusal guard — never return apology text
  if (looksLikeRefusal(finalRoast)) {
    finalRoast = 'That upload was brave. It wasn\'t smart.';
    wordCount = finalRoast.split(/\s+/).length;
    fallbackUsed = true;
  }

  return {
    roast: finalRoast,
    meta: {
      pickedStructureId: pickedStructure.id,
      pickedTarget,
      openerType: pickedOpenerType,
      targetFromScene,
      targetSource,
      sceneTargetCount: dynamicTargets.length,
      sceneTargetsAfterFilter,
      tagObjectCount: tags.objects.length,
      tagModifiers,
      selfieAttrs,
      selfieAttrTargetCount: selfieAttrTargets.length,
      modifierPhrase,
      modifierUsed,
      punchlineUsed,
      punchlineText,
      micdropUsed,
      micdropText,
      micdropReplacedSentence2,
      attempts,
      fallbackUsed,
      clientId,
      wordCount,
      truncationApplied,
      minWordRetry,
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
      console.log(`  [${i + 1}] struct=${meta.pickedStructureId} target="${meta.pickedTarget}" words=${meta.wordCount} fallback=${meta.fallbackUsed}`);
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

// --- Savage V2 Safe Fallbacks ---
const SV2_SAFE_FALLBACKS = [
  'That angle was a creative choice. Creative, not effective.',
  'Bold strategy going with that look. Bold is generous.',
  'You posed like this was rehearsed. The rehearsal lost.',
  'Your confidence walked in before your talent did.',
  'That effort was voluntary and it still underdelivered.',
];

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
  const isDev = process.env.NODE_ENV !== 'production';
  const state = getSavageClientState(clientId);
  const maxAttempts = 3;
  let attempts = 0;
  let fallbackUsed = false;
  let pickedTarget = null;
  let pickedStructure = null;
  let finalRoast = null;
  let wordCount = 0;

  while (attempts < maxAttempts) {
    attempts++;

    // 1. Select with per-client avoidance (reuse nv2SelectWithAvoidance)
    const structure = nv2SelectWithAvoidance(
      SV2_STRUCTURE_TEMPLATES, state.recentStructures, NV2_MAX_SELECT_TRIES
    );
    const target = nv2SelectWithAvoidance(
      SV2_TARGET_BUCKET, state.recentTargets, NV2_MAX_SELECT_TRIES
    );
    const critique = SV2_CRITIQUE_BUCKET[Math.floor(Math.random() * SV2_CRITIQUE_BUCKET.length)];
    const escalation = SV2_ESCALATION_BUCKET[Math.floor(Math.random() * SV2_ESCALATION_BUCKET.length)];

    pickedStructure = structure;
    pickedTarget = target;

    // 2. Assemble skeleton
    const skeleton = structure.tpl
      .replace('{TARGET}', target)
      .replace('{CRITIQUE}', critique)
      .replace('{ESCALATION}', escalation);

    if (isDev) console.log(`[savage-v2] attempt=${attempts} skeleton="${skeleton}"`);

    // 3. GPT polish (rewrite-only)
    const polishPrompt = `Rewrite this EXACT roast to sound more natural and punchy. Do NOT add new ideas, do NOT change the target, do NOT add new sentences. Keep 1–2 sentences. 12–26 words preferred. Do NOT use questions. Output ONLY the rewritten roast, nothing else.\n\nRoast: "${skeleton}"`;

    let polished = skeleton;
    try {
      const polishOpts = {
        model: 'gpt-4o',
        input: [
          { role: 'system', content: 'You are a roast rewriter. You ONLY output the rewritten roast. No quotes, no explanation, no markdown. 1–2 sentences only. Savage but not cruel.' },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: polishPrompt },
              { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
            ],
          },
        ],
        max_output_tokens: 100,
        temperature: 0.85,
        top_p: 0.9,
      };
      const polishResp = await openai.responses.create(polishOpts);
      if (polishResp.output_text) {
        polished = polishResp.output_text;
      }
    } catch (err) {
      if (isDev) console.log(`[savage-v2] polish LLM error: ${err.message}`);
    }

    // 4. Clean
    let result = sv2CleanOutput(polished);

    // 5. Validate — reuse shared filters
    if (nv2HasBannedPatterns(result)) {
      if (isDev) console.log(`[savage-v2] banned pattern detected, retrying`);
      continue;
    }
    if (!isPlaySafe(result)) {
      if (isDev) console.log(`[savage-v2] play-safe filter triggered, retrying`);
      continue;
    }

    wordCount = result.split(/\s+/).length;
    if (wordCount > 30) {
      result = sv2CleanOutput(result);
      wordCount = result.split(/\s+/).length;
    }

    finalRoast = result;
    break;
  }

  // Fallback
  if (!finalRoast) {
    fallbackUsed = true;
    finalRoast = SV2_SAFE_FALLBACKS[Math.floor(Math.random() * SV2_SAFE_FALLBACKS.length)];
    wordCount = finalRoast.split(/\s+/).length;
    pickedStructure = { id: 'FALLBACK' };
    pickedTarget = 'fallback';
    if (isDev) console.log(`[savage-v2] all attempts failed, using safe fallback`);
  }

  pushSavageClientRoast(clientId, finalRoast, pickedTarget, pickedStructure.id);

  if (isDev) {
    console.log(`[savage-v2] clientId=${clientId} structureId=${pickedStructure.id} target="${pickedTarget}" attempts=${attempts} fallback=${fallbackUsed} words=${wordCount}`);
    console.log(`[savage-v2] result="${finalRoast}"`);
  }

  return {
    roast: finalRoast,
    meta: {
      pickedStructureId: pickedStructure.id,
      pickedTarget,
      attempts,
      fallbackUsed,
      clientId,
      wordCount,
    },
  };
}

app.post('/api/roast', async (req, res) => {
  try {
    const { imageBase64, level = 'medium', clientId, useSavageV2, sceneHints, safeTags } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    // Guard: reject oversized base64 before sending to OpenAI
    if (imageBase64.length > 18_000_000) {
      return jsonError(res, 413, 'payload_too_large', 'Image is too large. Please use a smaller image.');
    }

    const tierName = Object.hasOwn(INTENSITY_CONFIG, level) ? level : 'medium';
    const config = INTENSITY_CONFIG[tierName];
    const isDev = process.env.NODE_ENV !== 'production';
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
      'Style: direct verdict — no comparisons, just a blunt personal judgment.',
      'Style: exposure — call out try-hard or overcompensation without comparing objects.',
      'Style: social read — short, blunt, how others read this person. Avoid "nobody" or "no one".',
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
      ? `You are a roast comedian. ONE sentence. 10–18 words. Reference a visible detail. Direct ego/status hit. End on a punch verdict word. No questions. No advice. No existential despair.${savageStyleHint} Respond with ONLY valid JSON. No markdown. No code fences.${savageAvoidBlock}`
      : tierName === 'nuclear'
        ? `You are a ruthless roast comedian specializing in social humiliation, not descriptive insults. The goal is exposing delusion in front of an audience. Write exactly 1–2 sentences total. No third sentence. No colon-style closer. Sentence 1: visual/trait observation — anchor on something visible (angle/hair/hoodie/posture, max 12 words). Sentence 2 (if present): social verdict — reference audience perception (anyone/people/everyone/nobody/they/buying it/fooled) OR a room-reaction phrase (the room/group chat/timeline/comments). Sentence 2 MUST NOT start with "You". BANNED WORDS: imagine, expect, insist, assume, pretend. BANNED PHRASES: "does you no favors", "isn't doing you any favors", "your expression", "the lighting". Do not use these under any circumstances.${nuclearStyleHint}${nuclearLaneBlock} Do NOT rely on "tired/drained/low energy/low battery" as the main punch. One safe absurd kicker allowed occasionally (e.g., "even the garage door isn't impressed" / "your RGB wants a refund") but avoid dehumanization and worthlessness. Avoid poetic metaphors. Cold and cutting. No existential despair. No "nobody cares" or "forgettable". Avoid substance references (hungover/drunk/high). Avoid diagnosis/therapy wording. Avoid "warning sign" phrasing. Avoid "screams" and "you clearly" templates. Avoid words like "detected", "confirmed", "exposed", "analyzed". FORMAT: output 1–2 sentences. No line breaks, no bullet points, no ellipsis-only fragments. Aim for 60–160 characters total. Respond with ONLY valid JSON: {"roasts":["Your sentences here."]}. No markdown. No code fences. No explanations.${nuclearAvoidBlock}`
        : `You are a sharp, observational roast comedian. You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanations.`;

    const imageContent = [
      { type: 'input_text', text: prompt },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
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

    // --- Nuclear V2 intercept: use hybrid skeleton+polish system ---
    if (tierName === 'nuclear') {
      const nv2ClientId = (typeof clientId === 'string' && clientId.trim()) ? clientId.trim() : 'anon';
      if (isDev) console.log(`[nuclear-v2] clientId=${nv2ClientId} (from request: ${typeof clientId === 'string' ? 'yes' : 'no'})`);

      // Scene tagger: use client-provided hints or extract from image
      let dynamicTargets = [];
      if (Array.isArray(sceneHints) && sceneHints.length > 0) {
        dynamicTargets = nv2FilterSceneNouns(sceneHints);
        if (isDev) console.log(`[nuclear-v2] using ${dynamicTargets.length} client-provided sceneHints (filtered)`);
      } else {
        dynamicTargets = await nv2ExtractSceneNouns(imageBase64);
        if (isDev) console.log(`[nuclear-v2] scene-tagger extracted ${dynamicTargets.length} targets: [${dynamicTargets.slice(0, 6).join(', ')}]`);
      }

      // Selfie tags: use client-provided safeTags or extract from image
      let selfieTags = null;
      if (safeTags && typeof safeTags === 'object' && !Array.isArray(safeTags)) {
        selfieTags = safeTags;
        if (isDev) console.log(`[nuclear-v2] using client-provided safeTags`);
      } else {
        selfieTags = await extractSafeSelfieTags(imageBase64);
        if (isDev) console.log(`[nuclear-v2] selfie-tags extracted: objects=${selfieTags.objects.length} angle=${selfieTags.angle} lighting=${selfieTags.lighting} framing=${selfieTags.framing} setting=${selfieTags.setting} pose=${selfieTags.pose} hair=${selfieTags.hair} outfit=${selfieTags.outfit} expression=${selfieTags.expression} grooming=${selfieTags.grooming} bg_vibe=${selfieTags.bg_vibe}`);
      }

      const { roast, meta } = await generateNuclearV2({ clientId: nv2ClientId, imageBase64, dynamicTargets, selfieTags });
      roasts = [roast];
      themes = [];
      // Track in legacy nuclear anti-repeat pool too
      pushRecentNuclear(roast);
      if (isDev) {
        console.log(`[nuclear-v2] served clientId=${meta.clientId} struct=${meta.pickedStructureId} target="${meta.pickedTarget}" targetSource=${meta.targetSource} sceneRaw=${meta.sceneTargetCount} sceneFiltered=${meta.sceneTargetsAfterFilter} tagObjects=${meta.tagObjectCount} tagModifiers=[${meta.tagModifiers.join(',')}] modifierPhrase=${meta.modifierPhrase ? '"' + meta.modifierPhrase + '"' : 'none'} modifierUsed=${meta.modifierUsed || 'none'} punchlineUsed=${meta.punchlineUsed} punchlineText=${meta.punchlineText ? '"' + meta.punchlineText + '"' : 'none'} micdropUsed=${meta.micdropUsed} micdropText=${meta.micdropText ? '"' + meta.micdropText + '"' : 'none'} micdropReplacedS2=${meta.micdropReplacedSentence2} attempts=${meta.attempts} fallback=${meta.fallbackUsed} words=${meta.wordCount} minWordRetry=${meta.minWordRetry}`);
      }
      // Skip all legacy nuclear logic — jump straight to response
      roasts = roasts.slice(0, config.count);
      if (isDev) {
        console.log(`[roast] level=${tierName} returned=${roasts.length} chars=${roasts[0]?.length || 0}`);
      }
      return res.json({ roasts });
    }

    // --- Savage V2 debug toggle: opt-in via useSavageV2 + dev/debug mode ---
    const sv2Debug = (process.env.NV2_DEBUG === '1' || isDev) && useSavageV2 === true;
    if (tierName === 'savage' && sv2Debug) {
      const sv2ClientId = (typeof clientId === 'string' && clientId.trim()) ? clientId.trim() : 'anon';
      const { roast, meta } = await generateSavageV2({ clientId: sv2ClientId, imageBase64 });
      roasts = [roast];
      themes = [];
      pushRecentSavage(roast);
      if (isDev) {
        console.log(`[savage-v2] served clientId=${meta.clientId} struct=${meta.pickedStructureId} target="${meta.pickedTarget}" attempts=${meta.attempts} fallback=${meta.fallbackUsed} words=${meta.wordCount}`);
      }
      roasts = roasts.slice(0, config.count);
      if (isDev) {
        console.log(`[roast] level=${tierName} (v2) returned=${roasts.length} chars=${roasts[0]?.length || 0}`);
      }
      return res.json({ roasts });
    }

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
            // Savage-specific hard clamp: 1 sentence, 16 words, 110 chars, no commas
            if (tierName === 'savage') {
              // Strip to first sentence
              const sentEnd = clamped.search(/[.!?]/);
              if (sentEnd !== -1) clamped = clamped.slice(0, sentEnd + 1).trim();
              // Remove commas and re-trim
              if (clamped.includes(',')) clamped = clamped.replace(/,/g, '').replace(/\s+/g, ' ').trim();
              // Hard cap 16 words
              const sw = clamped.split(/\s+/);
              if (sw.length > 16) clamped = sw.slice(0, 16).join(' ').trim();
              // Hard cap 110 chars
              if (clamped.length > 110) clamped = clamped.slice(0, 110).trim();
              // Re-ensure ends with punctuation
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
            const score = scoreRoast(clamped, tierName, nuclearLane, { requiredExposure });
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
        if (isDev) console.log(`[savage] round1: ${groupA.length} face-focused + ${groupB.length} context-focused = ${candidates.length} valid candidates from ${numCandidates} calls`);
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
      const bestScore = candidates.length > 0
        ? Math.max(...candidates.map(c => c.score))
        : -1;

      if (candidates.length === 0 || bestScore < 30) {
        if (isDev) console.log(`[${tierName}] round1 weak (count=${candidates.length}, bestScore=${bestScore}), triggering round2`);
        const harderSys = tierName === 'nuclear'
          ? systemMsg + ` BE HARSHER. Exactly 3 sentences. Sentence 1: vivid visual anchor (max 12 words). Sentence 2: ego hit using "you" statements (max 16 words). Sentence 3: knockout closer (2–5 words, caption-like). No questions. No filler. JSON ONLY.`
          : tierName === 'savage'
            ? systemMsg + ` EXACTLY ONE SENTENCE. 8–16 words ONLY. Pick ONE visible thing and destroy them with it. Last word must sting. NO template openers. NO "your expression". NO "you look like". JSON ONLY.`
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

      // --- Savage round 3: last-ditch retry before fallback ---
      if (tierName === 'savage' && candidates.length === 0) {
        if (isDev) console.log(`[savage] round1+2 empty, triggering round3 rewrite`);
        const rewriteSys = systemMsg + ` Rewrite the roast. Avoid numbers/attempt counts. Avoid repeating prior roasts. Keep within tier rules. JSON ONLY.`;
        const round3 = await generateCandidates(rewriteSys);
        if (isDev) console.log(`[savage] round3: ${round3.length} valid candidates`);
        candidates = round3;
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

      // Dev: log savage rejection distribution
      if (isDev && tierName === 'savage' && Object.keys(savageRejectCounts).length > 0) {
        const top = Object.entries(savageRejectCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.log(`[savage] rejection reasons: ${top.map(([r, c]) => `${r}=${c}`).join(', ')}`);
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
            const _bl = best.text.toLowerCase();
            const _hasVis = VISUAL_KEYWORDS.some(kw => _bl.includes(kw));
            const _hasEgo = SAVAGE_EGO_EXPOSURE_TOKENS.some(t => _bl.includes(t));
            const _bWords = best.text.trim().split(/\s+/);
            const _lastW = _bWords[_bWords.length - 1]?.toLowerCase().replace(/[^a-z-]/g, '') || '';
            const _hasVerdict = SAVAGE_PUNCH_ENDINGS.includes(_lastW);
            console.log(`[savage] anchor=${detectSavageAnchor(best.text)} structure=${detectSavageStructure(best.text)} mini-nuclear=${_hasVis}+${_hasEgo}+${_hasVerdict}`);
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
          // Anchor repetition tracking
          const winnerLower = trackText.toLowerCase();
          const winnerAnchors = NUCLEAR_ANCHOR_KEYWORDS.filter(kw => winnerLower.includes(kw));
          recentNuclearAnchors.push(winnerAnchors);
          if (recentNuclearAnchors.length > MAX_NUCLEAR_ANCHOR_TRACK) recentNuclearAnchors.shift();
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
          if (e.isExactLast && nonExact.length > 0) console.log(`[savage] fallback-skip-exact: "${e.text.slice(0, 60)}"`);
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
        if (isDev) console.log(`[savage] fallback-used: "${pick.text.slice(0, 60)}"`);
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
            if (isDev) console.log(`[savage] fallback-used: "${text.slice(0, 60)}"`);
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

    // --- Savage post-clamp: 16-word hard cap + ensure punctuation ---
    if (tierName === 'savage') {
      roasts = roasts.map(r => {
        const words = r.split(/\s+/);
        if (words.length > 16) {
          r = words.slice(0, 16).join(' ').trim();
        }
        // Ensure savage always ends with . or !
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

    res.json({ roasts });
  } catch (error) {
    console.error('Roast error:', error);
    // Return 200 with fallback roast so client always gets valid JSON (never HTML error pages)
    const safeTier = req.body?.level;
    const errorFallbacks = FALLBACKS[safeTier] || FALLBACKS.medium;
    const fallback = errorFallbacks[Math.floor(Math.random() * errorFallbacks.length)];
    res.status(200).json({ roasts: [fallback] });
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
      structureCounts[meta.pickedStructureId] = (structureCounts[meta.pickedStructureId] || 0) + 1;
      targetCounts[meta.pickedTarget] = (targetCounts[meta.pickedTarget] || 0) + 1;
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

app.listen(port, '0.0.0.0', () => {
  console.log(`Roast server running at http://0.0.0.0:${port}`);
});
