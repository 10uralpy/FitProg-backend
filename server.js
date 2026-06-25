import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Buffer } from 'buffer';

dotenv.config();

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// HEIC/HEIF base64'u JPEG base64'e cevir
async function convertToJpeg(dataUrl) {
  if (!dataUrl) return dataUrl;
  
  // Zaten JPEG/PNG/WebP ise dokunma
  if (dataUrl.includes('data:image/jpeg') || 
      dataUrl.includes('data:image/png') || 
      dataUrl.includes('data:image/webp') ||
      dataUrl.includes('data:image/gif')) {
    return dataUrl;
  }
  
  // HEIC veya bilinmeyen format - base64 datayı al ve jpeg olarak etiketle
  // OpenAI base64 gonderiminde format kontrolu yapiyor, bu yuzden
  // base64 datadan format header'ini okuyup JPEG olarak gondericegiz
  try {
    const base64Data = dataUrl.split(',')[1] || dataUrl;
    const buffer = Buffer.from(base64Data, 'base64');
    
    // JPEG magic bytes kontrolu (FF D8 FF)
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      return 'data:image/jpeg;base64,' + base64Data;
    }
    // PNG magic bytes (89 50 4E 47)
    if (buffer[0] === 0x89 && buffer[1] === 0x50) {
      return 'data:image/png;base64,' + base64Data;
    }
    // WebP (52 49 46 46)
    if (buffer[0] === 0x52 && buffer[1] === 0x49) {
      return 'data:image/webp;base64,' + base64Data;
    }
    
    // Bilinmeyen format - JPEG olarak dene
    return 'data:image/jpeg;base64,' + base64Data;
  } catch(e) {
    return dataUrl;
  }
}


function extractJSON(text) {
  if (!text || typeof text !== 'string') throw new Error('AI gecersiz yanit dondu');
  let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON bulunamadi');
  return clean.slice(start, end + 1);
}

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'FitProg Backend' });
});

