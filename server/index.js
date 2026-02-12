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

// Track recently used themes to avoid repetition across calls
const recentThemes = [];
const MAX_RECENT_THEMES = 15;

app.post('/api/roast', async (req, res) => {
  try {
    const { imageBase64, level = 'medium' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const tierName = ['mild', 'medium', 'savage', 'nuclear'].includes(level) ? level : 'medium';
    const previousThemes = recentThemes.length > 0 ? recentThemes.join(', ') : 'none';

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'system',
          content: `You are a sharp, observational roast comedian. You MUST respond with ONLY a valid JSON array of 3 strings — no markdown, no code fences, no explanations, no extra text. Example: ["roast one", "roast two", "roast three"]`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `You are generating image-based roasts.

INPUTS:
Tier: ${tierName}
Previously Used Themes: ${previousThemes}

GENERAL RULES:
- Produce exactly 3 distinct roasts.
- Each roast must be 1-2 sentences.
- Be specific to visible details in the image.
- No generic filler personality statements.
- Avoid repeating themes listed in Previously Used Themes.
- No hate speech, protected trait attacks, or illegal content.
- Do not include markdown or explanations.
- Return ONLY a JSON array of 3 strings.

INTENSITY RULES BY TIER:

If Tier is "mild":
- Light teasing. Friendly tone. Playful observations. Minimal sting. Social-media safe.

If Tier is "medium":
- Noticeable bite. Clever sarcasm. Personal but not brutal. Stronger contrast or exaggeration.

If Tier is "savage":
- Each roast MUST use a different comedic angle: 1) Competence/intelligence attack, 2) Social status/vibe humiliation, 3) Existential/personality indictment.
- Each roast must reference at least one SPECIFIC visible detail from the image (hair, expression, clothing, posture, background, lighting). The detail must prove the image was observed.
- Do NOT invent impossible traits. Only use plausible visible features.
- Do NOT reuse sentence structures or openers across the 3 roasts.
- Do NOT repeat distinctive phrases (2+ words) across roasts.
- AVOID common templates: "You look like...", "You have the energy of...", "I've seen...", "You remind me of...", "You seem like..."
- Tone: Brutal. Sharp. Intelligent. No apologies. No reassurance. No emojis. No positivity sandwich.
- Internal process: Draft 6-8 candidate roasts, then select the 3 most diverse in wording, structure, and angle. Output only the final 3.

If Tier is "nuclear":
- Maximum intensity. Layered metaphors. Brutally clever. Feels like a professional roast comic dissected the image. Escalate beyond savage without being abusive.

IMPORTANT:
- Each roast must feel different in structure and angle.
- Do NOT repeat similar phrasing.
- Do NOT reuse the same central joke.
- After each roast, mentally tag its theme (e.g. "messy room", "tired eyes", "try-hard outfit"). Include these tags at the end as: THEMES: tag1, tag2, tag3

Return format:
["roast one", "roast two", "roast three"]
THEMES: tag1, tag2, tag3`,
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${imageBase64}`,
            },
          ],
        },
      ],
    });

    const rawOutput = response.output_text;

    // Extract theme tags if present, then strip them from the JSON
    const themeLine = rawOutput.match(/THEMES:\s*(.+)/i);
    if (themeLine) {
      const newThemes = themeLine[1].split(',').map(t => t.trim()).filter(t => t.length > 0);
      recentThemes.push(...newThemes);
      while (recentThemes.length > MAX_RECENT_THEMES) recentThemes.shift();
    }

    const jsonPart = rawOutput.replace(/THEMES:.+/i, '').trim();

    let roasts;
    try {
      const parsed = JSON.parse(jsonPart);
      // Support both ["...", "...", "..."] and {"roasts": ["...", "...", "..."]}
      roasts = Array.isArray(parsed) ? parsed : parsed.roasts;
    } catch {
      // Fallback: split raw text into lines
      roasts = jsonPart
        .split('\n')
        .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(line => line.length > 0);
    }

    // Ensure roasts is an array of trimmed strings
    if (!Array.isArray(roasts)) {
      roasts = [];
    }
    roasts = roasts.map(r => String(r).trim()).filter(r => r.length > 0);

    // Remove duplicates (case-insensitive)
    const seen = new Set();
    const uniqueRoasts = roasts.filter(r => {
      const key = r.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Fill remaining slots from fallback if fewer than 3 unique roasts
    const fallbacks = [
      "You look like you rehearse arguments in the shower and still lose.",
      "That expression says 'I had potential once.'",
      "You don't chase dreams. You bookmark them.",
      "You look like your inner monologue needs subtitles.",
      "Your vibe is buffering.",
    ];

    for (const fb of fallbacks) {
      if (uniqueRoasts.length >= 3) break;
      if (!seen.has(fb.toLowerCase())) {
        uniqueRoasts.push(fb);
        seen.add(fb.toLowerCase());
      }
    }

    res.json({ roasts: uniqueRoasts.slice(0, 3) });
  } catch (error) {
    console.error('Roast error:', error);
    res.status(500).json({
      error: 'Failed to generate roast',
      message: error.message
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Roast server running at http://0.0.0.0:${port}`);
});
