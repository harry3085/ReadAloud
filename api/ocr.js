const vision = require('@google-cloud/vision');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 required' });
    }

    // Support GOOGLE_VISION_KEY as JSON string or base64-encoded JSON
    let credentials;
    const keyEnv = process.env.GOOGLE_VISION_KEY;
    if (!keyEnv) {
      return res.status(500).json({ error: 'GOOGLE_VISION_KEY not set' });
    }
    try {
      credentials = JSON.parse(keyEnv);
    } catch {
      credentials = JSON.parse(Buffer.from(keyEnv, 'base64').toString('utf8'));
    }

    const client = new vision.ImageAnnotatorClient({ credentials });

    const [result] = await client.documentTextDetection({
      image: { content: imageBase64 },
    });

    const full = result.fullTextAnnotation;
    if (!full) {
      return res.status(200).json({ success: true, text: '', confidence: 0, blockCount: 0, provider: 'google-vision' });
    }

    const text = full.text || '';
    let totalConf = 0, wordCount = 0, blockCount = 0;

    for (const page of full.pages || []) {
      for (const block of page.blocks || []) {
        blockCount++;
        for (const para of block.paragraphs || []) {
          for (const word of para.words || []) {
            totalConf += (word.confidence || 0);
            wordCount++;
          }
        }
      }
    }

    const confidence = wordCount > 0 ? Math.round((totalConf / wordCount) * 100) : 0;

    res.status(200).json({ success: true, text, confidence, blockCount, provider: 'google-vision' });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: err.message || 'OCR failed' });
  }
};