app.post('/api/analyze', async (req, res) => {
  req.socket.setTimeout(120000);
  res.setTimeout(120000);
  try {
    const { photos, profile } = req.body;
    console.log('Analiz basladi...');

    if (!photos?.front || !photos?.side || !photos?.back) {
      return res.status(400).json({ success: false, error: '3 fotograf gerekli' });
    }

    // Her formati JPEG'e cevir (HEIC dahil)
    const frontPhoto = await convertToJpeg(photos.front);
    const sidePhoto = await convertToJpeg(photos.side);
    const backPhoto = await convertToJpeg(photos.back);

    // Vücut yağı ve hedefe göre strateji belirle
    const goalLabel = profile.primaryGoal === 'muscle' ? 'kas kazanma' : profile.primaryGoal === 'lose' ? 'yag yakma' : 'formda kalma';

    const prompt = `You are a world-class physique coach who deeply understands body composition, aesthetics, and human psychology. You analyze bodies the way a great coach does — honest about weaknesses, but equally strong about acknowledging what's working. Your goal is not to crush or inflate egos, but to give users the feeling: "This app actually looked at ME."

Analyze the user from THREE photos: front, side, back.
Return ONLY valid JSON. No markdown, no explanation outside JSON.

USER INFO:
Age: ${profile.age || 25} | Height: ${profile.height || 170}cm | Weight: ${profile.weight || 75}kg
Experience: ${profile.experience || 'beginner'} | Goal: ${goalLabel}
Injuries: ${profile.injuries || 'none'}

━━━ SCORING SYSTEM ━━━
Score each muscle group based on VISIBLE development AND the user's POSE (flexed = you can see actual muscle development).
Use this scale:
- 0-30 = Başlangıç (no visible gym history, undeveloped)
- 31-45 = Gelişiyor (some training visible but significant gaps)
- 46-60 = Ortalama (clear gym history, decent development — NORMAL for recreational lifters)
- 61-75 = Atletik (solid above-average development)
- 76-88 = Çok İyi (advanced, notable aesthetics)
- 89-100 = Elite (competition-level, exceptional)

IMPORTANT SCORING RULES:
- A normal gym-goer with 1-3 years of consistent training typically scores 50-65
- Do NOT score relative to Instagram influencers or bodybuilders
- Score relative to the general gym-going population
- Give DIFFERENT scores for each muscle — no two identical scores
- If body part is NOT VISIBLE in photos: set score to null, status to "not_visible" — DO NOT GUESS
- Only REJECT if: completely dark / no human visible / corrupted
- If user is FLEXED/POSING: you can assess actual muscle development more accurately

━━━ BODY PATTERN DETECTION ━━━
Before scoring, identify which body pattern fits this person:
- "skinny_fat": low muscle mass + moderate body fat, soft look without definition
- "bulk_physique": higher body fat + visible muscle underneath, heavy/thick look
- "athletic_small": good proportions and some definition but lacks overall mass/size
- "aesthetic_lean": good muscle definition and low body fat but may lack fullness
- "beginner": low overall development, little visible gym history
- "advanced": clear hypertrophy, proportional development
- "unbalanced": significant discrepancy between upper and lower body, or front/back
Use this pattern to make your ENTIRE analysis more specific and personal.

━━━ BODY FAT ESTIMATION ━━━
Estimate body fat % from: muscle definition, vascularity, waist-to-shoulder ratio, face/neck fullness, lower ab visibility.
- Visible abs with some vascularity = under 12% (men) / under 18% (women)
- Visible abs, no vascularity = 12-15% (men) / 18-22% (women)
- Upper abs visible, lower abs hidden = 15-18% (men) / 22-26% (women)
- Soft midsection, some muscle visible = 18-24% (men) / 26-32% (women)
- Hard to see muscle through fat = above 24% (men) / above 32% (women)

━━━ COACHING TONE ━━━
- Be specific — NAME the exact muscles you're observing
- Balance: acknowledge what's working AND what needs work
- Write like a smart, direct human coach — not a bot generating a report
- Each person should feel their analysis is UNIQUELY about them, not a template
- Use body pattern context throughout: if someone is "skinny_fat", all advice references that
- Avoid generic phrases like "work harder" or "needs improvement" without specifics
- Confidence scores: assess how clearly you can see each muscle group from photos

━━━ ROADMAP STRATEGY ━━━
Based on body fat % and goal, pick ONE:
1. "bulk" — body fat <15% men / <22% women AND goal is muscle
2. "cut" — body fat >22% men / >28% women
3. "recomp" — moderate body fat (15-22% men / 22-28% women)
4. "maintain" — goal is staying fit

Return this JSON (ALL string values in Turkish):
{
  "photoRejected": false,
  "overallScore": <number 0-100>,
  "bodyFatEstimate": "<e.g. 18-22%>",
  "bodyPattern": "<skinny_fat|bulk_physique|athletic_small|aesthetic_lean|beginner|advanced|unbalanced>",
  "strategyPath": "<bulk|cut|recomp|maintain>",
  "coachingNotes": {
    "photoQuality": "<1 sentence: photo quality assessment, if lighting/angle affects analysis accuracy say so>",
    "firstImpression": "<2-3 sentences that feel PERSONAL: what you see immediately about THIS specific person, reference their body pattern, honest and specific — NOT generic>",
    "bodyBalance": "<specific muscle dominance vs lagging analysis — name exact muscles, e.g. 'Ön omuz dominant görünüyor ama yan omuz yetersiz kaldığı için omuz genişliği algısı daralıyor'>",
    "strongPoints": "<genuinely positive observations — specific muscles, specific visual qualities. If nothing notable, say something like 'Genel oran dengesi fena değil' rather than making up compliments>",
    "improvementAreas": "<2-3 most urgent weaknesses — name exact muscles, explain the VISUAL impact, e.g. 'Alt karın ve bel çevresi definisyonu kapattığı için abdominal çizgiler görünmüyor'>",
    "strategyExplanation": "<explain chosen strategy using their actual body fat and pattern — personal, specific, with numbers>",
    "nutritionFocus": "<specific macro/calorie strategy for their path>",
    "roadmap12Weeks": "<3-phase plan: Hafta 1-4, Hafta 5-8, Hafta 9-12 — specific and actionable>",
    "hardTruth": "<one honest, motivating insight — can be positive surprise OR a real challenge they need to face — must feel personal to THEIR body>",
    "limitations": "Bu görsel oran analizidir, tıbbi tavsiye değildir"
  },
  "postureAnalysis": {
    "forwardHead": "<none/mild/moderate/severe>",
    "roundedShoulders": "<none/mild/moderate/severe>",
    "pelvicTilt": "<none/mild/moderate/severe>",
    "overallPosture": "<specific posture observations relevant to their body pattern>"
  },
  "muscleGroups": {
    "chest": { "score": <0-100 or null>, "confidence": <50-99>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<specific: upper/lower chest development, fullness, projection, symmetry — NOT generic>" },
    "back": { "score": <0-100 or null>, "confidence": <50-99>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<specific: lat width vs mid-back thickness, V-taper contribution, trap development>" },
    "shoulders": { "score": <0-100 or null>, "confidence": <50-99>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<which deltoid heads visible, capping, width, roundness — all three heads if visible>" },
    "arms": { "score": <0-100 or null>, "confidence": <50-99>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<bicep peak and fullness, tricep mass and shape, forearm, proportion to torso>" },
    "legs": { "score": <0-100 or null>, "confidence": <50-99>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<quad sweep and separation, hamstring thickness, calf development, upper/lower leg balance>" },
    "abs": { "score": <0-100 or null>, "confidence": <50-99>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<definition level, oblique visibility, serratus, relation to body fat — honest assessment>" },
    "glutes": { "score": <0-100 or null>, "confidence": <50-99>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<shape, projection, upper glute fullness, hip-to-waist ratio contribution>" }
  },
  "aestheticRatios": {
    "vTaperRating": "<poor/fair/good/excellent>",
    "shoulderToWaistRatio": "<narrow/average/wide/very_wide>",
    "upperLowerBalance": "<upper_dominant/balanced/lower_dominant>",
    "overallAesthetics": "<1 sentence honest aesthetic summary>"
  },
  "weakPoints": ["<muscle>", "<muscle>"],
  "strongPoints": ["<muscle>"],
  "progressionStrategy": "<konkret 3 aylık antrenman stratejisi — hangi kas gruplarına önce odaklanılacak, frekans, yoğunluk önerisi, body pattern'e göre özelleştirilmiş>"
}`;


    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4000,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are a JSON API. Return ONLY valid JSON. First char { last char }. No markdown.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: frontPhoto, detail: 'high' } },
            { type: 'image_url', image_url: { url: sidePhoto, detail: 'high' } },
            { type: 'image_url', image_url: { url: backPhoto, detail: 'high' } },
          ],
        }
      ],
    });

    const raw = aiResponse?.choices?.[0]?.message?.content;
    if (!raw) return res.status(500).json({ success: false, error: 'AI yanit vermedi. Tekrar deneyin.' });

    console.log('AI RAW:', raw.substring(0, 200));
    const result = JSON.parse(extractJSON(raw));

    if (result.photoRejected) {
      return res.json({ success: false, photoRejected: true, rejectionReason: result.rejectionReason });
    }

    // Normalize scores
    if (result.overallScore && result.overallScore <= 10) result.overallScore = Math.round(result.overallScore * 10);
    if (result.muscleGroups) {
      Object.keys(result.muscleGroups).forEach(m => {
        const mg = result.muscleGroups[m];
        if (mg.score !== null && mg.score !== undefined && mg.score <= 10) mg.score = Math.round(mg.score * 10);
      });
    }

    // Backward compat: map new fields to old field names UI might still use
    if (result.coachingNotes) {
      if (!result.coachingNotes.roadmap8Weeks && result.coachingNotes.roadmap12Weeks) {
        result.coachingNotes.roadmap8Weeks = result.coachingNotes.roadmap12Weeks;
      }
      if (!result.coachingNotes.priorityExplanation && result.coachingNotes.strategyExplanation) {
        result.coachingNotes.priorityExplanation = result.coachingNotes.strategyExplanation;
      }
    }

    console.log('Analiz tamam - Skor: ' + result.overallScore + ', Yag: ' + result.bodyFatEstimate + ', Strateji: ' + result.strategyPath);
    res.json({ success: true, data: result });

  } catch (err) {
    console.error('Analiz hatasi:', err.message);
    if (err.message?.includes('aborted') || err.message?.includes('timeout')) {
      return res.status(408).json({ success: false, error: 'Baglanti kesildi. WiFi ile tekrar deneyin.' });
    }
    res.status(500).json({ success: false, error: 'Analiz hatasi. Lutfen tekrar deneyin.' });
  }
});

