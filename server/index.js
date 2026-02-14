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
app.use(express.json({ limit: '10mb' }));

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
    maxWords: 16,
    maxSentences: 1,
    maxTokens: 40,
    temperature: 0.9,
    presence_penalty: 0.5,
    frequency_penalty: 0.3,
    style: 'one sharp stab — quick, visual, brutal',
    format: 'ONE sentence, 8–16 words, ends on a punch word; no list',
  },
  nuclear: {
    count: 1,
    minChars: 0,
    maxChars: 450,
    maxSentences: 4,
    maxTokens: 200,
    candidates: 6,
    temperature: 1.0,
    presence_penalty: 0.6,
    frequency_penalty: 0.3,
    style: 'cold, direct, personal, cutting — significantly harsher than savage',
    format: 'ONE roast (3–4 sentences, escalating intensity, short knockout closer); no numbered list',
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
  'upgrade', 'fix', 'try', 'go', 'get', 'stop', 'start', 'learn',
];

const SAVAGE_IMPERATIVES = [
  'upgrade', 'fix', 'try', 'go', 'get', 'stop', 'start', 'learn',
];

const SAVAGE_BANNED_PHRASES = [
  // template openers GPT-4o loves
  "i've seen brighter", 'that face just called', 'with that lighting',
  'you look like', 'one bad audition', 'sleep-deprived extra',
  // scene/horror framing
  'dimly lit shed', 'warehouse', 'garage', 'interrogated', 'interrogation',
  // advice framing
  "it's time to", 'time to', 'you should', 'you need to',
  'do better', 'fix that', 'upgrade both', 'try again', 'start over',
  // soft observational AI starters
  'screams', "it's like", 'with that', 'your expression screams',
  "i've seen", 'in this photo', 'this image', "you're the type",
];

