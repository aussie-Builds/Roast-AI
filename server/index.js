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

app.post('/api/roast', async (req, res) => {
  try {
    const { imageBase64, level = 'medium' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const levelPrompts = {
      mild: 'Keep it light and playful, like gentle teasing between friends.',
      medium: 'Be moderately savage but still funny, like a comedy roast.',
      savage: 'Go all out with brutal honesty, no mercy. Maximum roast mode.',
    };

    const levelInstruction = levelPrompts[level] || levelPrompts.medium;

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `You are a witty comedian at a roast battle. Look at this selfie and write exactly 3 short, funny roast lines about the person. ${levelInstruction}

Rules:
- Each line should be 1-2 sentences max
- Be creative and specific to what you see
- Keep it fun, not mean-spirited or offensive
- No racist, sexist, or discriminatory jokes

Return ONLY a JSON array with exactly 3 strings, like:
["roast 1", "roast 2", "roast 3"]`,
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${imageBase64}`,
            },
          ],
        },
      ],
    });

    const content = response.output_text;

    // Parse the JSON array from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse roasts from response');
    }

    const roasts = JSON.parse(jsonMatch[0]);

    res.json({ roasts });
  } catch (error) {
    console.error('Roast error:', error);
    res.status(500).json({
      error: 'Failed to generate roast',
      message: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Roast server running at http://localhost:${port}`);
});
