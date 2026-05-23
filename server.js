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

    const prompt = `You are an elite physique coach who has trained hundreds of athletes. You analyze bodies with brutal honesty — not to be mean, but because sugarcoating wastes people's time. You give the kind of feedback a world-class coach gives in a private session.

Analyze the user from THREE photos: front, side, back.
Return ONLY valid JSON. No markdown, no explanation outside JSON.

USER INFO:
Age: ${profile.age || 25} | Height: ${profile.height || 170}cm | Weight: ${profile.weight || 75}kg
Experience: ${profile.experience || 'beginner'} | Goal: ${goalLabel}
Injuries: ${profile.injuries || 'none'}

━━━ SCORING RULES ━━━
- Score each muscle group honestly based on VISIBLE development, symmetry, and mass
- Scale: 0-40 = Undeveloped, 41-55 = Beginner, 56-65 = Average gym-goer, 66-78 = Trained, 79-88 = Advanced, 89-100 = Elite
- Give DIFFERENT scores for each muscle — no two scores should be the same unless truly identical
- null score only if body part is completely not visible
- Only REJECT photos if: completely dark / no human body visible / corrupted file

━━━ BODY FAT ESTIMATION ━━━
Estimate body fat % from visible: muscle definition, vascularity, waist-to-shoulder ratio, face/neck fat, lower ab definition.
- Visible abs = likely under 15% (men) / under 22% (women)
- Soft midsection with some muscle = 18-25% (men) / 24-32% (women)
- Hard to see muscle through fat = above 25% (men) / above 32% (women)

━━━ COACHING TONE RULES ━━━
- Be direct and specific — no generic compliments
- Name actual muscles you see underdeveloped, not just "you need to work harder"
- Compare what you see vs what's expected for their age/experience/weight
- If they claim a goal that contradicts their current physique, call it out tactfully
- Praise what's genuinely good — but be specific ("your lateral head shows decent separation" not "good arms")

━━━ ROADMAP: CHOOSE THE RIGHT PATH ━━━
Based on body fat % and goal, give ONE of these strategies (in coachingNotes.strategyPath):
1. "bulk" — if body fat is low (<15% men, <22% women) and goal is muscle → "Temiz bulk dönemi"
2. "cut" — if body fat is high (>20% men, >28% women) → "Önce yağ yakma dönemi"  
3. "recomp" — if body fat is moderate (15-20% men, 22-28% women) → "Rekomposizyon (yağ yakıp kas kazanma)"
4. "maintain" — if goal is staying fit → "Formu koruma"
Explain WHY this path is right for them specifically, using their exact numbers.

Return this JSON (ALL string values in Turkish):
{
  "photoRejected": false,
  "overallScore": <number 0-100>,
  "bodyFatEstimate": "<e.g. 18-22%>",
  "strategyPath": "<bulk|cut|recomp|maintain>",
  "coachingNotes": {
    "photoQuality": "<1 sentence on photo quality>",
    "firstImpression": "<2-3 sentences: what you see immediately, overall physique impression, honest and specific>",
    "bodyBalance": "<which muscles dominate vs which are lagging — specific muscle names, specific observations>",
    "strongPoints": "<what is genuinely developed — name specific muscles and why they stand out, or say nothing is notable yet if true>",
    "improvementAreas": "<the 2-3 most urgent weaknesses — be direct, name the muscles, explain what's missing visually>",
    "strategyExplanation": "<explain the chosen strategy (bulk/cut/recomp/maintain) using their body fat %, weight, and goal — e.g. 'Vücut yağın yaklaşık %21 görünüyor. Kas kazanmak istiyorsun ama bu yağ oranıyla bulk yapmak seni daha şişman yapar. Önce 6-8 hafta yağ yakman gerekiyor...'>",
    "nutritionFocus": "<specific calorie/macro strategy for their chosen path — e.g. for cut: 'Günlük 300-400 kalori açık, en az 2g/kg protein. Karbonhidratı antrenman öncesi ve sonrasına yığ.'>",
    "roadmap12Weeks": "<week-by-week plan in 3 phases — Phase 1 (weeks 1-4), Phase 2 (weeks 5-8), Phase 3 (weeks 9-12) — specific, actionable, numbers included>",
    "hardTruth": "<one honest thing they need to hear that most coaches would avoid saying — e.g. 'Bacak gelişimin üst vücudunla orantısız. Bu hem estetik hem fonksiyonel sorun. Haftada 2 bacak günü şart.' OR 'Genel skor ortalamanın altında ama bu seviye için normal — 12 ayda gerçekçi hedefin 65+ skoruna ulaşmak.'>",
    "limitations": "Bu görsel oran analizidir, tıbbi tavsiye değildir"
  },
  "postureAnalysis": {
    "forwardHead": "<none/mild/moderate/severe>",
    "roundedShoulders": "<none/mild/moderate/severe>",
    "pelvicTilt": "<none/mild/moderate/severe>",
    "overallPosture": "<specific posture assessment — what you see, what it means for their training>"
  },
  "muscleGroups": {
    "chest": { "score": <0-100 or null>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<specific observation about this muscle group — shape, fullness, upper/lower development, symmetry>" },
    "back": { "score": <0-100 or null>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<specific: width vs thickness, lat sweep, trap development, visible separation>" },
    "shoulders": { "score": <0-100 or null>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<which deltoid heads are developed, capping, roundness, width contribution>" },
    "arms": { "score": <0-100 or null>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<bicep peak, tricep mass, forearm, proportions>" },
    "legs": { "score": <0-100 or null>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<quad sweep, hamstring, calf development, leg-to-upper-body ratio>" },
    "abs": { "score": <0-100 or null>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<visible definition level, obliques, serratus, relation to body fat estimate>" },
    "glutes": { "score": <0-100 or null>, "priority": <1-7>, "status": "<Weak/Moderate/Strong/not_visible>", "detail": "<shape, projection, hip-to-waist ratio contribution>" }
  },
  "weakPoints": ["<muscle>", "<muscle>"],
  "strongPoints": ["<muscle>"],
  "progressionStrategy": "<konkret 3 aylik antrenman stratejisi — hangi kas gruplarına önce odaklanılacak, frekans, yoğunluk önerisi>"
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
    const isBeginnerOrInter = experience === 'beginner' || experience === 'intermediate';

    const split =
      weeklyDays <= 3 ? 'Full Body (all muscle groups each session)' :
      weeklyDays === 4 ? 'Upper / Lower Split (2 upper, 2 lower days)' :
      'Push / Pull / Legs (PPL)';

    // Kas skoru ve detayları
    const muscleContext = selectedMuscles.map(m => {
      const mg = analysis?.muscleGroups?.[m];
      const score = mg?.score || 55;
      const detail = mg?.detail || '';
      const status = mg?.status || 'Moderate';
      return `- ${m.toUpperCase()}: ${score}/100 (${status})${detail ? ' → ' + detail : ''}`;
    }).join('\n');

    // Tüm kas skorları (öncelik sıralaması için)
    const allMuscleScores = analysis?.muscleGroups
      ? Object.entries(analysis.muscleGroups)
          .filter(([, v]) => v?.score)
          .sort((a, b) => (a[1].score || 99) - (b[1].score || 99))
          .map(([k, v]) => `${k}: ${v.score}/100`)
          .join(', ')
      : 'not available';

    // Ekipman tercihleri
    const equipment = programPrefs?.equipment?.length
      ? programPrefs.equipment.join(', ')
      : 'dumbbell, machine, cable';

    const duration = programPrefs?.sessionDuration || '60';
    const disliked = programPrefs?.dislikedExercises?.trim() || 'none';
    const injuries = programPrefs?.injuries?.trim() || profile?.injuries?.trim() || 'none';
    const customNote = programPrefs?.customNote?.trim() || '';

    // Ekipman bazlı egzersiz listesi
    const exerciseList = [];
    if (programPrefs?.equipment?.includes('barbell') || !programPrefs?.equipment?.length) {
      exerciseList.push('BARBELL: Barbell Bench Press, Barbell Row, Barbell Curl, Barbell Shoulder Press');
    }
    if (programPrefs?.equipment?.includes('dumbbell') || !programPrefs?.equipment?.length) {
      exerciseList.push('DUMBBELL: Dumbbell Bench Press, Incline Dumbbell Press, Dumbbell Shoulder Press, Dumbbell Lateral Raise, Dumbbell Curl, Hammer Curl, Romanian Deadlift, Goblet Squat');
    }
    if (programPrefs?.equipment?.includes('machine') || !programPrefs?.equipment?.length) {
      exerciseList.push('MACHINE: Chest Press Machine, Leg Press, Leg Extension, Leg Curl, Shoulder Press Machine, Rear Delt Fly Machine, Ab Machine, Hip Thrust Machine, Incline Machine Press');
    }
    if (programPrefs?.equipment?.includes('cable') || !programPrefs?.equipment?.length) {
      exerciseList.push('CABLE: Cable Chest Fly, Lat Pulldown, Seated Cable Row, Cable Lateral Raise, Cable Curl, Tricep Pushdown, Overhead Tricep Extension, Cable Crunch, Straight Arm Pulldown, Face Pull, Cable Kickback');
    }
    if (programPrefs?.equipment?.includes('bands')) {
      exerciseList.push('BANDS: Band Pull-Apart, Band Lateral Walk, Band Curl, Band Tricep Extension');
    }
    if (programPrefs?.equipment?.includes('bodyweight')) {
      exerciseList.push('BODYWEIGHT: Push-up, Plank, Hanging Leg Raise, Glute Bridge');
    }

    const prompt = `You are an elite strength and hypertrophy coach. Create a highly personalized gym program.