app.post('/api/get-benefits', (req, res) => {
  try {
    const { selectedMuscles, currentScores } = req.body;
    if (!selectedMuscles?.length) return res.status(400).json({ success: false, error: 'Kas grubu sec' });

    const db = {
      chest:     { gain: 20, changes: ['Gogus ust hatti belirginlesir', 'Tisort daha iyi oturur', '+3-4cm projeksiyon'], strength: '+25-30kg bench press', volume: '12-15 set/hafta' },
      back:      { gain: 15, changes: ['Sirt genisler', 'V-taper iyilesir', 'Durus duzzelir'], strength: '+30kg cekme gucu', volume: '15-18 set/hafta' },
      shoulders: { gain: 12, changes: ['Yan deltoid genisler', 'Omuz yuvarlakligi artar', '+2cm genislik'], strength: '+15kg OHP', volume: '12-15 set/hafta' },
      arms:      { gain: 15, changes: ['Bicep peak olusur', 'Tricep dolgunlasir', '+2-3cm cevre'], strength: '+10kg curl', volume: '10-12 set/hafta' },
      legs:      { gain: 10, changes: ['Quad ayrisimi gorunur', 'Hamstring gelisir', 'Denge iyilesir'], strength: '+40kg squat', volume: '15-18 set/hafta' },
      abs:       { gain: 15, changes: ['Six-pack belirginlesir', 'Serratus gorunur', 'Core gucu artar'], strength: '%50 core stabilite artisi', volume: '6-8 set/hafta' },
      glutes:    { gain: 12, changes: ['Kalca yuvarlakligi artar', 'Alt vucut dengesi iyilesir', 'Postur duzzelir'], strength: '+20kg hip thrust', volume: '10-12 set/hafta' },
    };

    const selected = {};
    selectedMuscles.forEach(m => {
      if (db[m]) {
        const base = parseFloat(currentScores?.[m]) || 50;
        selected[m] = {
          current_score: base,
          expected_gain: db[m].gain,
          final_score: Math.min(100, base + db[m].gain),
          visual_changes: db[m].changes,
          strength_gains: db[m].strength,
          volume_per_week: db[m].volume,
        };
      }
    });

    res.json({ success: true, benefits: selected });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/generate-program', async (req, res) => {
  req.socket.setTimeout(120000);
  res.setTimeout(120000);
  try {
    const { selectedMuscles, profile, analysis, programPrefs } = req.body;
    if (!selectedMuscles?.length) return res.status(400).json({ success: false, error: 'Kas grubu sec' });

    const weeklyDays = parseInt(programPrefs?.trainingDays) || parseInt(profile.weeklyDays) || 4;
    const experience = profile.experience || 'beginner';
    const duration = programPrefs?.sessionDuration || '60';
    const disliked = programPrefs?.dislikedExercises?.trim() || '';
    const injuries = programPrefs?.injuries?.trim() || profile?.injuries?.trim() || '';
    const customNote = programPrefs?.customNote?.trim() || '';

    // Ekipman listesi
    const hasBarbell = programPrefs?.equipment?.includes('barbell') || !programPrefs?.equipment?.length;
    const hasDumbbell = programPrefs?.equipment?.includes('dumbbell') || !programPrefs?.equipment?.length;
    const hasMachine = programPrefs?.equipment?.includes('machine') || !programPrefs?.equipment?.length;
    const hasCable = programPrefs?.equipment?.includes('cable') || !programPrefs?.equipment?.length;
    const hasBands = programPrefs?.equipment?.includes('bands');
    const hasBodyweight = programPrefs?.equipment?.includes('bodyweight');
    const onlyBodyweight = hasBodyweight && !hasBarbell && !hasDumbbell && !hasMachine && !hasCable;

    const availableEquipment = [];
    if (hasBarbell) availableEquipment.push('barbell');
    if (hasDumbbell) availableEquipment.push('dumbbell');
    if (hasMachine) availableEquipment.push('machine');
    if (hasCable) availableEquipment.push('cable');
    if (hasBands) availableEquipment.push('resistance bands');
    if (hasBodyweight) availableEquipment.push('bodyweight');

    // Bacak atlama kontrolü — geniş yakalama
    const skipLegsKeywords = ['bacak', 'leg', 'lower body', 'alt vücut', 'alt vucut', 'squat', 'bacaklar'];
    const allUserText = (disliked + ' ' + customNote).toLowerCase();
    const skipLegs = skipLegsKeywords.some(k => allUserText.includes(k)) ||
                     selectedMuscles.every(m => !['legs', 'glutes'].includes(m)) && !selectedMuscles.includes('legs');

    // Split mantığı
    let split, splitGuide;
    if (weeklyDays <= 3) {
      split = 'Full Body';
      splitGuide = 'Her gün tüm vücudu çalıştır: göğüs, sırt, omuz, kol, bacak (bacak isteniyorsa)';
    } else if (weeklyDays === 4) {
      if (skipLegs) {
        split = 'Push / Pull / Arms / Full-Upper';
        splitGuide = 'Gün 1: Push (göğüs+omuz+triceps) | Gün 2: Pull (sırt+biceps) | Gün 3: Arms (biceps+triceps odaklı) | Gün 4: Full Upper (göğüs+sırt+omuz)';
      } else {
        split = 'Upper / Lower';
        splitGuide = 'Gün 1: Upper | Gün 2: Lower | Gün 3: Upper | Gün 4: Lower';
      }
    } else {
      if (skipLegs) {
        split = 'Push / Pull / Arms / Push / Pull';
        splitGuide = 'Push / Pull / Arms / Push / Pull — bacak günü yok';
      } else {
        split = 'Push / Pull / Legs';
        splitGuide = 'PPL split';
      }
    }

    // Kas skoru özeti
    const muscleScores = analysis?.muscleGroups
      ? Object.entries(analysis.muscleGroups)
          .filter(([, v]) => v?.score != null)
          .map(([k, v]) => `${k}:${v.score}/100`)
          .join(', ')
      : '';

    const priorityDetails = selectedMuscles.map(m => {
      const mg = analysis?.muscleGroups?.[m];
      return `${m} (${mg?.score || '?'}/100 - ${mg?.detail || ''})`;
    }).join(' | ');

    // Split günlerini belirle
    const dayPlans = [];
    if (weeklyDays <= 3) {
      for (let i = 0; i < weeklyDays; i++) {
        dayPlans.push({ dayNum: i+1, name: 'Full Body', focus: selectedMuscles.join(', ') });
      }
    } else if (weeklyDays === 4) {
      if (skipLegs) {
        dayPlans.push({ dayNum: 1, name: 'Push', focus: 'göğüs, omuz, triceps' });
        dayPlans.push({ dayNum: 2, name: 'Pull', focus: 'sırt, biceps' });
        dayPlans.push({ dayNum: 3, name: 'Arms', focus: 'biceps, triceps' });
        dayPlans.push({ dayNum: 4, name: 'Full Upper', focus: 'göğüs, sırt, omuz' });
      } else {
        dayPlans.push({ dayNum: 1, name: 'Upper A', focus: 'göğüs, omuz, triceps' });
        dayPlans.push({ dayNum: 2, name: 'Lower A', focus: 'bacaklar, glutes' });
        dayPlans.push({ dayNum: 3, name: 'Upper B', focus: 'sırt, biceps, omuz' });
        dayPlans.push({ dayNum: 4, name: 'Lower B', focus: 'bacaklar, hamstrings' });
      }
    } else {
      if (skipLegs) {
        dayPlans.push({ dayNum: 1, name: 'Push A', focus: 'göğüs, omuz, triceps' });
        dayPlans.push({ dayNum: 2, name: 'Pull A', focus: 'sırt, biceps' });
        dayPlans.push({ dayNum: 3, name: 'Arms', focus: 'biceps, triceps' });
        dayPlans.push({ dayNum: 4, name: 'Push B', focus: 'göğüs, üst göğüs, omuz' });
        dayPlans.push({ dayNum: 5, name: 'Pull B', focus: 'sırt genişliği, sırt kalınlığı' });
      } else {
        dayPlans.push({ dayNum: 1, name: 'Push', focus: 'göğüs, omuz, triceps' });
        dayPlans.push({ dayNum: 2, name: 'Pull', focus: 'sırt, biceps' });
        dayPlans.push({ dayNum: 3, name: 'Legs', focus: 'bacaklar, glutes' });
        dayPlans.push({ dayNum: 4, name: 'Push B', focus: 'üst göğüs, omuz' });
        dayPlans.push({ dayNum: 5, name: 'Pull B', focus: 'sırt kalınlığı, biceps' });
      }
    }

    // Kısıtlamalar — her güne gönderilecek
    const restrictions = [
      customNote ? `ÖZEL İSTEK: "${customNote}"` : '',
      disliked ? `KULLANILMAYACAK HAREKETLER: ${disliked}` : '',
      injuries ? `SAKATLИК NEDENİYLE KAÇIN: ${injuries}` : '',
      skipLegs ? 'BACAK EGZERSİZİ KESİNLİKLE YASAK: squat, leg press, lunge, leg curl, leg extension, calf raise, deadlift' : '',
      `EKİPMAN — SADECE BUNLARI KULLAN: ${availableEquipment.join(', ')}`,
      onlyBodyweight ? 'Makine, dambıl, barbell kullanma.' : '',
    ].filter(Boolean).join('\n');

    const userContext = `Kullanıcı: ${experience} seviye, ${profile.primaryGoal || 'muscle'} hedefi, ${duration} dk antrenman
Geliştirmek istediği kaslar: ${selectedMuscles.join(', ')}
Kas skorları: ${muscleScores}
Vücut tipi: ${analysis?.bodyPattern || 'beginner'}`;

    // Her günü ayrı ayrı üret
    const generatedDays = await Promise.all(dayPlans.slice(0, weeklyDays).map(async (dp) => {
      const dayPrompt = `Sen deneyimli bir hypertrophy koçusun. Aşağıdaki antrenman günü için egzersiz listesi yaz.

══════════════════════════════════════
KURALLARIN TAMAMI — HEPSİNE UY:
${restrictions}
══════════════════════════════════════

${userContext}

BU GÜN: Gün ${dp.dayNum} - ${dp.name}
ODAK KASLAR: ${dp.focus}
SÜRE: ${duration} dk

Bu günün odak kaslarına göre 6-8 egzersiz seç. Her egzersiz odak kasları çalıştırsın.
Boş doldurmak için alakasız hareket koyma. Kalite önemli, sayı değil.

SIRALAMA KURALI — ÇOK ÖNEMLİ:
Egzersizleri kas grubuna göre GRUPLA. Aynı kas grubundaki TÜM hareketler birbirini takip etmeli.
YANLIŞ sıralama: Göğüs, Omuz, Kol, Kol, Göğüs, Omuz (karışık)
DOĞRU sıralama: Göğüs, Göğüs, Omuz, Omuz, Kol, Kol (gruplu)
Önce en büyük/öncelikli kas grubunun TÜM hareketlerini sırala, sonra ikinci kas grubuna geç, sonra üçüncüye.
Kullanıcı bu listeyi yukarıdan aşağı sırayla yapacak, kas grupları karışık gelirse antrenman mantıksız hissettirir.

SADECE şu JSON'u döndür, başka hiçbir şey yazma:
{
  "day": "Gün ${dp.dayNum} - ${dp.name}",
  "focus": "${dp.focus}",
  "dayContext": "Bu günün amacı 1 cümle Türkçe",
  "duration": "${duration} dk",
  "exercises": [
    {
      "name": "Egzersiz adı",
      "sets": "4",
      "reps": "8-12",
      "rest": "90 sn",
      "intensity": "AĞIR",
      "technique": "Kısa teknik ipucu Türkçe",
      "reason": "Neden bu hareket — kas skoruna referans ver Türkçe",
      "alternatives": ["Alternatif 1", "Alternatif 2"],
      "videoUrl": "https://youtube.com/results?search_query=exercise+name+tutorial"
    }
  ]
}`;

      const resp = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 3000,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'JSON API. Return ONLY valid JSON. First char {, last char }. No markdown.' },
          { role: 'user', content: dayPrompt }
        ],
      });

      const raw = resp?.choices?.[0]?.message?.content;
      const dayData = JSON.parse(extractJSON(raw));
      console.log(`Gün ${dp.dayNum} (${dp.name}): ${dayData.exercises?.length || 0} hareket`);
      return dayData;
    }));

    // Önce programContext üret
    const ctxPrompt = `Aşağıdaki kullanıcı için kısa bir program tanıtımı yaz (2-3 cümle Türkçe).
${userContext}
Özel istek: ${customNote || 'yok'}
JSON döndür: {"programContext":"...","weeklyVolume":"...","progressionNotes":"..."}`;

    const ctxResp = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 400,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'JSON API. Return ONLY valid JSON.' },
        { role: 'user', content: ctxPrompt }
      ],
    });
    const ctxRaw = ctxResp?.choices?.[0]?.message?.content;
    const ctx = JSON.parse(extractJSON(ctxRaw));

    const program = {
      focusMuscles: selectedMuscles.join(', '),
      splitType: split,
      programContext: ctx.programContext || '',
      weeklyVolume: ctx.weeklyVolume || '',
      progressionNotes: ctx.progressionNotes || '',
      PROGRAM: generatedDays,
    };

    console.log('Program tamam: ' + program.PROGRAM.length + ' gün');
    res.json({ success: true, data: program });

  } catch (err) {
    console.error('Program hatasi:', err.message);
    if (err.message?.includes('aborted') || err.message?.includes('timeout')) {
      return res.status(408).json({ success: false, error: 'Baglanti kesildi. Tekrar deneyin.' });
    }
    res.status(500).json({ success: false, error: 'Program olusturulamadi. Tekrar deneyin.' });
  }
});

