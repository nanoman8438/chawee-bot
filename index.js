require('dotenv').config();

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const Groq = require('groq-sdk');

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const TRIGGER_KEYWORDS = ['@ชาวี', 'ชาวี'];

const SYSTEM_PROMPT = `เธอคือ "คุณชาวี อัมราภรณ์" จากละครน้ำเน่ากามเทพ เป็นตัวละครเจ้าอารมณ์ อินจัด ขี้โวยวาย ปากไม่ตรงกับใจ ทิฐิสูง แต่ลึกๆ ใจดีและรักเพื่อนฝูงแบบกวนๆ

วิธีพูด:
- ขึ้นต้นประโยคด้วยคำอุทานแบบละครไทยบ่อยๆ เช่น "นี่เธอ!", "อะไรนะ!", "เหลวไหลที่สุด!", "โธ่เอ๊ย!"
- พูดจาดราม่าน้ำเน่า อินเนอร์สูง ชอบตัดพ้อโวยวายใส่คนที่คุยด้วย
- ทิฐิสูง ปากแข็ง แต่ถ้าเพื่อนเดือดร้อนจริงจะช่วยเต็มที่ (แค่ปากไม่ยอมรับตรงๆ)
- ตอบเป็นภาษาไทย สั้นกระชับพอเหมาะกับแชท ไม่ต้องยาวเป็นย่อหน้า
- ห้ามหลุดคาแรกเตอร์ ห้ามบอกว่าตัวเองเป็น AI หรือโมเดลภาษา`;

const app = express();
app.use(express.json());

const lineClient = new Client(lineConfig);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function isTriggered(text) {
  return TRIGGER_KEYWORDS.some((keyword) => text.includes(keyword));
}

async function askGroq(userText, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const message = await groq.chat.completions.create({
        model: 'mixtral-8x7b-32768',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      });
      return message.choices[0].message.content;
    } catch (err) {
      console.error(`Groq attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userText = event.message.text;

  if (!isTriggered(userText)) {
    return null;
  }

  let replyText;
  try {
    replyText = await askGroq(userText);
  } catch (err) {
    console.error('Groq error:', err);
    replyText = 'นี่เธอ! ตอนนี้หัวชาวีมันตื้อไปหมด เดี๋ยวค่อยคุยกันใหม่นะ!';
  }

  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText,
  });
}

app.post('/webhook', (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));

  if (!req.body.events || req.body.events.length === 0) {
    console.log('No events in webhook');
    return res.status(200).end();
  }
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error('Webhook error:', err);
      res.status(500).end();
    });
});

app.get('/', (req, res) => {
  res.send('Chawee LINE bot is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Chawee bot listening on port ${PORT}`);
});
