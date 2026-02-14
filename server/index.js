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
    style: 'sharper, more personal',
    format: 'short punchy lines',
  },
  savage: {
    count: 1,
    minChars: 350,
    style: 'brutal extended roast',
    format: 'ONE extended roast in paragraph form; no numbered list',
  },
  nuclear: {
    count: 1,
    minChars: 350,
    style: 'unfiltered, high intensity',
    format: 'ONE extended roast in paragraph form; vivid metaphors; strong closer; no numbered list',
  },
};

const BANNED_CLICHES = ['touch grass', 'NPC', 'potential', 'shower arguments', 'main character'];

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
    "There's a quiet desperation stitched into every pixel of this image — from the carefully curated background meant to suggest a life more interesting than the one you lead, to the expression that lands somewhere between 'I rehearsed this in the mirror' and 'I still don't know what I'm doing.' The lighting does you no favors either; it clings to every insecurity you thought the camera angle would hide. This is the visual equivalent of a résumé that lists 'fast learner' because there's nothing else to say. You didn't just take a bad photo — you documented mediocrity with the confidence of someone who genuinely can't tell the difference.",
  ],
  nuclear: [
    "Everything in this frame is trying too hard and achieving too little — a masterclass in the gap between effort and outcome. The pose, the angle, the background: each one a small, desperate negotiation with reality that you lost before the shutter clicked. Your expression carries the weight of someone who has Googled 'how to be interesting' and bookmarked the first result without reading it. The composition tells a story, and that story is a flat arc with no character development. If charisma were currency, this photo would be an overdraft notice — stamped, sealed, and sent back with a note that simply reads 'insufficient funds.'",
  ],
};

// Track recently used themes to avoid repetition across calls
const recentThemes = [];
const MAX_RECENT_THEMES = 15;

function buildPrompt(config, tierName, avoidThemes) {
  const bannedSection = config.minChars > 0
    ? `\nBANNED CLICHÉS (do NOT use these phrases): ${BANNED_CLICHES.join(', ')}`
    : '';

  const minCharsSection = config.minChars > 0
    ? `\n- Each roast MUST be at least ${config.minChars} characters long.`
    : '';

  let structureSection = '';
  if (tierName === 'savage') {
    structureSection = `
STRUCTURE:
- The roast must escalate in intensity from start to finish.
- The final sentence must be a short mic-drop line (under 12 words).
- The final sentence must be the strongest line in the roast.
- Do not soften, explain, or trail off after the final line.
- End decisively.`;
  } else if (tierName === 'nuclear') {
    structureSection = `
STRUCTURE:
- The roast must escalate more aggressively than Savage.
- The final sentence must be even shorter (under 8 words).
- The final sentence should feel abrupt, slightly chaotic, and final.
- No explanatory tone. No soft landing.
- End immediately after the mic-drop line.`;
  }

  return `You are generating image-based roasts.

INPUTS:
Tier: ${tierName}
Roast count: ${config.count}
Style: ${config.style}
Format: ${config.format}

GENERAL RULES:
- Produce exactly ${config.count} roast(s).
- Be specific to visible details in the image.
- No generic filler personality statements.
- Avoid these themes: ${avoidThemes}
- No hate speech, protected trait attacks, or illegal content.
- Do not include markdown, code fences, or explanations.${minCharsSection}${bannedSection}

INTENSITY:
- Tone & style: ${config.style}.
- Output format: ${config.format}.
- Reference at least one SPECIFIC visible detail from the image (hair, expression, clothing, posture, background, lighting).${structureSection}

IMPORTANT:
- Each roast must feel different in structure and angle.
- Do NOT repeat similar phrasing or reuse the same central joke.
- Tag each roast's theme (e.g. "messy room", "tired eyes", "try-hard outfit").

You MUST respond with ONLY a valid JSON object in this exact shape — no markdown, no code fences, no extra text:
{"roasts": ["roast one", ...], "themes": ["theme1", ...]}

The "roasts" array must contain exactly ${config.count} string(s).
The "themes" array should contain one theme tag per roast.`;
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

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content: `You are a sharp, observational roast comedian. You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanations.`,
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}` },
          ],
        },
      ],
    });

    const rawOutput = response.output_text;

    // --- Parse response ---
    let roasts = [];
    let themes = [];

    // Strip possible markdown fences
    const cleaned = rawOutput.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      roasts = Array.isArray(parsed.roasts) ? parsed.roasts : [];
      themes = Array.isArray(parsed.themes) ? parsed.themes : [];
    } catch {
      // Fallback: extract lines
      roasts = cleaned
        .split('\n')
        .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(line => line.length > 0)
        .slice(0, config.count);
    }

    // Clean & deduplicate
    roasts = roasts.map(r => String(r).trim()).filter(r => r.length > 0);

    const seen = new Set();
    roasts = roasts.filter(r => {
      const key = r.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Trim to requested count
    roasts = roasts.slice(0, config.count);

    // Fill with level-specific fallbacks if needed
    const levelFallbacks = FALLBACKS[tierName] || FALLBACKS.medium;
    for (const fb of levelFallbacks) {
      if (roasts.length >= config.count) break;
      if (!seen.has(fb.toLowerCase())) {
        roasts.push(fb);
        seen.add(fb.toLowerCase());
      }
    }

    roasts = roasts.slice(0, config.count);

    // Update rolling theme tracker
    if (themes.length > 0) {
      recentThemes.push(...themes.map(t => t.trim()).filter(t => t.length > 0));
      while (recentThemes.length > MAX_RECENT_THEMES) recentThemes.shift();
    }

    // Dev log
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[roast] level=${tierName} requested=${config.count} returned=${roasts.length}`);
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