app.post('/api/analyze-food', async (req, res) => {
  req.socket.setTimeout(60000);
  res.setTimeout(60000);
  try {
    const { photo, textDescription, profile } = req.body;

    if (!photo && !textDescription) {
      return res.status(400).json({ success: false, error: 'Fotoğraf veya yemek açıklaması gerekli' });
    }

    const jsonSchema = `{"mealName":"string","foodItems":[{"name":"string","portion":"string","calories":number,"protein":number,"carbs":number,"fat":number}],"totalCalories":number,"totalProtein":number,"totalCarbs":number,"totalFat":number,"healthScore":number,"notes":"string","suggestion":"string"}`;

    const systemMsg = `You are a nutrition JSON API. 
RULES:
- Respond ONLY with valid JSON. 
- First character must be {, last character must be }.
- No markdown, no code blocks, no explanation before or after JSON.
- Use this exact schema: ${jsonSchema}
- All string values in Turkish.
- numbers must be real integers or floats, not strings.`;

    let messages;

    if (textDescription) {
      messages = [
        { role: 'system', content: systemMsg },
        {
          role: 'user',
          content: `Analyze this meal and return JSON: "${textDescription}". User goal: ${profile?.primaryGoal || 'muscle'}, weight: ${profile?.weight || 75}kg. Estimate realistic calories and macros.`
        }
      ];
    } else {
      const imgUrl = photo.startsWith('data:') ? photo : 'data:image/jpeg;base64,' + photo;
      messages = [
        { role: 'system', content: systemMsg },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this food photo and return JSON. User goal: ${profile?.primaryGoal || 'muscle'}, weight: ${profile?.weight || 75}kg. Identify all food items visible, estimate portions and calculate realistic calories and macros.`
            },
            { type: 'image_url', image_url: { url: imgUrl, detail: 'high' } }
          ]
        }
      ];
    }

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages,
    });

    const raw = aiResponse?.choices?.[0]?.message?.content;
    if (!raw) return res.status(500).json({ success: false, error: 'AI yanıt vermedi.' });

    console.log('Yemek AI raw:', raw.substring(0, 100));
    const result = JSON.parse(raw);

    // Sayıları normalize et
    result.totalCalories = Math.round(Number(result.totalCalories) || 0);
    result.totalProtein  = Math.round(Number(result.totalProtein)  || 0);
    result.totalCarbs    = Math.round(Number(result.totalCarbs)    || 0);
    result.totalFat      = Math.round(Number(result.totalFat)      || 0);
    result.healthScore   = Math.min(10, Math.max(1, Number(result.healthScore) || 5));

    console.log('Yemek analizi: ' + result.totalCalories + ' kcal');
    res.json({ success: true, data: result });

  } catch (err) {
    console.error('Yemek analiz hatası:', err.message);
    res.status(500).json({ success: false, error: 'Yemek analiz edilemedi. Tekrar dene.' });
  }
});

// ─────────────────────────────────────────────────────
// GÜNLÜK KALORİ HEDEFİ
// ─────────────────────────────────────────────────────
app.post('/api/calorie-goal', (req, res) => {
  try {
    const { profile } = req.body;
    const w = parseFloat(profile?.weight) || 75;
    const h = parseFloat(profile?.height) || 170;
    const a = parseFloat(profile?.age) || 25;
    const gender = profile?.gender || 'male';
    const goal = profile?.primaryGoal || 'muscle';
    const days = parseInt(profile?.weeklyDays) || 4;

    // Mifflin-St Jeor BMR
    const bmr = gender === 'female'
      ? 10 * w + 6.25 * h - 5 * a - 161
      : 10 * w + 6.25 * h - 5 * a + 5;

    const actMult = days <= 2 ? 1.375 : days <= 4 ? 1.55 : days <= 6 ? 1.725 : 1.9;
    const tdee = Math.round(bmr * actMult);
    const goalCal = goal === 'lose' ? tdee - 400 : goal === 'muscle' ? tdee + 250 : tdee;

    const protein = Math.round(w * (goal === 'muscle' ? 2.2 : 1.8));
    const fat = Math.round((goalCal * 0.25) / 9);
    const carbs = Math.round((goalCal - protein * 4 - fat * 9) / 4);

    res.json({
      success: true,
      data: {
        goalCalories: goalCal,
        tdee,
        macros: { protein, carbs, fat },
        goalLabel: goal === 'lose' ? 'Yağ Yakma' : goal === 'muscle' ? 'Kas Kazanma' : 'Formda Kalma'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// AI KOÇ SOHBETİ
// ─────────────────────────────────────────────────────
app.post('/api/coach-chat', async (req, res) => {
  req.socket.setTimeout(90000);
  res.setTimeout(90000);
  try {
    const { message, chatHistory, profile, analysis, activeProgram, todayLog, weeklyLog, recentWorkouts, recentProgress } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, error: 'Mesaj bos olamaz' });
    }

    // Program ozeti
    let programSummary = 'Henuz program olusturulmamis.';
    if (activeProgram?.PROGRAM?.length) {
      const days = activeProgram.PROGRAM.map((d, i) => {
        const exNames = d.exercises?.map(e => e.name).join(', ') || '';
        return `Gun ${i+1}: ${d.day} — ${exNames}`;
      }).join('\n');
      programSummary = `Split: ${activeProgram.splitType || '?'}\n${days}\nOdak: ${activeProgram.focusMuscles || '?'}`;
    }

    // Kalori ozeti
    let nutritionSummary = 'Bugun kalori kaydi yok.';
    if (todayLog?.length) {
      const totalCal = todayLog.reduce((s, m) => s + (m.totalCalories || 0), 0);
      const totalPro = todayLog.reduce((s, m) => s + (m.totalProtein || 0), 0);
      const totalCarb = todayLog.reduce((s, m) => s + (m.totalCarbs || 0), 0);
      const totalFat = todayLog.reduce((s, m) => s + (m.totalFat || 0), 0);
      const meals = todayLog.map(m => `- ${m.mealName}: ${m.totalCalories} kcal, ${Math.round(m.totalProtein||0)}g protein`).join('\n');
      nutritionSummary = `Bugun: ${totalCal} kcal | ${Math.round(totalPro)}g protein | ${Math.round(totalCarb)}g karb | ${Math.round(totalFat)}g yag\n${meals}`;
    }
    let weeklyNutrition = '';
    if (weeklyLog?.length) {
      const avgCal = Math.round(weeklyLog.reduce((s, m) => s + (m.totalCalories || 0), 0) / 7);
      const avgPro = Math.round(weeklyLog.reduce((s, m) => s + (m.totalProtein || 0), 0) / 7);
      weeklyNutrition = `Haftalik ortalama: ${avgCal} kcal/gun, ${avgPro}g protein/gun`;
    }

    // Analiz ozeti
    let analysisSummary = 'Henuz analiz yapilmamis.';
    if (analysis) {
      const muscles = analysis.muscleGroups
        ? Object.entries(analysis.muscleGroups)
            .filter(([,v]) => v?.score != null)
            .sort((a,b) => (a[1].score||99)-(b[1].score||99))
            .map(([k,v]) => `${k}: ${v.score}/100 — ${v.detail || v.status}`)
            .join('\n')
        : '';
      analysisSummary = `Genel: ${analysis.overallScore}/100 | Yag: ${analysis.bodyFatEstimate||'?'} | Pattern: ${analysis.bodyPattern||'?'} | V-taper: ${analysis.aestheticRatios?.vTaperRating||'?'}\nKas gruplari:\n${muscles}\nZayif: ${(analysis.weakPoints||[]).join(', ')} | Guclu: ${(analysis.strongPoints||[]).join(', ')}`;
    }

    // Antrenman gecmisi + plato tespiti
    let workoutSummary = 'Antrenman gecmisi yok.';
    let plateauWarnings = '';
    if (recentWorkouts?.length) {
      workoutSummary = recentWorkouts.slice(0,5).map(w =>
        `${w.date}: ${w.exercises?.map(e => {
          const maxW = Math.max(...(e.sets?.map(s=>parseFloat(s.weight)||0)||[0]));
          return `${e.name}${maxW>0?' '+maxW+'kg':''}x${e.sets?.length||0}set`;
        }).join(', ')}`
      ).join('\n');

      const exWeights = {};
      recentWorkouts.forEach(w => {
        w.exercises?.forEach(ex => {
          if (!exWeights[ex.name]) exWeights[ex.name] = [];
          const maxW = Math.max(...(ex.sets?.map(s=>parseFloat(s.weight)||0)||[0]));
          if (maxW > 0) exWeights[ex.name].push(maxW);
        });
      });
      const plateaus = Object.entries(exWeights)
        .filter(([,ws]) => ws.length >= 3 && new Set(ws.slice(-3)).size === 1)
        .map(([name,ws]) => `${name}: son 3 antrenmanda ${ws[0]}kg`);
      if (plateaus.length) {
        plateauWarnings = `PLATO TESPIT EDILDI:\n${plateaus.join('\n')}\nBu hareketlerde ilerleme durmus. Kullaniciya mutlaka belirt ve somut cozumler oner.`;
      }
    }

    // Ilerleme ozeti
    let progressSummary = 'Olcum gecmisi yok.';
    if (recentProgress?.length) {
      const latest = recentProgress[0];
      const prev = recentProgress[1];
      const fields = ['weight','chest','waist','hips','arms','legs'];
      const latestStr = fields.filter(f=>latest[f]).map(f=>`${f}:${latest[f]}`).join(', ');
      progressSummary = `Son olcum (${latest.date}): ${latestStr}`;
      if (prev) {
        const diffs = fields.filter(f=>latest[f]&&prev[f]).map(f=>{
          const d = parseFloat(latest[f])-parseFloat(prev[f]);
          return `${f}:${d>0?'+':''}${d.toFixed(1)}`;
        }).join(', ');
        if (diffs) progressSummary += `\nDegisim: ${diffs}`;
      }
    }

    const wantsExerciseChange = ['hareketi degistir','sevmiyorum','yapamiyorum','yerine koy','alternatif ver','baska hareket']
      .some(kw => message.toLowerCase().includes(kw));

    const systemPrompt = `Sen FitProg'un AI fitness kocusun. Deneyimli, bilgili ve samimi bir antrenor gibisin.

KISILIK:
- Samimi ve icten, gercekten konuyu bilen biri gibi konusursun
- Teknik kavramlari dogal kullan: superset, drop set, RPE, progressive overload, mind-muscle connection, time under tension, deload, hipertrofi, RIR, mekanik gerilim, metabolik stres, periodizasyon
- Her cevabin kullanicinin gercek verisiyle baglantili, somut ve bilgiye dayali
- Kisa sohbetlerde 2-4 cumle. Teknik sorularda daha detayli ve ogretici ol
- Turkce konus, dogal ve akici

${plateauWarnings ? `DIKKAT — PLATO DURUMU:\n${plateauWarnings}\n` : ''}

KULLANICI:
Yas: ${profile?.age||'?'} | Kilo: ${profile?.weight||'?'}kg | Boy: ${profile?.height||'?'}cm | Cinsiyet: ${profile?.gender==='male'?'Erkek':'Kadin'}
Hedef: ${profile?.primaryGoal==='muscle'?'Kas kazanma':profile?.primaryGoal==='lose'?'Yag yakma':'Formda kalma'} | Deneyim: ${profile?.experience||'?'} | ${profile?.weeklyDays||4} gun/hafta

VUCUT ANALIZI:
${analysisSummary}

PROGRAM:
${programSummary}

ANTRENMAN GECMISI (son antrenmanlarda kullanilan agirliklar):
${workoutSummary}

ILERLEME OLCUMLERI:
${progressSummary}

BESLENME (bugun):
${nutritionSummary}
${weeklyNutrition}

KURALLAR:
- Generic konusma yasak — kullanicinin gercek verisini kullan
- Plato varsa proaktif belirt ve somut cozum oner (agirlik artisi, rep degisimi, varyasyon, deload haftasi, tempo degisimi)
- Ilerleme olcumlerini yorumla — kilo, bel, kol degisimlerine referans ver
- O gunun programini ve ne yapmasi gerektigini teknik detayla anlat
- Teknik kavramlari dogru ve yerinde kullan, gerektiginde kisaca acikla${wantsExerciseChange ? `

EGZERSIZ DEGISIKLIGI:
Kullanici bir hareketi degistirmek istiyor. Normal cevabinin SONUNA su JSON'u ekle:
<program_update>
{"dayIndex": 0, "exerciseIndex": 0, "newExercise": {"name": "Yeni Hareket", "sets": "4", "reps": "8-12", "rest": "90 sn", "intensity": "AGIR", "technique": "Teknik ipucu Turkce", "reason": "Neden bu hareket Turkce", "alternatives": ["Alt1", "Alt2"], "videoUrl": "https://youtube.com/results?search_query=exercise+tutorial"}}
</program_update>
dayIndex = kacinci gun (0=Gun1), exerciseIndex = o gundeki kacinci hareket (0=ilk).
Once hangi gun ve hangi hareketi degistirmek istedigini anla, sonra uygun alternatif oner.` : ''}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(chatHistory || []).slice(-10),
      { role: 'user', content: message }
    ];

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 700,
      temperature: 0.7,
      messages,
    });

    const reply = aiResponse?.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ success: false, error: 'AI yanit vermedi.' });

    let updatedProgram = null;
    const programUpdateMatch = reply.match(/<program_update>([\s\S]*?)<\/program_update>/);
    const cleanReply = reply.replace(/<program_update>[\s\S]*?<\/program_update>/g, '').trim();

    if (programUpdateMatch && activeProgram?.PROGRAM) {
      try {
        const update = JSON.parse(programUpdateMatch[1].trim());
        if (activeProgram.PROGRAM[update.dayIndex]?.exercises?.[update.exerciseIndex]) {
          updatedProgram = JSON.parse(JSON.stringify(activeProgram));
          updatedProgram.PROGRAM[update.dayIndex].exercises[update.exerciseIndex] = {
            ...updatedProgram.PROGRAM[update.dayIndex].exercises[update.exerciseIndex],
            ...update.newExercise
          };
        }
      } catch(e) { console.error('Program update error:', e.message); }
    }

    console.log('Koc yanitladi' + (updatedProgram ? ' + program guncellendi' : ''));
    res.json({ success: true, reply: cleanReply, updatedProgram });

  } catch (err) {
    console.error('Koc hatasi:', err.message);
    res.status(500).json({ success: false, error: 'Koc su an mesgul, tekrar dene.' });
  }
});

