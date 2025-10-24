// Production-ready serverless function for creating OpenAI ephemeral sessions
// Enhanced version with realistic multi-scenario handling
// Improve the system control instructions for a taxi dispatcher AI - 21-oct-2025

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
        
        // ENHANCED SYSTEM INSTRUCTIONS
        instructions: `ROLE & OBJECTIVE
Ti si glas **Mega Taxi dispečera** iz Srbije.  
Tvoj zadatak je da ljubazno i brzo primiš poziv, zabeležiš adresu, broj putnika, telefon i posebne zahteve, potvrdiš podatke i javiš procenjeno vreme dolaska.  
Ako korisnik traži nešto van tvojih mogućnosti (reklamacija, ugovor, izgubljene stvari), preusmeri poziv kolegi.

VOICE & TONE
- Govori isključivo **na srpskom jeziku**, sa šumadijsko-vojvođanskim naglaskom.  
- Zvuk: vedar ženski glas, 20-25 godina, brz i jasan, kratke pauze.  
- Ton: prirodan, prijatan, miran; nasmejan ali ne prenaglašen.  
- Brzina: oko 1.25× normalnog govora; odgovori do 2 rečenice.  
- Uvek deluj kao da ti je prijatno da radiš, bez previše emocija.

STYLE & LANGUAGE
- Kratke rečenice, bez ponavljanja.  
- Ključne reči (adresa, vreme, broj) izgovaraj jasno.  
- Brojeve čitaj **cifru po cifru sa crticama** (064-123-4567).  
- Ako korisnik govori drugim jezikom:  
  „Izvinite, podrška je dostupna samo na srpskom jeziku."

STANDARDNI TOK RAZGOVORA
1️⃣ **Pozdrav:**  
„Dobar dan, ovde Mega taksi, izvolite?"

2️⃣ **Prikupljanje:**  
Slušaj adresu, broj putnika i posebne zahteve (dete, ljubimac, prtljag, invaliditet).  
Ako nešto nije jasno, ponovi i proveri:  
„Da potvrdim, to je [adresa]?"

3️⃣ **Provera i vreme:**  
„Sekund da proverim… imamo vozilo, stiže za [5 – 15] minuta."  
Dodaj uslov ako treba (noć +20 %, sneg +10 %, veliki pas +500 din).  

4️⃣ **Telefon:**  
„Molim broj telefona za kontakt?" → ponovi cifru po cifru.  

5️⃣ **Potvrda i kraj:**  
„Potvrđujem: [adresa] do [destinacija], [n putnika]. Vozilo je na putu. Hvala i prijatno!"

POSEBNE SITUACIJE
- **Hitno (aerodrom/bolnica):**  
„Prioritet vožnja – najbliži taksi stiže za 5 minuta. Broj tablica stiže SMS-om."
- **Noć:**  
„Važi noćna tarifa +20 %. Želite li ženskog vozača?"
- **Loše vreme:**  
„Šaljem vozilo sa lancima, stiže za 12 minuta. Budite unutra dok čekate."
- **Deca / stariji:**  
„Vozilo sa dečijim sedištem stiže za 10 minuta."
- **Ljubimac:**  
„OK za kućne ljubimce; ako je veliki, +500 din za veće vozilo – slažete li se?"
- **Reklamacija / ugovor:**  
„Preusmeriću vas kolegi koji to rešava." → pozovi alat \`transfer_to_support\`.

BEZBEDNOST I ESKALACIJA
- Ako korisnik zvuči frustrirano, preti, ili traži ljudskog operatera:  
  „Hvala na strpljenju, povezujem vas sa specijalistom." → pozovi \`escalate_to_human\`.
- Ako čuješ nejasan zvuk ili tišina:  
  „Izvinite, nisam razumela – možete ponoviti?"

SAMPLE PHRASES (menjaj, ne ponavljaj iste)
- „Sekund da proverim…"    „Imamo slobodno vozilo."  
- „Potvrđujem podatke."   „Hvala na pozivu."  
- „Prijatno!"   „Srećan put!"   „U svako doba."

CILJ
Zvuči kao pravi dispečer Mega Taksija – brzo, jasno i prijatno, da korisnik poželi da ponovo pozove.`,

        // INPUT TRANSCRIPTION (CRITICAL - must be enabled)
        input_audio_transcription: {
          model: 'whisper-1'
        },

        // IMPROVED TURN DETECTION - More natural pauses
        turn_detection: {
          type: 'server_vad',
          threshold: 0.48,              // updated on 24 oct 2025 for natural flow
          prefix_padding_ms: 270,      // Shorter padding before user speaks
          silence_duration_ms: 900     // Longer pause before AI responds (more natural)
        },

        // Modalities
        modalities: ['text', 'audio'],

        // RESPONSE CONFIGURATION - Faster, more natural
        temperature: 0.85,               // Slightly higher for more natural variation
        max_response_output_tokens: 2048, // Shorter responses (was 4096)

        // ENHANCED TOOLS FOR BOOKING
        tools: [
          {
            type: 'function',
            name: 'confirm_booking',
            description: 'Potvrđuje rezervaciju taksija sa svim detaljima',
            parameters: {
              type: 'object',
              properties: {
                pickup: {
                  type: 'string',
                  description: 'Adresa polaska (tačna lokacija)'
                },
                destination: {
                  type: 'string',
                  description: 'Odredište (tačna lokacija ili grad)'
                },
                fare: {
                  type: 'string',
                  description: 'Procena ili fiksna cena (npr: "400-600 din" ili "10,000 din fiksno")'
                },
                eta: {
                  type: 'string',
                  description: 'Vreme dolaska vozila (npr: "5-8 minuta")'
                },
                passengers: {
                  type: 'string',
                  description: 'Broj putnika'
                },
                special_requirements: {
                  type: 'string',
                  description: 'Specijalni zahtevi ako postoje (dete, prtljag, ljubimac, invaliditet, itd)'
                },
                phone: {
                  type: 'string',
                  description: 'Broj telefona korisnika'
                }
              },
              required: ['pickup', 'destination', 'fare', 'eta', 'phone']
            }
          },
          {
            type: 'function',
            name: 'quote_price',
            description: 'Daje procenu cene za rutu',
            parameters: {
              type: 'object',
              properties: {
                from: {
                  type: 'string',
                  description: 'Polazna lokacija'
                },
                to: {
                  type: 'string',
                  description: 'Odredište'
                },
                estimated_price: {
                  type: 'string',
                  description: 'Procenjena cena'
                },
                trip_type: {
                  type: 'string',
                  enum: ['city', 'intercity', 'airport'],
                  description: 'Tip vožnje'
                }
              },
              required: ['from', 'to', 'estimated_price', 'trip_type']
            }
          },
          {
            type: 'function',
            name: 'handle_complaint',
            description: 'Beleži žalbu i rešava problem',
            parameters: {
              type: 'object',
              properties: {
                ride_number: {
                  type: 'string',
                  description: 'Broj vožnje na koju se žali'
                },
                complaint_type: {
                  type: 'string',
                  enum: ['overcharge', 'rude_driver', 'late', 'route_issue', 'other'],
                  description: 'Tip žalbe'
                },
                resolution: {
                  type: 'string',
                  description: 'Ponuđeno rešenje (povraćaj novca ili besplatna vožnja)'
                }
              },
              required: ['complaint_type', 'resolution']
            }
          },
          {
            type: 'function',
            name: 'schedule_ride',
            description: 'Zakazuje vožnju za kasnije',
            parameters: {
              type: 'object',
              properties: {
                scheduled_time: {
                  type: 'string',
                  description: 'Vreme zakazivanja (npr: "sutra 6h", "15:30")'
                },
                pickup: {
                  type: 'string',
                  description: 'Adresa polaska'
                },
                destination: {
                  type: 'string',
                  description: 'Odredište'
                },
                phone: {
                  type: 'string',
                  description: 'Broj telefona'
                }
              },
              required: ['scheduled_time', 'pickup', 'phone']
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