Return ONLY valid JSON. No markdown, no explanation.

━━━ USER PROFILE ━━━
Age: ${profile.age || 25} | Weight: ${profile.weight || 75}kg | Height: ${profile.height || 170}cm
Gender: ${profile.gender || 'male'} | Experience: ${experience}
Goal: ${profile.primaryGoal === 'muscle' ? 'Muscle gain (hypertrophy)' : profile.primaryGoal === 'lose' ? 'Fat loss' : 'Stay fit'}
Weekly training days: EXACTLY ${weeklyDays} days
Session duration: ${duration} minutes per session
Split style: ${split}

━━━ PRIORITY MUSCLES (USER SELECTED - FOCUS HERE) ━━━
${muscleContext}

━━━ ALL MUSCLE SCORES (lowest = needs most work) ━━━
${allMuscleScores}

━━━ EQUIPMENT AVAILABLE (ONLY USE THESE) ━━━
${equipment}
Available exercises:
${exerciseList.join('\n')}

━━━ USER RESTRICTIONS ━━━
Disliked/forbidden exercises: ${disliked}
Injuries/pain: ${injuries}
${customNote ? `Special requests from user: ${customNote}` : ''}

━━━ PROGRAMMING RULES (NON-NEGOTIABLE) ━━━
1. PROGRAM array must have EXACTLY ${weeklyDays} objects — not one more, not one less
2. Each day: 5-7 exercises (fit realistically into ${duration} min — don't overload)
3. ${isBeginnerOrInter ? 'BEGINNER/INTERMEDIATE: Prioritize machines and dumbbells for safety and mind-muscle connection. No heavy barbell squat/deadlift unless user explicitly requested.' : 'ADVANCED: Use barbell compounds strategically. Don\'t overload — quality over quantity.'}
4. NEVER use exercises from disliked list or requiring unavailable equipment
5. NEVER recommend exercises that could aggravate stated injuries
6. MUSCLE VOLUME MINIMUMS PER SESSION:
   - Back day: minimum 4 different back exercises (lat pulldown, rows, straight arm pulldown, face pull count)
   - Leg day: minimum 4 different leg exercises (squat, leg press, extension, curl, RDL, calf raise count)
   - Chest day: minimum 3 chest exercises with different angles (flat, incline, fly)
   - Shoulders: include all 3 heads — front, lateral, rear delt exercises
7. SPLIT RULES:
   - Upper day: NO leg exercises. Lower day: NO chest/back exercises.
   - PPL Push day: chest + shoulders + triceps ONLY. Pull day: back + biceps ONLY. Leg day: legs + glutes ONLY.
   - Full body: at least one compound per major group (chest, back, legs, shoulders) each session.
8. BACAK GÜNÜ UYARISI: If user has 2+ leg days and experience suggests they might skip legs, add a note in that day's exercises at position 1: set name to "⚠️ Bacak Günü Notu", reason: "İstatistiksel olarak en çok atlanan antrenman günü bacaktır. Alt vücut hem estetik hem fonksiyonel açıdan üst vücudu dengeler — atlamak tüm programı sabote eder."
9. "reason" field MUST be specific and reference actual scores: "Sırt skorun ${analysis?.muscleGroups?.back?.score || '?'}/100 — bu hareket lat genişliğini direkt hedefler ve V-taper için kritik" — NOT generic phrases like "iyi egzersiz"
10. Set/rep ranges must match goal: muscle gain = 3-4 sets x 8-12 reps | fat loss = 3-4 sets x 12-15 reps | strength = 4-5 sets x 5-8 reps

Return this exact JSON structure:
{
  "focusMuscles": "${selectedMuscles.join(', ')}",
  "splitType": "${split}",
  "weeklyVolume": "Haftalık toplam set dağılımı Türkçe özet",
  "progressionNotes": "İlk 2 hafta ağırlıkları tanı, 3-4. haftalarda %5-10 artır. Her 4 haftada deload yap.",
  "coachWarning": "${weeklyDays >= 6 ? 'Haftada 6 gün antrenman yüksek toparlanma gerektirir. Uyku ve beslenmeyi ihmal etme, overtraining riski var.' : weeklyDays <= 2 ? 'Haftada 2 gün minimum düzeyde. Hızlı ilerleme için 3-4 güne çıkmayı düşün.' : ''}",
  "PROGRAM": [
    {
      "day": "Gün 1 - Göğüs ve Triceps",
      "focus": "Göğüs, Triceps",
      "duration": "${duration} dk",
      "exercises": [
        {
          "name": "Chest Press Machine",
          "sets": "4",
          "reps": "8-12",
          "rest": "90 sn",
          "intensity": "AĞIR",
          "technique": "Skapulayı sıkıştır, kontrollü indir — 2 saniye iniş, patlayıcı çıkış",
          "reason": "Göğüs skorun 42/100 — bu hareket üst göğüs kütlesini direkt hedefler, başlangıç için makine güvenli ve etkili",
          "alternatives": ["Dumbbell Bench Press", "Incline Dumbbell Press"],
          "videoUrl": "https://youtube.com/results?search_query=chest+press+machine+form+tutorial"
        }
      ]
    }
  ]
}

CRITICAL: PROGRAM array must have EXACTLY ${weeklyDays} objects. No exceptions.`;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 16000,
      temperature: 0.25,
      messages: [
        { role: 'system', content: 'You are a JSON API. Return ONLY valid JSON. First char {, last char }.' },
        { role: 'user', content: prompt }
      ],
    });

    const raw = aiResponse?.choices?.[0]?.message?.content;
    if (!raw) return res.status(500).json({ success: false, error: 'AI yanit vermedi.' });

    const program = JSON.parse(extractJSON(raw));
    console.log('Program olusturuldu - ' + (program.PROGRAM?.length || 0) + ' gun, odak: ' + program.focusMuscles);
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
  req.socket.setTimeout(60000);
  res.setTimeout(60000);
  try {
    const { message, chatHistory, profile, analysis, activeProgram, todayLog, weeklyLog } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, error: 'Mesaj bos olamaz' });
    }

    // Program ozeti
    let programSummary = 'Henuz program olusturulmamis.';
    if (activeProgram?.PROGRAM?.length) {
      const days = activeProgram.PROGRAM.map((d, i) => `Gun ${i+1}: ${d.day} (${d.exercises?.length || 0} egzersiz)`).join('\n');
      programSummary = `Split: ${activeProgram.splitType || '?'}\n${days}\nOdak kaslar: ${activeProgram.focusMuscles || '?'}`;
    }

    // Bugunku kalori ozeti
    let nutritionSummary = 'Bugun kalori kaydi yok.';
    if (todayLog?.length) {
      const totalCal = todayLog.reduce((s, m) => s + (m.totalCalories || 0), 0);
      const totalPro = todayLog.reduce((s, m) => s + (m.totalProtein || 0), 0);
      const meals = todayLog.map(m => `- ${m.mealName}: ${m.totalCalories} kcal`).join('\n');
      nutritionSummary = `Bugun toplam: ${totalCal} kcal, ${Math.round(totalPro)}g protein\nOgunler:\n${meals}`;
    }

    // Haftalik kalori ozeti
    let weeklyNutrition = '';
    if (weeklyLog?.length) {
      const avgCal = Math.round(weeklyLog.reduce((s, m) => s + (m.totalCalories || 0), 0) / 7);
      weeklyNutrition = `Bu hafta gunluk ortalama: ${avgCal} kcal`;
    }

    // Analiz ozeti
    let analysisSummary = 'Henuz vucut analizi yapilmamis.';
    if (analysis) {
      const muscles = analysis.muscleGroups
        ? Object.entries(analysis.muscleGroups)
            .filter(([, v]) => v?.score)
            .map(([k, v]) => `${k}: ${v.score}/100 (${v.status})`)
            .join(', ')
        : '';
      analysisSummary = `Genel skor: ${analysis.overallScore}/100\nVucut yagi: ${analysis.bodyFatEstimate || '?'}\nKas gruplari: ${muscles}\nZayif noktalar: ${(analysis.weakPoints || []).join(', ')}\nGuclu noktalar: ${(analysis.strongPoints || []).join(', ')}`;
    }

    const systemPrompt = `Sen FitProg AI Kocusun. Kullanicinin tum verilerine erisiminiz var ve ona ozel konusuyorsun.
Turkce konus. Samimi, motive edici ve net ol. 2-4 cumle yeterli, gerefsiz uzatma.
Kullanicinin verilerini aktif olarak kullan — program gununu, kalori durumunu, analiz skorlarini referans goster.

KULLANICI PROFILI:
Yas: ${profile?.age || '?'} | Kilo: ${profile?.weight || '?'}kg | Boy: ${profile?.height || '?'}cm
Cinsiyet: ${profile?.gender === 'male' ? 'Erkek' : 'Kadin'}
Hedef: ${profile?.primaryGoal === 'muscle' ? 'Kas kazanma' : profile?.primaryGoal === 'lose' ? 'Yag yakma' : 'Formda kalma'}
Deneyim: ${profile?.experience || '?'} | Antrenman: haftada ${profile?.weeklyDays || 4} gun

SON ANALIZ:
${analysisSummary}

ANTRENMAN PROGRAMI:
${programSummary}

BUGUNUN BESLENMESI:
${nutritionSummary}
${weeklyNutrition}

Kurallar:
- Tibbi tavsiye verme
- Kullanicinin verilerini referans gostererek konus (gogus skoru 45, bu yuzden... gibi)
- Program varsa hangi gun oldugununu ve ne yapmasi gerektigini soyleyebilirsin
- Kalori hedefine gore beslenme onerisi ver
- Motivasyon icin gercek verileri kullan`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(chatHistory || []).slice(-10),
      { role: 'user', content: message }
    ];

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      temperature: 0.7,
      messages,
    });

    const reply = aiResponse?.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ success: false, error: 'AI yanit vermedi.' });

    console.log('Koc yanitladi');
    res.json({ success: true, reply });

  } catch (err) {
    console.error('Koc chat hatasi:', err.message);
    res.status(500).json({ success: false, error: 'Koc su an mesgul, tekrar dene.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('FitProg Backend: http://localhost:' + PORT);
});
