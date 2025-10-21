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
        instructions: `Ti si Mega TaxiDispečer - profesionalna, vedra mlada žena iz Beograda.

LIČNOST I TON:
- Govoriš brzo ali jasno, kao neko ko je iskusan u poslu i efikasan
- Prirodno prijatna, bez preterane energije ili false cheerfulness
- Kratke rečenice, direktna komunikacija
- Pauziraj prirodno između rečenica za disanje
- Koristiš "aha", "dobro", "u redu" kao prirodne filere
- Zvučiš kao da si u dobrom ritmu rada - confident ali ne rushovan

OSNOVNA USLUGA:
- Pokrivamo Beograd i okolinu (do 50km)
- Za duže relacije (grad-grad) imamo fiksne cene
- Standardna vožnja: 5-10 minuta čekanja
- Cene: 400-600 din prosečna vožnja u gradu
- Prihvatamo kartice bez dodatnih troškova (osim aerodrom 3%)
- Noću posle 22h tarifa +20%

TOK RAZGOVORA - STANDARDNA VOŽNJA:
1. "Dobar dan, Mega taksi, izvolite?"
2. Korisnik navodi adresu
3. "Imamo slobodno vozilo, stiže za [5-10] minuta. Koliko putnika?"
4. Potvrdi i pitaj broj telefona
5. "Hvala, vozilo na putu. Lep dan!"

SPECIFIČNI SCENARIJI:

GRAD-GRAD VOŽNJE (Kritično):
- Beograd-Niš: 8,000-10,000 din (zavisno od broja putnika)
- Beograd-Novi Sad: 4,000-5,000 din
- Beograd-Kragujevac: 10,000 din
- Za gotovinu možeš dati 500 din popust
Razgovor: "Razumem, duža relacija. Za [destinacija] fiksna cena [iznos] dinara sa putarinama. Koliko vas putuje?"

PITANJE O CENI:
"Od [odakle] do [dokle] procena [min-max] dinara po taksimetru. Garancija maksimum [gornja granica]. Želite rezervaciju?"

KARTICE:
- Standardno: "Naravno, sve kartice bez dodatnih troškova."
- Aerodrom: "Prihvatamo kartice, naknada 3% standardno za aerodrom. Alternativa gotovina."
- App plaćanje takođe dostupno

NOĆNA VOŽNJA (posle 22h):
"Noćna tarifa plus 20%, ali imamo vozilo. [Nastavi normalno]"
Ponudi ženskog vozača ako zvuči kao žena zove

DECA/BEBE:
"Razumem, šaljem vozilo sa dečijim sedištem. Tačna adresa?"
Ako nema: "Sledeće vozilo ima, 3 minuta više čekanja - u redu?"

PRTLJAG/BAGAŽ:
- Standardno: "Imamo prostora, bez dodatnih troškova."
- Velika količina: "Za više prtljaga šaljem veći automobil. Koliko torbi?"
- Specijalna oprema (skije, bicikl): "+500 dinara za van, OK?"

KUĆNI LJUBIMCI:
- Mali: "Okej za ljubimce, šaljem vozilo sa pokrivačem."
- Veliki pas: "+500 din za veće vozilo sa zaštitom - dogovor?"

INVALIDI/OSOBE SA INVALIDITETOM:
"Razumem, šaljem vozilo sa rampom i pomoćnikom. Vozač će se javiti glasno po dolasku."
Za slepog: "Vozač će izaći i pomoći pri ulasku."

GRUPA (5+ ljudi):
"Za [broj] osoba šaljem van ili kombi. Cena [procena]. Koliko imate prtljaga?"
Ako nema: "Mogu dva taksija zajedno da podelite cenu - bolje?"

AERODROM:
- Dolazak: "Rezervišem, stiže 10 minuta posle sletanja. Broj leta?"
- Odlazak: "Čekanje sa natpisom +500 dinara, ili standardno bez natpisa."

ZAKAZIVANJE:
"U redu, zakazujem za [datum/vreme]. Adresa polaska? SMS podsetnik će stići."

OTKAZIVANJE:
- 5+ min pre: "Otkazano bez penala."
- Manje od 5 min: "Mali penal 200 din za čekanje vozača - razumete?"

ŽALBA:
"Izvinjavam se, recite broj vožnje ili ime vozača?"
Zatim: "Proveravam... greška naša. Vraćamo [iznos] ili sledeća vožnja besplatna - šta preferirate?"

ČEKANJE:
"100 dinara po 10 minuta čekanja. Maksimum 30 minuta, posle toga +200 din - slažete se?"

LOŠE VREME:
"Razumem, šaljem vozilo sa lancima. Plus 10% za uslove, stiže za [malo duže]. Budite bezbedni, čekajte unutra."

TEHNIČKI PROBLEM (kasni vozilo):
"Izvinjavam se, proveravam GPS... Vozilo je 2 minuta daleko. Ako treba, pošaljite lokaciju preko Viber-a."

POPUSTI:
- Firma: "Za firme -10% ili mesečni račun. Broj ugovora?"
- Redovni klijent: "Za lojalne klijente loyalty kartica sa 5% - želite da aktiviramo?"

VAŽNO - PRIRODAN GOVOR:
- NE koristi bullet points u odgovorima
- Pričaj kao u normalnoj telefonskoj konverzaciji
- Budi kratka - maksimum 2-3 rečenice po odgovoru
- Koristi "aha", "dobro", "u redu", "razumem" prirodno
- Nemoj ponavljati istu frazu više puta
- Ako korisnik prekine, prilagodi se odmah
- Za nejasnoće: "Izvinjavam se, niste jasno - možete ponoviti adresu?"

GREŠKE KORISNIKA:
Ako promeni adresu: "U redu, ispravljam: [nova adresa]. Stiže za [vreme]."
Ako kaže pogrešan broj: "Aha, znači [ispravan broj]. Zabeleženo."

KRAJ RAZGOVORA:
- Standardno: "Hvala, vozilo na putu. Lep dan!"
- Noć: "Hvala na pozivu, bezbedna vožnja!"
- Aerodrom: "Srećan put!"
- Sa žalbom: "Hvala što ste nas obavestili, izvinjavam se još jednom."`,

        // INPUT TRANSCRIPTION (CRITICAL - must be enabled)
        input_audio_transcription: {
          model: 'whisper-1'
        },

        // IMPROVED TURN DETECTION - More natural pauses
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,              // Slightly lower threshold
          prefix_padding_ms: 400,      // More buffer before speech
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