app.post('/api/analyze-progress-photos', async (req, res) => {
  req.socket.setTimeout(60000);
  res.setTimeout(60000);
  try {
    const { beforePhoto, afterPhoto, beforeDate, afterDate, profile, analysisData } = req.body;

    if (!beforePhoto || !afterPhoto) {
      return res.status(400).json({ success: false, error: 'İki fotoğraf gerekli' });
    }

    const muscleContext = analysisData?.muscleGroups
      ? Object.entries(analysisData.muscleGroups)
          .filter(([,v]) => v?.score != null)
          .map(([k,v]) => `${k}: ${v.score}/100`)
          .join(', ')
      : '';

    const prompt = `Sen deneyimli bir fitness kocusun. Kullanicinin iki farkli tarihteki vucut fotograflarini karsilastiriyorsun.

FOTOGRAF 1 (BEFORE — ${beforeDate || 'onceki'}): soldaki/onceki fotograf
FOTOGRAF 2 (AFTER — ${afterDate || 'sonraki'}): sagdaki/sonraki fotograf

KULLANICI BILGISI:
${profile?.age ? `Yas: ${profile.age} | Kilo: ${profile.weight}kg | Boy: ${profile.height}cm` : ''}
Hedef: ${profile?.primaryGoal === 'muscle' ? 'Kas kazanma' : profile?.primaryGoal === 'lose' ? 'Yag yakma' : 'Formda kalma'}
${muscleContext ? `Son analiz kas skorlari: ${muscleContext}` : ''}

Gorsel degisimi analiz et ve su konularda samimi, kisisel ve motive edici bir yorum yaz:
- Gozle gorulur fiziksel degisimler (kas gelisimi, vucut kompozisyonu, simetri vb.)
- Hangi bolgelerde gozle gorulur ilerleme var?
- Hangi bolgeler hala gelisim bekliyor?
- Genel degerlendirme ve motivasyon

Onemli:
- Gercekci ol, abartma yapma
- Spesifik ve kisisel konus, generic turk olmayan
- Turkce yaz
- 4-6 cumle yeterli`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: beforePhoto, detail: 'low' } },
            { type: 'image_url', image_url: { url: afterPhoto, detail: 'low' } }
          ]
        }
      ]
    });

    const result = response?.choices?.[0]?.message?.content;
    if (!result) return res.status(500).json({ success: false, error: 'AI yanit vermedi.' });

    console.log('Before/after analiz tamamlandi');
    res.json({ success: true, result });

  } catch (err) {
    console.error('BA analiz hatasi:', err.message);
    res.status(500).json({ success: false, error: 'Analiz yapılamadı, tekrar dene.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('FitProg Backend: http://localhost:' + PORT);
});