const SAVAGE_BANNED_WORDS = [
  'alive', 'lifeless', 'hollow', 'void', 'desperate', 'lonely',
  'dead-eyed', 'soulless', 'empty',
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
    "That pose took you nine tries and this was the best one.",
    "You dress like you lost a bet and just kept going.",
    "That smile is doing community service for the rest of your face.",
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
SAVAGE RULES (STRICT):
- Exactly ONE sentence. No second sentence. No follow-ups. No explanations.
- 8–16 words total. Not shorter. Not longer.
- Reference ONE visible detail (hair, outfit, expression, lighting, pose, background, clothing).
- End on a punch word — the last word must sting. Not neutral, not trailing off.
- Use "you" or "your". Attack the person, not the scene.
- No "you look like". No "it's like". No "screams". No "with that".
- No storytelling. No metaphors. No similes. No scene-setting.
- No imperatives or advice (no "upgrade", "fix", "try", "stop", "start", "learn", "get", "go").
- No questions. No emojis. No encouragement.
- Quick stab. Clean cut. Walk away.
- Good examples: "Even your PC looks disappointed.", "That lighting did you zero favors.", "Confidence didn't load with the rest of you.", "Your mirror deserves hazard pay."
- NEVER use: ${SAVAGE_BANNED_PHRASES.join(', ')}
- NEVER use these words: ${SAVAGE_BANNED_WORDS.join(', ')}`;
  } else if (tierName === 'nuclear') {
    tierRules = `
NUCLEAR RULES (STRICT — must be significantly harsher than Savage):
- 3–4 sentences. Each sentence MUST escalate in intensity. Every line hits harder than the last.
- Sentence 1: ONE short clause about a visible detail (expression, posture, grooming, clothing). Do NOT spend more than one clause on background or lighting.
- Sentence 2: direct attack on character or personality — stated as cold fact, not a guess. Use "you" statements. Be harsh.
- Sentence 3: escalate into an embarrassing personality flaw or overconfidence based on visible details. Humiliate ego, not existence.
- Sentence 4 (optional but preferred): short knockout line (under 8 words). The most brutal sentence. Lands hardest.
- Do NOT imply the person is socially irrelevant or forgotten.
- Do NOT imply nobody notices them.
- Do NOT imply they have no value.
- Attack ego, overconfidence, styling, vibe, posture — not life worth.
- Humiliate presentation, not existence.
- The FINAL sentence must ALWAYS be the shortest and most brutal line.
- Final sentence: blunt declarative statement, max 5 words preferred. No question marks. No philosophical tone.
- Do NOT use closers like "you're irrelevant", "nobody cares", "forgettable", "lost cause", "living ghost". These are existential, not funny.
- Good knockout examples: "That angle lied.", "Confidence sold separately.", "Your vibe expired.", "Even the camera gave up."
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
  // Enforce character limit — trim at word boundary
  if (maxChars && r.length > maxChars) {
    r = r.slice(0, maxChars);
    const lastSpace = r.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.5) r = r.slice(0, lastSpace);
    // End on sentence boundary if possible
    const lastPunct = r.search(/[.!?][^.!?]*$/);
    if (lastPunct > maxChars * 0.4) r = r.slice(0, lastPunct + 1);
    r = r.trim();
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

// --- Roast validator: returns { valid, reasons } ---
const JSON_MARKERS = ['{', '}', '[', ']', '":', 'roasts', 'output:', 'response:'];
const BANNED_SOFT = [
  'at what cost', "it's as if", 'suggests', 'reads as', 'perhaps', 'maybe',
  'in a way', 'seems like', 'you should', 'could help', 'try to', 'as an ai',
  'your machines',
];
const VISUAL_KEYWORDS = [
  'hair', 'lighting', 'expression', 'background', 'pose', 'eyes', 'smile',
  'outfit', 'shirt', 'face', 'look', 'jaw', 'glasses', 'hat', 'hoodie',
  'posture', 'arms', 'hands', 'standing', 'sitting', 'leaning', 'staring',
  'grin', 'smirk', 'frown', 'squint', 'selfie', 'angle', 'shadow',
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
  if (tierName === 'savage' && text.length > 140) reasons.push(`too-long:${text.length}/140`);
  if (tierName === 'nuclear' && text.length > 400) reasons.push(`too-long:${text.length}/400`);

  // Must reference a visible detail (hard-fail for savage, scoring penalty for nuclear)
  const hasVisual = VISUAL_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasVisual && tierName !== 'nuclear') reasons.push('no-visual-detail');

  // Savage-only validation
  if (tierName === 'savage') {
    const savageWordCount = text.trim().split(/\s+/).length;
    // Must be 8–16 words
    if (savageWordCount > 16) reasons.push(`savage-too-many-words:${savageWordCount}/16`);
    if (savageWordCount < 8) reasons.push(`savage-too-few-words:${savageWordCount}/8`);
    // Exactly 1 sentence
    const sSentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    if (sSentences.length > 1) reasons.push(`savage-multi-sentence:${sSentences.length}`);
    // No questions
    if (text.includes('?')) reasons.push('savage-question');
    // Banned phrases
    for (const phrase of SAVAGE_BANNED_PHRASES) {
      if (lower.includes(phrase)) { reasons.push(`savage-banned:${phrase}`); break; }
    }
    // Banned words (bleak tone)
    for (const word of SAVAGE_BANNED_WORDS) {
      const re = new RegExp(`\\b${word}\\b`, 'i');
      if (re.test(text)) { reasons.push(`savage-banned-word:${word}`); break; }
    }
    // No sentences starting with imperative verbs
    for (const s of sSentences) {
      const fw = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (SAVAGE_IMPERATIVES.includes(fw)) {
        reasons.push(`savage-imperative:${fw}`);
        break;
      }
    }
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
    // Nuclear-only: no advice/imperatives — check if any sentence starts with one
    const nSentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    for (const s of nSentences) {
      const firstWord = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (NUCLEAR_IMPERATIVES.includes(firstWord)) {
        reasons.push(`nuclear-imperative:${firstWord}`);
        break;
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

function scoreRoast(text, tierName) {
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

  // --- Savage-specific scoring ---
  if (tierName === 'savage') {
    const wordCount = text.trim().split(/\s+/).length;
    const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];

    // Reward: sweet spot 8–16 words
    if (wordCount >= 8 && wordCount <= 16) score += 25;
    // Penalize: outside range
    if (wordCount > 16) score -= 40;
    if (wordCount < 8) score -= 20;

    // Reward: exactly 1 sentence; penalize 2+
    if (sentences.length === 1) score += 20;
    else score -= 30;

    // Reward: direct address ("you" / "your")
    const youCount = (lower.match(/\byou(r|'re|'ve|'ll)?\b/g) || []).length;
    if (youCount >= 1) score += 15;
    if (youCount === 0) score -= 15;

    // Reward: ends with punch punctuation
    if (/[.!]$/.test(text.trim())) score += 10;

    // Reward: visual anchor present
    const savageVisualHits = VISUAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
    if (savageVisualHits >= 1) score += 10;
    if (savageVisualHits === 0) score -= 10;

    // Penalize: banned phrases (-25 each)
    for (const bp of SAVAGE_BANNED_PHRASES) {
      if (lower.includes(bp)) score -= 25;
    }
    // Penalize: banned bleak words (-15 each)
    for (const bw of SAVAGE_BANNED_WORDS) {
      const re = new RegExp(`\\b${bw}\\b`, 'i');
      if (re.test(text)) score -= 15;
    }
    // Penalize: imperative openers
    const fw = sentences[0]?.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
    if (SAVAGE_IMPERATIVES.includes(fw)) score -= 30;
    // Penalize: questions
    if (text.includes('?')) score -= 15;
  }

  // --- Nuclear-specific scoring ---
  if (tierName === 'nuclear') {
    const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];
    const wordCount = text.trim().split(/\s+/).length;

    // Reward: 3–4 sentences (ideal escalation structure)
    if (sentences.length >= 3 && sentences.length <= 4) score += 15;
    // Penalize: too few sentences (feels like savage, not nuclear)
    if (sentences.length < 3) score -= 10;

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

    // Reward: strong direct assertions anywhere
    const strongAssertions = ['you are', "you're", "you've", 'you never', 'you always'];
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

    // Reward: strong direct assertions in middle sentences
    const directAssertions = ['you are', "you're", "you've", 'you never', 'you always', "that's why", "that's what"];
    const midSentences = sentences.slice(1, -1).join(' ').toLowerCase();
    const assertionHits = directAssertions.filter(a => midSentences.includes(a)).length;
    score += Math.min(assertionHits, 3) * 5;

    // Reward: final sentence is shortest (knockout line)
    const lastSentence = sentences[sentences.length - 1] || '';
    const lastWordCount = lastSentence.trim().split(/\s+/).length;
    if (lastWordCount <= 8) score += 15;
    if (lastWordCount <= 5) score += 10; // strong knockout bonus
    const lastLower = lastSentence.toLowerCase();

    // Penalize: worthlessness language anywhere in text (word-boundary, -80 per hit, capped -160)
    let worthlessPenalty = 0;
    for (const wp of NUCLEAR_BANNED_WORTHLESSNESS) {
      const re = new RegExp(`\\b${wp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) worthlessPenalty += 80;
    }
    score -= Math.min(worthlessPenalty, 160);

    // Penalize: final sentence contains question mark
    if (lastSentence.includes('?')) score -= 15;
    // Reward: final sentence ≤5 words and declarative (ends with period/exclamation, no question)
    if (lastWordCount <= 5 && /[.!]$/.test(lastSentence.trim()) && !lastSentence.includes('?')) score += 15;
    // Reward: final sentence ≤6 words, declarative, and NOT starting with imperative
    const lastFirstWord = lastSentence.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
    if (lastWordCount <= 6 && /[.!]$/.test(lastSentence.trim()) && !lastSentence.includes('?') && !NUCLEAR_IMPERATIVES.includes(lastFirstWord)) score += 15;

    // Reward: escalation shape — final sentence shorter than first
    if (sentences.length >= 3) {
      const firstWordCount = (sentences[0] || '').trim().split(/\s+/).length;
      if (lastWordCount < firstWordCount) score += 5;
    }

    // Reward: in target word range (40–110)
    if (wordCount >= 40 && wordCount <= 110) score += 10;

    // Penalize: too short for nuclear (feels like savage)
    if (wordCount < 30) score -= 15;

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
    if (lower.includes('screams')) score -= 10;
    if (lower.includes('life achievements')) score -= 10;

    // Penalize: AI-written phrases (each -15, capped -45)
    const aiPhrases = ['your expression matches', 'you project', "it's like", 'you radiate'];
    let aiPhrasePenalty = 0;
    for (const ap of aiPhrases) {
      if (lower.includes(ap)) aiPhrasePenalty += 15;
    }
    score -= Math.min(aiPhrasePenalty, 45);

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
  }

  return score;
}

app.post('/api/roast', async (req, res) => {
  try {
    const { imageBase64, level = 'medium' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const tierName = Object.hasOwn(INTENSITY_CONFIG, level) ? level : 'medium';
    const config = INTENSITY_CONFIG[tierName];
    const avoidThemes = recentThemes.length > 0 ? recentThemes.join(', ') : 'none yet';

    const prompt = buildPrompt(config, tierName, avoidThemes);
    const isHighTier = tierName === 'nuclear';

    const systemMsg = tierName === 'savage'
      ? `You are a roast comedian. ONE sentence. 8–16 words. Reference something visible. End on a punch word. Respond with ONLY valid JSON. No markdown. No code fences.`
      : tierName === 'nuclear'
        ? `You are a ruthless roast comedian. Respond with ONLY valid JSON. No markdown. No code fences. No explanations. 3–4 sentences, escalating intensity, short knockout closer. Cold and cutting.`
        : `You are a sharp, observational roast comedian. You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanations.`;

    const imageContent = [
      { type: 'input_text', text: prompt },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
    ];

    // --- Build call options (with model params per tier) ---
    const buildCallOptions = (sysContent) => {
      const opts = {
        model: 'gpt-4o',
        input: [
          { role: 'system', content: sysContent },
          { role: 'user', content: imageContent },
        ],
      };
      if (config.maxTokens) opts.max_output_tokens = config.maxTokens;
      if (config.temperature != null) opts.temperature = config.temperature;
      if (config.presence_penalty != null) opts.presence_penalty = config.presence_penalty;
      if (config.frequency_penalty != null) opts.frequency_penalty = config.frequency_penalty;
      return opts;
    };

    let roasts = [];
    let themes = [];
    const levelFallbacks = FALLBACKS[tierName] || FALLBACKS.medium;
    const isDev = process.env.NODE_ENV !== 'production';

    if (isHighTier) {
      // --- Multi-sample generation for savage/nuclear ---
      const numCandidates = config.candidates || 4;

      const generateCandidates = async (sysContent) => {
        const calls = Array.from({ length: numCandidates }, () =>
          openai.responses.create(buildCallOptions(sysContent))
            .then(r => r.output_text)
            .catch(() => null)
        );
        const outputs = await Promise.all(calls);
        const candidates = [];
        for (const raw of outputs) {
          if (!raw) continue;
          const result = parseModelOutput(raw, config);
          if (!result.jsonParsed || result.roasts.length === 0) {
            if (isDev) console.log(`[roast] candidate rejected: json-parse-fail`);
            continue;
          }
          for (const r of result.roasts) {
            const clamped = clampRoast(r.replace(/\s+/g, ' ').trim(), config.maxSentences, config.maxChars, config.maxWords);
            if (!clamped) continue;
            const v = validateRoast(clamped, tierName);
            if (!v.valid) {
              if (isDev) console.log(`[roast] candidate rejected: ${v.reasons.join(', ')} — "${clamped.slice(0, 60)}…"`);
              continue;
            }
            const score = scoreRoast(clamped, tierName);
            candidates.push({ text: clamped, score, themes: result.themes });
            if (isDev) console.log(`[roast] candidate score=${score} — "${clamped.slice(0, 60)}…"`);
          }
        }
        return candidates;
      };

      // Round 1: generate candidates
      let candidates = await generateCandidates(systemMsg);
      if (isDev) console.log(`[${tierName}] round1: ${candidates.length} valid candidates from ${numCandidates} calls`);

      // Round 2: if all failed or best score too low, retry with harder prompt
      const bestScore = candidates.length > 0
        ? Math.max(...candidates.map(c => c.score))
        : -1;

      if (candidates.length === 0 || bestScore < 30) {
        if (isDev) console.log(`[${tierName}] round1 weak (count=${candidates.length}, bestScore=${bestScore}), triggering round2`);
        const harderSys = tierName === 'nuclear'
          ? systemMsg + ` BE HARSHER. Sentence 1: vivid visual anchor. Sentence 2: character hit using "you" statements. Sentence 3: deeper life failure inferred from what's visible. Sentence 4: short knockout (under 8 words). Final sentence must be shortest. No questions. No filler. JSON ONLY.`
          : systemMsg + ` BE MUCH SHORTER. MAX 25 WORDS. RESPOND WITH ONLY JSON. NO ESSAYS.`;
        const round2 = await generateCandidates(harderSys);
        if (isDev) console.log(`[${tierName}] round2: ${round2.length} valid candidates`);
        candidates = candidates.concat(round2);
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        roasts = [best.text];
        themes = best.themes || [];
        if (isDev) {
          console.log(`[${tierName}] PICKED score=${best.score} from ${candidates.length} total — "${best.text.slice(0, 80)}…"`);
          if (candidates.length > 1) console.log(`[${tierName}] runner-up score=${candidates[1].score}`);
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
    for (const fb of levelFallbacks) {
      if (roasts.length >= config.count) break;
      const text = (config.maxSentences || config.maxChars)
        ? clampRoast(fb, config.maxSentences, config.maxChars, config.maxWords)
        : fb;
      if (text.length > 0 && !seen.has(text.toLowerCase())) {
        roasts.push(text);
        seen.add(text.toLowerCase());
      }
    }

    roasts = roasts.slice(0, config.count);

    // --- Final hard clamp (safety net) ---
    if (config.maxSentences || config.maxChars || config.maxWords) {
      roasts = roasts
        .map(r => clampRoast(r, config.maxSentences, config.maxChars, config.maxWords))
        .filter(r => r.length > 0);
    }

    // --- Savage post-clamp 16-word hard cap ---
    if (tierName === 'savage') {
      roasts = roasts.map(r => {
        const words = r.split(/\s+/);
        if (words.length > 16) {
          let trimmed = words.slice(0, 16).join(' ').trim();
          if (!/[.!?]$/.test(trimmed)) trimmed += '.';
          return trimmed;
        }
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
    res.status(500).json({
      error: 'Failed to generate roast',
      message: error.message,
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Roast server running at http://0.0.0.0:${port}`);
});
