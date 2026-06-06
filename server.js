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
Score each muscle group based on VISIBLE development, symmetry, and aesthetic contribution.
Use this scale:
- 0-30 = Başlangıç (undeveloped, no gym history visible)
- 31-45 = Ortalama Altı (some training but significant gaps)
- 46-60 = Gelişiyor (clear gym history, room to grow — this is NORMAL for recreational lifters)
- 61-75 = Fit / Atletik (solid development, above average)
- 76-88 = Çok İyi (advanced development, notable aesthetics)
- 89-100 = Elite (competition-level, exceptional)

IMPORTANT SCORING RULES:
- A normal gym-goer with 1-3 years of consistent training typically scores 50-65
- Do NOT score relative to Instagram influencers or bodybuilders
- Score relative to the general gym-going population
- Give DIFFERENT scores for each muscle — no two identical scores
- null only if body part is completely not visible
- Only REJECT if: completely dark / no human visible / corrupted

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
    const isAdvanced = experience === 'advanced';
    const isBeginnerOrInter = experience === 'beginner' || experience === 'intermediate';

    const split =
      weeklyDays <= 3 ? 'Full Body' :
      weeklyDays === 4 ? 'Upper / Lower Split' :
      weeklyDays === 5 ? 'Push / Pull / Legs + 2 extras' :
      'Push / Pull / Legs';

    const equipment = programPrefs?.equipment?.length
      ? programPrefs.equipment.join(', ')
      : 'dumbbell, machine, cable';

    const duration = programPrefs?.sessionDuration || '60';
    const disliked = programPrefs?.dislikedExercises?.trim() || 'none';
    const injuries = programPrefs?.injuries?.trim() || profile?.injuries?.trim() || 'none';
    const customNote = programPrefs?.customNote?.trim() || '';

    // ── Analiz verisini detaylı hazırla ──────────────────
    const bodyPattern = analysis?.bodyPattern || 'beginner';
    const strategyPath = analysis?.strategyPath || 'recomp';
    const bodyFat = analysis?.bodyFatEstimate || '?';
    const overallScore = analysis?.overallScore || 50;
    const vTaper = analysis?.aestheticRatios?.vTaperRating || 'fair';
    const upperLowerBalance = analysis?.aestheticRatios?.upperLowerBalance || 'balanced';

    // Seçilen kasların tam analizi
    const selectedMuscleDetails = selectedMuscles.map(m => {
      const mg = analysis?.muscleGroups?.[m];
      return `  ${m.toUpperCase()}: ${mg?.score || '?'}/100 (${mg?.status || '?'}) — ${mg?.detail || 'no detail available'}`;
    }).join('\n');

    // Tüm kas skorları sıralı (en düşükten en yükseğe)
    const allScoresSorted = analysis?.muscleGroups
      ? Object.entries(analysis.muscleGroups)
          .filter(([, v]) => v?.score != null)
          .sort((a, b) => (a[1].score || 99) - (b[1].score || 99))
          .map(([k, v]) => `  ${k}: ${v.score}/100 (${v.status})`)
          .join('\n')
      : '  not available';

    // Postur sorunları
    const postureIssues = [];
    if (analysis?.postureAnalysis?.roundedShoulders !== 'none') postureIssues.push(`rounded shoulders (${analysis.postureAnalysis.roundedShoulders})`);
    if (analysis?.postureAnalysis?.forwardHead !== 'none') postureIssues.push(`forward head (${analysis.postureAnalysis.forwardHead})`);
    if (analysis?.postureAnalysis?.pelvicTilt !== 'none') postureIssues.push(`pelvic tilt (${analysis.postureAnalysis.pelvicTilt})`);
    const postureText = postureIssues.length ? postureIssues.join(', ') : 'none detected';

    // Ekipman listesi
    const exerciseList = [];
    if (programPrefs?.equipment?.includes('barbell') || !programPrefs?.equipment?.length)
      exerciseList.push('BARBELL: Barbell Bench Press, Barbell Row, Barbell Curl, Barbell Shoulder Press, Back Squat, Barbell Hip Thrust');
    if (programPrefs?.equipment?.includes('dumbbell') || !programPrefs?.equipment?.length)
      exerciseList.push('DUMBBELL: Dumbbell Bench Press, Incline Dumbbell Press, Dumbbell Fly, Dumbbell Shoulder Press, Dumbbell Lateral Raise, Dumbbell Front Raise, Dumbbell Curl, Hammer Curl, Romanian Deadlift, Goblet Squat, Dumbbell Row, Dumbbell Shrug');
    if (programPrefs?.equipment?.includes('machine') || !programPrefs?.equipment?.length)
      exerciseList.push('MACHINE: Chest Press Machine, Incline Machine Press, Leg Press, Leg Extension, Leg Curl, Shoulder Press Machine, Rear Delt Fly Machine, Ab Machine, Hip Thrust Machine, Glute Kickback Machine, Smith Machine Squat');
    if (programPrefs?.equipment?.includes('cable') || !programPrefs?.equipment?.length)
      exerciseList.push('CABLE: Cable Chest Fly, Low Cable Fly, Lat Pulldown, Close Grip Pulldown, Seated Cable Row, Cable Lateral Raise, Cable Front Raise, Cable Curl, Tricep Pushdown, Overhead Tricep Extension, Cable Crunch, Straight Arm Pulldown, Face Pull, Cable Kickback, Cable Pull Through');
    if (programPrefs?.equipment?.includes('bands'))
      exerciseList.push('BANDS: Band Pull-Apart, Band Lateral Walk, Band Curl, Band Tricep Extension');
    if (programPrefs?.equipment?.includes('bodyweight'))
      exerciseList.push('BODYWEIGHT: Push-up, Wide Push-up, Diamond Push-up, Incline Push-up, Decline Push-up, Pike Push-up (shoulders), Tricep Dips (use chair), Bodyweight Squat, Reverse Lunge, Step-up, Glute Bridge, Single Leg Glute Bridge, Plank, Side Plank, Mountain Climber, Hanging Leg Raise, Crunch, Bicycle Crunch, Superman, Bodyweight Row (use table), Inverted Row');

    const prompt = `You are a world-class physique coach who writes programs that feel UNIQUELY tailored to each person.
The user has just received their body analysis. Now create a training program that feels like a DIRECT RESPONSE to that analysis.
Return ONLY valid JSON. No markdown.

━━━ WHO THIS PERSON IS ━━━
Age: ${profile.age || 25} | Weight: ${profile.weight || 75}kg | Height: ${profile.height || 170}cm
Gender: ${profile.gender === 'male' ? 'Male' : 'Female'} | Experience: ${experience}
Goal: ${profile.primaryGoal === 'muscle' ? 'Muscle gain' : profile.primaryGoal === 'lose' ? 'Fat loss' : 'Stay fit'}
Body Fat: ${bodyFat} | Overall Physique Score: ${overallScore}/100
Body Pattern: ${bodyPattern} — THIS IS CRUCIAL. Let this define your entire approach.
Strategy Path from analysis: ${strategyPath}

━━━ WHAT THEIR ANALYSIS REVEALED ━━━
V-Taper Rating: ${vTaper} | Upper/Lower Balance: ${upperLowerBalance}
Posture Issues: ${postureText}

ALL MUSCLE SCORES (lowest = most underdeveloped):
${allScoresSorted}

━━━ MUSCLES THEY WANT TO PRIORITIZE ━━━
${selectedMuscleDetails}

━━━ TRAINING SETUP ━━━
Weekly days: EXACTLY ${weeklyDays} | Session: ${duration} min | Split: ${split}
Equipment: ${equipment}
Disliked exercises: ${disliked}
Injuries/Pain: ${injuries}
Special requests: ${customNote || 'none'}

━━━ BODY PATTERN PROGRAMMING GUIDE ━━━
Based on body pattern "${bodyPattern}", here's how to approach this program:

${bodyPattern === 'skinny_fat' ? `SKINNY FAT APPROACH:
- Focus: body recomposition — build muscle without adding fat
- Priority: compound movements for maximum muscle stimulus
- Avoid: excessive isolation work early on
- Cardio: 2x/week LISS — walk, bike, light jog (20-30 min) — do NOT add to program days but mention in notes
- Volume: moderate (12-15 sets per muscle per week)
- Rep ranges: 8-15 for hypertrophy and fat-burning stimulus` : ''}

${bodyPattern === 'bulk_physique' ? `BULK PHYSIQUE APPROACH:
- Focus: definition — maintain muscle while improving conditioning
- Priority: supersets and circuits for metabolic stress
- Keep compound movements heavy — protect muscle mass
- Volume: slightly lower (10-12 sets per muscle) to allow fat burning
- Rep ranges: 10-15 for metabolic demand
- Cardio: recommend 2-3x HIIT weekly — add note in program` : ''}

${bodyPattern === 'athletic_small' ? `ATHLETIC SMALL APPROACH:
- Focus: mass building — progressive overload is everything
- Priority: heavy compound movements with progressive loading
- Volume: HIGH (16-20 sets per lagging muscle per week)
- Rep ranges: 6-12, prioritize strength in 6-8 range for compounds
- Add extra sets to ALL lagging muscles — no mercy on volume` : ''}

${bodyPattern === 'aesthetic_lean' ? `AESTHETIC LEAN APPROACH:
- Focus: muscle fullness and weak point development
- Priority: targeted volume on lagging muscles, maintain strengths
- Volume: focused (12-16 sets for weak points, 8-10 for strong)
- Rep ranges: 8-15, pump-focused for detail work
- Include stretch-focused exercises (cables, flyes)` : ''}

${bodyPattern === 'beginner' ? `BEGINNER APPROACH:
- Focus: movement quality first, then progressive overload
- Priority: machine-dominant for safety and mind-muscle connection
- Volume: moderate (10-12 sets per muscle per week)
- Rep ranges: 10-15 to learn movements and build work capacity
- Avoid: complex compound movements until form is established` : ''}

${bodyPattern === 'advanced' ? `ADVANCED APPROACH:
- Focus: intelligent specialization on lagging muscles
- Priority: periodization — heavier compounds + targeted isolation
- Volume: can handle high (16-20 sets for priority muscles)
- Rep ranges: varied (6-8 heavy + 10-12 moderate + 15-20 pump)
- Include: techniques like drop sets, rest-pause, supersets` : ''}

${bodyPattern === 'unbalanced' ? `UNBALANCED APPROACH:
- Focus: correcting the imbalance — lagging side gets MORE volume
- Priority: isolateral exercises (dumbbell, unilateral cable)
- Upper/Lower balance: ${upperLowerBalance === 'upper_dominant' ? 'ADD EXTRA LEG DAY — lower body is significantly behind' : upperLowerBalance === 'lower_dominant' ? 'ADD EXTRA UPPER BODY WORK — upper body is lagging' : 'balanced enough, focus on specific muscle imbalances'}
- Volume: lagging muscles get 20-30% more sets than dominant ones
- Rep ranges: 10-15 for lagging, 8-12 for dominant` : ''}

━━━ CRITICAL PROGRAMMING RULES ━━━
1. PROGRAM must have EXACTLY ${weeklyDays} days — non-negotiable
2. Each day MUST have MINIMUM 5 exercises, MAXIMUM 7. If equipment is limited (bodyweight only), get creative — use push-up variations (wide, diamond, decline, pike), dip variations, plank variations, etc. NEVER give fewer than 5 exercises per day.
3. ${isBeginnerOrInter ? 'BEGINNER/INTERMEDIATE: Machines and dumbbells first. No heavy barbell squat or deadlift unless requested.' : 'ADVANCED: Strategic barbell use. Quality over quantity.'}
4. NEVER use exercises requiring unavailable equipment. If ONLY bodyweight selected, ONLY use bodyweight exercises — no dumbbells, no machines, no cables, no barbells.
5. NEVER prescribe exercises that aggravate stated injuries
6. LEG SKIP RULE — CRITICAL: User said they do NOT want leg training: "${disliked}". If legs/bacak is in disliked: DO NOT include ANY leg exercises (no leg press, no squat, no lunge, no leg curl, no calf raise). Replace leg days with: extra upper body day, arm specialization day, or full body upper. Restructure the split completely to avoid legs.
7. SPLIT RESTRUCTURE when legs are skipped: Instead of Upper/Lower, use Push/Pull/Arms/Full-Upper or similar. Create ${weeklyDays} days that make sense WITHOUT legs.
8. If posture issues exist (${postureText}): include corrective exercises
9. "reason" field: MUST reference actual analysis data
10. Set/rep: muscle gain = 3-4x8-12 | fat loss = 3-4x12-15 | strength = 4-5x5-8
11. BODYWEIGHT ONLY — if equipment is ONLY bodyweight, here's how to fill 5-7 exercises per day:
    - Push day: Push-up, Wide Push-up, Diamond Push-up, Decline Push-up, Pike Push-up, Tricep Dips, Plank
    - Pull day: Bodyweight Row (table), Inverted Row, Superman, Reverse Snow Angel, Face Pull (band if available)
    - Legs (if wanted): Bodyweight Squat, Lunge, Glute Bridge, Single Leg Glute Bridge, Step-up, Mountain Climber
    - Core: Plank, Side Plank, Mountain Climber, Crunch, Bicycle Crunch, Hanging Leg Raise

━━━ EXERCISE LIST (ONLY USE THESE) ━━━
${exerciseList.join('\n')}

Return this JSON:
{
  "focusMuscles": "${selectedMuscles.join(', ')}",
  "splitType": "${split}",
  "bodyPatternApproach": "${bodyPattern}",
  "programContext": "<2-3 Türkçe cümle: Bu programın NEDEN bu kişi için bu şekilde tasarlandığını açıkla — vücut analizi bulgularına direkt referans ver. Örnek: 'Analizinde V-taper oranın fair seviyede, omuzların 48/100 skoruyla zayıf görünüyor. Bu program öncelikli olarak lateral deltoid hacmini ve üst göğüs gelişimini hedefliyor çünkü bu iki alan görsel olarak seni en çok atletik yapacak noktalardır.'>",
  "weeklyVolume": "<Türkçe haftalık set özeti — hangi kas grubuna kaç set, neden>",
  "progressionNotes": "<Türkçe ilerleme stratejisi — spesifik ve kişisel>",
  "PROGRAM": [
    {
      "day": "Gün 1 - [Kas Grubu]",
      "focus": "[Ana kas grupları]",
      "dayContext": "<1 Türkçe cümle: Bu günün amacı — analizle bağlantılı>",
      "duration": "${duration} dk",
      "exercises": [
        {
          "name": "Exercise Name",
          "sets": "4",
          "reps": "8-12",
          "rest": "90 sn",
          "intensity": "AĞIR",
          "technique": "<Türkçe teknik ipucu — spesifik>",
          "reason": "<Türkçe — MUST reference actual score or analysis finding>",
          "alternatives": ["Alternative 1", "Alternative 2"],
          "videoUrl": "https://youtube.com/results?search_query=exercise+name+form+tutorial"
        }
      ]
    }
  ]
}

FINAL CHECK before responding:
- Does PROGRAM have exactly ${weeklyDays} days? If not, fix it.
- Does each exercise's "reason" reference actual analysis data? If not, rewrite it.
- Does the program feel specifically designed for a ${bodyPattern} body type with ${vTaper} V-taper? If not, adjust it.`;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 16000,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a JSON API. Return ONLY valid JSON. First char {, last char }. No markdown.' },
        { role: 'user', content: prompt }
      ],
    });

    const raw = aiResponse?.choices?.[0]?.message?.content;
    if (!raw) return res.status(500).json({ success: false, error: 'AI yanit vermedi.' });

    const program = JSON.parse(extractJSON(raw));
    console.log('Program olusturuldu - ' + (program.PROGRAM?.length || 0) + ' gun, pattern: ' + program.bodyPatternApproach);
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
