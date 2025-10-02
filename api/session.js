// Production-ready serverless function for creating OpenAI ephemeral sessions
// Includes rate limiting, error handling, and proper CORS

const rateLimitMap = new Map();
const MAX_SESSIONS_PER_IP = 10;
const RATE_LIMIT_WINDOW = 3600000; // 1 hour

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting by IP
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  
  if (rateLimitMap.has(clientIp)) {
    const { count, timestamp } = rateLimitMap.get(clientIp);
    
    if (now - timestamp < RATE_LIMIT_WINDOW) {
      if (count >= MAX_SESSIONS_PER_IP) {
        return res.status(429).json({ 
          error: 'Too many requests. Please try again later.' 
        });
      }
      rateLimitMap.set(clientIp, { count: count + 1, timestamp });
    } else {
      rateLimitMap.set(clientIp, { count: 1, timestamp: now });
    }
  } else {
    rateLimitMap.set(clientIp, { count: 1, timestamp: now });
  }

  // Clean up old rate limit entries
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now - data.timestamp > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // Validate API key
  if (!OPENAI_API_KEY || !OPENAI_API_KEY.startsWith('sk-')) {
    console.error('Invalid or missing OPENAI_API_KEY');
    return res.status(500).json({ 
      error: 'Server configuration error',
      details: 'API key not properly configured'
    });
  }

  try {
    // Create ephemeral session with OpenAI
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'marin',
        
        // System instructions
        instructions: `Ti si Mega Taxi dispečer podrška.

Pravila ponašanja:
- Uvek govori isključivo na srpskom jeziku, sa šumadijsko-vojvođanskim naglaskom
- Zvuči kao vedra, mlada devojka iz ranih studentskih dana koja priča brzo, ali sa pauzama
- Ton neka bude prirodan i prijateljski, sa vrlo malo emocija – kao da razgovaraš sa poznanikom
- Ritam govora treba da bude brz, jasan i smiren
- Prenesi pozitivnu smirenost, kao da imaš dobar dan i prija ti da radiš, ali nemoj preterivati sa emocijama

Tok razgovora:

1. Pozdrav:
"Dobar dan, ovde Mega taksi, izvolite?"

2. Kada korisnik navede adresu:
Kratka pauza i potvrdi adresu ponavljanjem, pa nastavi:
"Sekund da proverim za vas… aha, imamo slobodno vozilo, stiže za [5/7/8/10] minuta."

3. Ako korisnik zahvali:
"U svako doba. Prijatno!"

Cilj: Zvuči prijatno, poznato i profesionalno tako da korisnik poželi da pozove ponovo.

Važno:
- Drži odgovore kratke i prirodne
- Budi brza ali jasna
- Potvrdi adresu ponavljanjem
- Daj realno vreme dolaska (5-10 minuta)
- Ostani profesionalna ali prijateljska`,

        // Enable input transcription (CRITICAL)
        input_audio_transcription: {
          model: 'whisper-1'
        },

        // Configure turn detection for natural conversation
        turn_detection: {
          type: 'server_vad',
          threshold: 0.55,
          prefix_padding_ms: 300,
          silence_duration_ms: 700
        },

        // Modalities
        modalities: ['text', 'audio'],

        // Response configuration
        temperature: 0.8,
        max_response_output_tokens: 4096,

        // Tool for booking confirmation
        tools: [
          {
            type: 'function',
            name: 'confirm_booking',
            description: 'Confirms the taxi booking with pickup, destination, fare and ETA',
            parameters: {
              type: 'object',
              properties: {
                pickup: {
                  type: 'string',
                  description: 'Pickup location'
                },
                destination: {
                  type: 'string',
                  description: 'Destination location'
                },
                fare: {
                  type: 'string',
                  description: 'Estimated fare in Rs'
                },
                eta: {
                  type: 'string',
                  description: 'Estimated time of arrival'
                }
              },
              required: ['pickup', 'destination', 'fare', 'eta']
            }
          }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      
      return res.status(response.status).json({
        error: 'Failed to create session with OpenAI',
        details: response.status === 401 ? 'Invalid API key' : 'Service temporarily unavailable',
        statusCode: response.status
      });
    }

    const data = await response.json();

    // Return ephemeral credentials to frontend
    return res.status(200).json({
      client_secret: data.client_secret.value,
      session_id: data.id,
      expires_at: data.client_secret.expires_at,
    });

  } catch (error) {
    console.error('Session creation error:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Unable to create session',
      details: 'Please try again or contact support if the issue persists'
    });
  }
}
