// FlowSort.sortBalancedWave — сартаванне трэкаў па тэмпе і танальнасцях (Camelot)

var FlowSort = FlowSort || {};

FlowSort.sortBalancedWave = function(tracks, options) {

    // Унутраны перамыкач сцэнарыяў сартавання танальнасцей.
    const USE_KEY_SCENARIOS = true;

    // true  – выкарыстоўваць сцэнарыі (плыўнае развіццё),
    // false – працаваць без сцэнарыяў.

    if (!Array.isArray(tracks) || tracks.length === 0) return [];

    // --- Падцягванне features ---
    let featureMap = getCachedTracks(tracks, { features: {} }).features;
    tracks.forEach(track => {
        if (!track) return;
        track.features = featureMap[track.id] || {};
    });

    // --- Фільтрацыя смецця ---
    const before = tracks.length;

    const noId = tracks.filter(t => !t || !t.id);
    if (noId.length) {
        console.log("⚠️ Выкінуты трэкі без id:", noId.map(t => t ? (t.name || t.uri || "??") : "null"));
    }
    tracks = tracks.filter(t => t && t.id);

    const noFeat = tracks.filter(t => !t.features || !Object.keys(t.features).length);
    if (noFeat.length) {
        console.log("⚠️ Выкінуты трэкі без features:", noFeat.map(t => t.id));
    }
    tracks = tracks.filter(t => t.features && Object.keys(t.features).length > 0);

    console.log(`🔎 sortBalancedWave уваход: ${before} → пасля фільтрацыі: ${tracks.length}`);

    if (tracks.length < 4) return tracks.slice();  // абарона для маленькіх плэйлістоў
    options = options || {};
    const N = tracks.length;

    // --- Першасная падрыхтоўка тэмпу для distributeByTempoQuantile ---
    tracks.forEach(t => {
        const f = t.features || {};
        t._rawTempo = (typeof f.tempo === 'number') ? f.tempo : 120;
    });

    // --- 4. Размеркаванне па тэмпе ---
    const distributed = distributeByTempoQuantile(tracks);
    tracks = distributed; // далей увесь код працуе ўжо з трэкамі, размеркаванымі па тэмпе
    
    // --- Дынамічныя параметры (для плэйлістоў ад 4 да 4500 трэкаў) ---
    const MIN_TRACKS = 4;
    const MAX_TRACKS = 4500;

    // --- Памеры чанкаў і блокаў ---
    let CHUNK_SIZE = Math.min(N, Math.max(2, Math.round(14 + 6 * Math.pow((N - MIN_TRACKS) / (MAX_TRACKS - MIN_TRACKS), 0.8))));
    let STITCH_SIZE = Math.min(N, Math.max(2, Math.round(14 + 36 * Math.pow((N - MIN_TRACKS) / (MAX_TRACKS - MIN_TRACKS), 0.9))));
    let BLOCK_SIZE  = N < 20 ? N : Math.round(1800 + 200 * ((N - MIN_TRACKS) / (MAX_TRACKS - MIN_TRACKS)));

    // --- Параметры лакальнай аптымізацыі ---
    let SWAP_LOOKAHEAD = Math.min(N, Math.max(2, Math.round(30 + 30 * Math.pow((N - MIN_TRACKS) / (MAX_TRACKS - MIN_TRACKS), 1.1))));
    let MAX_PASSES = Math.max(1, Math.round(70 + 10 * Math.pow((N - MIN_TRACKS) / (MAX_TRACKS - MIN_TRACKS), 0.6)));
    let TWO_OPT_ITER = N > 2000 ? 1500 + Math.round((N - 2000) * 0.25) : Math.round(Math.sqrt(N) * 10);

    // --- Абарона для звышмаленькіх плэйлістоў (N < 5) ---
    if(N < 5){
        CHUNK_SIZE = N;
        STITCH_SIZE = N;
        BLOCK_SIZE = N;
        SWAP_LOOKAHEAD = N;
        MAX_PASSES = 1;
        TWO_OPT_ITER = 5;
    }

    // --- Вагі ---
    const DEFAULT_WEIGHTS = { tempo: 0.53, harmony: 0.45, energy: 0.01, valence: 0.01 };
    const WEIGHTS = Object.assign({}, DEFAULT_WEIGHTS, options.weights || {});

    // --- Сцэнарыі «плыўнага развіцця» па Camelot (гібрыдны пласт) ---
    // Для кожнай пазіцыі 0..23 задаём пераважныя выхады:
    //   - крок наперад па крузе ў той жа секцыі (3A→4A, 7B→8B)
    //   - крок назад па крузе ў той жа секцыі (4A→3A, 8B→7B)
    //   - паралельны лад (3A↔3B)
    const CAM_SCENARIO_GRAPH = (() => {
        const map = {};
        for (let pos = 0; pos < 24; pos++) {
            const num    = pos % 12;             // 0..11 унутры сектара
            const sector = Math.floor(pos / 12); // 0 = A (minor), 1 = B (major)

            // крок наперад па крузе ў той жа секцыі
            const nextSameMode = ((num + 1) % 12) + sector * 12;
            // крок назад па крузе ў той жа секцыі
            const prevSameMode = ((num + 11) % 12) + sector * 12; // (num - 1 + 12) % 12
            // паралельны лад (Am ↔ C і г.д.)
            const parallel     = num + (1 - sector) * 12;

            const diagNext = ((num + 1) % 12) + (1 - sector) * 12;
            const diagPrev = ((num + 11) % 12) + (1 - sector) * 12;

            map[pos] = [nextSameMode, prevSameMode, parallel, diagNext, diagPrev]; 
        }
        return map;
    })();

    // --- Падрыхтоўка трэкаў ---
    const localTracks = tracks.map((t,i)=>({ ...t, features: {...(t.features||{})}, _originalIndex:i }));
    tracks = localTracks;

    tracks.forEach(t=>{
        const f = t.features||{};
        t._energy = (typeof f.energy==='number')?f.energy:0;
        t._valence = (typeof f.valence==='number')?f.valence:0;
        t._key = (typeof f.key==='number' && !isNaN(f.key) && f.key>=0) ? f.key : null;
        t._mode = (typeof f.mode === 'number') ? f.mode : null;
    });

    // --- Нармалізацыя рангаў ---
    const assignRanks = (arr,key,rankName)=>{
        const sorted = [...arr].sort((a,b)=>a[key]-b[key]);
        const n = sorted.length;
        if(n===0) return;
        for(let i=0;i<n;i++) sorted[i][rankName] = i/(n-1||1);
        const step = 1/(n||1);
        for(let i=0;i<n;i++) sorted[i][rankName] = (sorted[i][rankName]+i*step)/2;
    };
    assignRanks(tracks,'_rawTempo','_nTempo');
    assignRanks(tracks,'_energy','_nEnergy');
    assignRanks(tracks,'_valence','_nMood');

    // --- Camelot-індэкс з Spotify key/mode ---
    function camelotIndex(key, mode) {
        if (key == null || mode == null) return null;
        key = key % 12;

        // Парадак па крузе квінтаў для мінораў (1A..12A) у тэрмінах Spotify key
        const minorOrder = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];
        // Парадак па крузе квінтаў для мажораў (1B..12B)
        const majorOrder = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4];

        if (mode === 0) { // minor (A)
            const idx = minorOrder.indexOf(key);
            return idx === -1 ? null : idx;        // 0..11 → 1A..12A
        } else {          // major (B)
            const idx = majorOrder.indexOf(key);
            return idx === -1 ? null : 12 + idx;   // 12..23 → 1B..12B
        }
    }

    const tracksWithKey = tracks.filter(t => t._key != null && t._mode != null);
    const anyWithKey = tracksWithKey.length > 0;

    // 1-ы праход: будуем _camelot з _key/_mode
    tracks.forEach(t => {
        if (t._key != null && t._mode != null) {
            const pos = camelotIndex(t._key, t._mode);
            t._camelot = (pos != null ? pos : null); // 0..23 або null
        } else {
            t._camelot = null;
        }
        if (t._camelot != null) t._camelot = Math.max(0, Math.min(t._camelot, 23));
    });

    // [MODIFIED] 2-і праход: Маркіроўка трэкаў без танальнасці
    tracks.forEach((t) => {
        // Калі Camelot не вызначаны (няма ключа), ставім сцяг _isKeyless
        if (t._camelot == null) {
            t._isKeyless = true;
            t._nKey = 0.5; // Тэхнічнае значэнне (сярэдзіна), у разліках удзельнічаць не будзе
        } else {
            t._isKeyless = false;
            // Звычайная нармалізацыя
            t._camelot = Math.max(0, Math.min(t._camelot, 23));
            t._nKey = t._camelot / 24;
        }
    });

    // --- Метрыка блізкасці ---
    const cache = new Map();
    const CACHE_LIMIT = options.cacheLimit || 800000;
    const pairKey = (a,b) => {
        const idA = String(a.id), idB = String(b.id);
        return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
    };
    
    const softDistance = (a,b)=>{

        if (a._isKeyless && b._isKeyless) {
            return 3000000;
        }
        if (!a || !b) return 1.0;

        // ЛОГ: адзін раз на запуск пакажам, у якім рэжыме працуем
        if (!softDistance._flagLogged) {
            console.log("USE_KEY_SCENARIOS =", USE_KEY_SCENARIOS);
            softDistance._flagLogged = true;
        }

        const k = pairKey(a,b);
        if (cache.has(k)) return cache.get(k);
    
        let dTempo = Math.abs(a._nTempo - b._nTempo);

        if (a._rawTempo && b._rawTempo) {
            const bpmA = a._rawTempo;
            const bpmB = b._rawTempo;
            const tol = 0.04; // 5% талерантнасць

            const isDouble = Math.abs(bpmA * 2 - bpmB) < bpmB * tol || Math.abs(bpmB * 2 - bpmA) < bpmA * tol;
            const isHalf = Math.abs(bpmA / 2 - bpmB) < bpmB * tol || Math.abs(bpmB / 2 - bpmA) < bpmA * tol;

            if (isDouble || isHalf) {
                // Ставім фіксаваны "кошт" як у суседняга трэка (розніца ~2 BPM)
                dTempo = 0.025; 
            }
        }

        // ---  Зыходная логіка Camelot ---
        function camelotCompatible(posA, posB) {
            // той жа ключ → ідэальна
            if (posA === posB) return 0.0;

            const aNum = posA % 12;
            const bNum = posB % 12;
            const aSector = Math.floor(posA / 12); // 0 = мінор (A), 1 = мажор (B)
            const bSector = Math.floor(posB / 12);

            const sameSector = (aSector === bSector);

            // адлегласць па крузе 12 нумароў (1..12)
            const diff12 = Math.min(
                (aNum - bNum + 12) % 12,
                (bNum - aNum + 12) % 12
            );

            // ---- прыярытэты Camelot (жорстка зададзеныя ўзроўні) ----

            // 1) Сусед па крузе ў той жа секцыі (4A → 5A, 7B → 8B)
            if (sameSector && diff12 === 1) return 0.05;

            // 2) Паралельны лад (8A ↔️ 8B)
            if (aNum === bNum && aSector !== bSector) return 0.12;

            if (!sameSector && diff12 === 1) return 0.18; // Дыяганаль (напрыклад, 1A -> 2B)

            // 3) Крок праз адзін нумар па крузе ў той жа секцыі (4A → 6A, 5B → 7B)
            if (sameSector && diff12 === 2) return 0.22;

            // ---- усё астатняе лічым па адлегласці па крузе з 24 пазіцый ----

            let diff = Math.abs(posA - posB);
            diff = Math.min(diff, 24 - diff); // wrap-around 0..12

            // Базавая шкала для "астатніх":
            // блізкія (diff≈2–3) — умерана штрафуюцца,
            // далёкія (diff→12) — адчувальна даражэй, але не забойча.
            const MIN_PENALTY = 0.18;  // мяккі мінімум
            const MAX_PENALTY = 0.80;  // мяккі максімум
            const MAX_STEPS   = 12;
       
            let penalty = MIN_PENALTY +
                (diff - 1) / (MAX_STEPS - 1) * (MAX_PENALTY - MIN_PENALTY);

            // Трытон і далей (прыкладна 6 крокаў і >) злёгку падціскаем
            if (diff >= 6) {
                penalty += 0.04;
            }

            if (penalty > MAX_PENALTY) penalty = MAX_PENALTY;

            return penalty;
        }

        // [MODIFIED] --- Разлік базавых розніц ---
        const dEnergy = Math.abs(a._nEnergy - b._nEnergy);
        const dValence = Math.abs(a._nMood - b._nMood);
        
        let val = 0;

        // СЦЭНАРЫЙ Б: Праца з пустышкамі (трэкамі без ключа)
        if (a._isKeyless || b._isKeyless) {
            const tA = a._nTempo || 0;
            const tB = b._nTempo || 0;
            const rawA = a._rawTempo || 120;
            const rawB = b._rawTempo || 120;
            const tol = 0.04; 

            // 1. Спачатку вызначаем, ці з'яўляецца гэта кратным пераходам
            const isPerfectDrop = Math.abs(rawA / 2 - rawB) < (rawB * tol); 
            const isPerfectRise = Math.abs(rawA * 2 - rawB) < (rawB * tol);

            // 2. Лічым кошт "суседняга кроку"
            const neighborStep = 0.025;
            const neighborCost = Math.pow(neighborStep, 2) * 1000 + (neighborStep * 50);

            if (isPerfectDrop || isPerfectRise) {
                // Калі кратна — дазваляем і даем малую вагу
                val = neighborCost;
            } 
            else if (tA > tB) {
                // Калі проста падае (і не кратна) — забараняем
                return 2000000;
            } 
            else {
                // Звычайны рост тэмпу
                const diff = Math.abs(tB - tA);
                if (diff < 0.005) {
                    val = 0.0001;
                } else {
                    val = Math.pow(diff, 2) * 1000 + (diff * 50);
                    if (diff > 0.035) val += 1000;
                }
            }
            val *= 5.0; 
        }
        // СЦЭНАРЫЙ В: Абодва трэкі З ТАНАЛЬНАСЦЮ (Стандартная логіка + Сцэнарыі)
        else {
            const aPos = (a._camelot != null ? a._camelot : Math.floor(a._nKey * 24));
            const bPos = (b._camelot != null ? b._camelot : Math.floor(b._nKey * 24));
            const dKey = camelotCompatible(aPos, bPos);
            
            const weightHarmony = WEIGHTS.harmony;

            val = Math.sqrt(
                WEIGHTS.tempo   * Math.pow(dTempo,   2) +
                weightHarmony   * Math.pow(dKey,     2) +
                WEIGHTS.energy  * Math.pow(dEnergy,  2) +
                WEIGHTS.valence * Math.pow(dValence, 2)
            );

            // --- Логіка сцэнарыяў (толькі для трэкаў з ключамі) ---
            if (USE_KEY_SCENARIOS) {
                const exits = CAM_SCENARIO_GRAPH[aPos];
                if (exits && exits.length) {
                    const isScenario = exits.includes(bPos);
                    const TEMPO_CLOSE = 0.08;
                    const TEMPO_MID   = 0.16;
                    const isDiagonal = (aPos !== bPos) && 
                                       (Math.min((aPos % 12 - bPos % 12 + 12) % 12, (bPos % 12 - aPos % 12 + 12) % 12) === 1) && 
                                       (Math.floor(aPos / 12) !== Math.floor(bPos / 12));

                    if (isScenario) {
                        if (dTempo < TEMPO_CLOSE) val *= 0.80;
                        else if (dTempo < TEMPO_MID && !isDiagonal) val *= 0.90;
                    } else if (dKey < 0.40) {
                        val *= (dTempo < TEMPO_CLOSE) ? 1.05 : 1.03;
                    }
                }
            } else {
                // Fallback без сцэнарыяў
                const exits = CAM_SCENARIO_GRAPH[aPos];
                if (exits && exits.length) {
                    const isScenario = exits.includes(bPos);
                    const TEMPO_SAFE  = 0.08;
                    const KEY_TROUBLE = 0.35;
                    if (dTempo < TEMPO_SAFE && dKey > KEY_TROUBLE) {
                        if (isScenario) val *= 0.90;
                        else val *= 1.02;
                    }
                }
            }
        }

        if (cache.size > CACHE_LIMIT) {
            let i = 0;
            for (let key of cache.keys()) {
                cache.delete(key);
                if (++i > CACHE_LIMIT * 0.1) break;
            }
        }
        cache.set(k, val);
        return val;
    };

    const pairCost = (a,b,c,d)=>{
        let sum=0;
        if(a&&b) sum+=softDistance(a,b);
        if(c&&d) sum+=softDistance(c,d);
        return sum;
    };

    const splitIntoChunks = (arr,size)=>{
        const chunks=[];
        for(let i=0;i<arr.length;i+=size) chunks.push(arr.slice(i,i+size));
        return chunks;
    };

    const twoOptImprove = (seq, maxIter)=>{
        const L = seq.length;
        let improved = true;
        let iter = 0;
        while(improved && iter<maxIter){
            improved=false;
            for(let i=0;i<L-2;i++){
                for(let j=i+2;j<L;j++){
                    const a=seq[i], b=seq[i+1], c=seq[j];
                    const d=seq[j+1]||null;
                    const before=softDistance(a,b)+softDistance(c,d||c);
                    const after=softDistance(a,c)+softDistance(b,d||b);
                    if(after<before){
                        const rev=seq.slice(i+1,j+1).reverse();
                        seq=[...seq.slice(0,i+1),...rev,...seq.slice(j+1)];
                        improved=true;
                    }
                }
            }
            iter++;
        }
        return seq;
    };

    const optimizeChunk = chunk=>{
        if(!chunk||chunk.length<=1) return chunk.slice();
        const L = chunk.length;
        let bestSeq = null;
        let bestScore = Infinity;

        const maxStarts = Math.min(20, L);
        for (let startIdx = 0; startIdx < maxStarts; startIdx++) {
            const used = new Set();
            let cur = chunk[startIdx];
            if (!cur) continue; // абарона на ўсялякі выпадак

            // адзначаем сам аб'ект, а не id
            used.add(cur);
            const seq = [cur];

            while (seq.length < L) {
                let next = null, bestD = Infinity;

                for (const c of chunk) {
                    if (!c) continue;
                    if (used.has(c)) continue; // гэты асобнік ужо выкарыстаны
                    const d = softDistance(cur, c);
                    if (d < bestD) {
                        bestD = d;
                        next = c;
                    }
                }

                // калі кандыдатаў больш няма — выходзім
                if (!next) break;

                seq.push(next);
                used.add(next);
                cur = next;
            }

            let total = 0;
            for (let i = 1; i < seq.length; i++) total += softDistance(seq[i - 1], seq[i]);
            if (total < bestScore) { bestScore = total; bestSeq = seq; }
        }

        if(!bestSeq) bestSeq=chunk.slice();

        const look = Math.max(1, Math.min(SWAP_LOOKAHEAD,bestSeq.length));
        for(let pass=0;pass<MAX_PASSES;pass++){
            let improved=false;
            for(let i=0;i<bestSeq.length-1;i++){
                let bestJ=-1,bestDelta=0;
                for(let j=i+1;j<Math.min(bestSeq.length,i+1+look);j++){
                    const a=bestSeq[i-1]||null, b=bestSeq[i], c=bestSeq[j-1]||null, d=bestSeq[j], e=bestSeq[i+1]||null, f=bestSeq[j+1]||null;
                    const costBefore=pairCost(a,b,c,d)+pairCost(b,e,d,f);
                    const temp=bestSeq.slice(); [temp[i],temp[j]]=[temp[j],temp[i]];
                    const costAfter=pairCost(temp[i-1]||null,temp[i]||null,temp[j-1]||null,temp[j]||null)
                                    +pairCost(temp[i]||null,temp[i+1]||null,temp[j]||null,temp[j+1]||null);
                    const delta=costBefore-costAfter;
                    if(delta>bestDelta){ bestDelta=delta; bestJ=j; }
                }
                if(bestJ>0){ [bestSeq[i],bestSeq[bestJ]]=[bestSeq[bestJ],bestSeq[i]]; improved=true; }
            }
            if(!improved) break;
        }

        if(TWO_OPT_ITER>0) bestSeq = twoOptImprove(bestSeq, TWO_OPT_ITER);

        return bestSeq;
    };

    function distributeByTempoQuantile(tracks, numIntervals = 10, peakThreshold = 0.05) {
        if (!Array.isArray(tracks) || tracks.length === 0) return [];

        const N = tracks.length;

        // --- Сартаванне па тэмпе ---
        const sorted = [...tracks].sort((a, b) => (a._rawTempo || 120) - (b._rawTempo || 120));
        const minTempo = sorted[0]._rawTempo || 120;
        const maxTempo = sorted[sorted.length - 1]._rawTempo || 120;
        const rangeTempo = maxTempo - minTempo || 1;

        // --- Вызначэнне экстрэмальных пікаў ---
        const lowCut = minTempo + rangeTempo * peakThreshold;
        const highCut = maxTempo - rangeTempo * peakThreshold;

        const lowPeaks = [];
        const highPeaks = [];
        const normalTracks = [];

        sorted.forEach(t => {
            const tempo = t._rawTempo || 120;
            if (tempo <= lowCut) lowPeaks.push(t);
            else if (tempo >= highCut) highPeaks.push(t);
            else normalTracks.push(t);
        });

        // --- Дзяленне нармальных трэкаў на інтэрвалы ---
        const intervalSize = (highCut - lowCut) / numIntervals || 1;
        const intervals = Array.from({ length: numIntervals }, () => []);

        normalTracks.forEach(t => {
            const tempo = t._rawTempo || 120;
            let idx = Math.floor((tempo - lowCut) / intervalSize);
            if (idx >= numIntervals) idx = numIntervals - 1;
            intervals[idx].push(t);
        });

        // --- Рандамізацыя ўнутры інтэрвалаў (Тасаванне Фішэра-Ейтса) ---
        intervals.forEach(interval => {
            for (let i = interval.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [interval[i], interval[j]] = [interval[j], interval[i]];
            }
        });

        // --- Чаргаванне інтэрвалаў з выпадковым парадкам на кожным крузе ---
        const playlist = [];
        const indices = Array(numIntervals).fill(0);
        while (playlist.length < normalTracks.length) {
            const intervalOrder = [...Array(numIntervals).keys()];
            for (let i = intervalOrder.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [intervalOrder[i], intervalOrder[j]] = [intervalOrder[j], intervalOrder[i]];
            }
            for (let idx of intervalOrder) {
                if (indices[idx] < intervals[idx].length) {
                    playlist.push(intervals[idx][indices[idx]]);
                    indices[idx]++;
                }
            }
        }

        // --- Устаўка пікаў (low/high) раўнамерна ---
        const insertPeaks = (peaks) => {
            if (!peaks.length) return;
            const step = Math.ceil(playlist.length / (peaks.length + 1));
            let offset = step - 1;
            peaks.forEach(p => {
                playlist.splice(offset, 0, p);
                offset += step;
            });
        };

        insertPeaks(lowPeaks);
        insertPeaks(highPeaks);

        return playlist;
    }

    // --- сартаванне блокаў і глабальная зборка ---
    const sortBlock = blockTracks=>{
        const chunks=splitIntoChunks(blockTracks,CHUNK_SIZE).map(optimizeChunk).filter(Boolean);
        if(!chunks.length) return [];
        let result=chunks.shift().slice();
        while(chunks.length){
            const last=result[result.length-1];
            let bestIdx=-1,bestChoice=null,bestScore=Infinity;
            for(let idx=0;idx<chunks.length;idx++){
                const cand=chunks[idx];
                const w=[1,0.5,0.25];
                const calcForward=()=>{let s=0;for(let k=0;k<3;k++){if(k<cand.length) s+=w[k]*softDistance(last,cand[k]);} return s;};
                const calcBackward=()=>{let s=0;for(let k=0;k<3;k++){const idxBack=cand.length-1-k;if(idxBack>=0) s+=w[k]*softDistance(last,cand[idxBack]);} return s;};
                const choice=(calcForward()<calcBackward())?{cand,reverse:false,score:calcForward()}:{cand:[...cand].reverse(),reverse:true,score:calcBackward()};
                if(choice.score<bestScore){ bestScore=choice.score; bestChoice=choice; bestIdx=idx; }
            }
            if(bestIdx>=0) chunks.splice(bestIdx,1);
            result.push(...bestChoice.cand);
        }

        const lookBlock=Math.max(1,Math.min(SWAP_LOOKAHEAD,result.length));
        for(let pass=0;pass<MAX_PASSES;pass++){
            let improved=false;
            for(let i=0;i<result.length-1;i++){
                for(let j=i+1;j<Math.min(result.length,i+1+lookBlock);j++){
                    const temp=result.slice(); [temp[i],temp[j]]=[temp[j],temp[i]];
                    const costBefore=pairCost(result[i-1]||null,result[i]||null,result[j-1]||null,result[j]||null)
                                     +pairCost(result[i]||null,result[i+1]||null,result[j]||null,result[j+1]||null);
                    const costAfter=pairCost(temp[i-1]||null,temp[i]||null,temp[j-1]||null,temp[j]||null)
                                    +pairCost(temp[i]||null,temp[i+1]||null,temp[j]||null,temp[j+1]||null);
                    if(costAfter<costBefore){ result=temp; improved=true; }
                }
            }
            if(!improved) break;
        }

        if(TWO_OPT_ITER>0) result = twoOptImprove(result, TWO_OPT_ITER);

        return result;
    };

    let stitched;
    if(tracks.length<=BLOCK_SIZE){
        stitched = sortBlock(tracks);
    } else {
        const blocks = [];
        const dynamicBlockSize = Math.ceil(Math.sqrt(tracks.length) * 10);
        for (let i = 0; i < tracks.length; i += dynamicBlockSize) {
            blocks.push(tracks.slice(i, i + dynamicBlockSize));
        }
        const sortedBlocks = blocks.map(sortBlock);

        stitched = [];
        const seen = new Set();
        for (const block of sortedBlocks) {
            const filtered = block.filter(t => !seen.has(t.id));
            if (!filtered.length) continue;
            if (!stitched.length) {
                filtered.forEach(t => { stitched.push(t); seen.add(t.id); });
                continue;
            }

            const tail = stitched.slice(Math.max(0, stitched.length - 3));
            let bestShift = 0, bestRev = false, bestScore = Infinity;
            const maxShift = Math.min(filtered.length, STITCH_SIZE);

            for (let shift = 0; shift < maxShift; shift++) {
                let scoreF = 0;
                for (let tIdx = 0; tIdx < 3; tIdx++) {
                    const tailIdx = tail.length - 1 - tIdx;
                    const candIdx = shift + tIdx;
                    if (tailIdx < 0 || candIdx >= filtered.length) continue;
                    const weight = (tIdx === 0 ? 1.0 : (tIdx === 1 ? 0.6 : 0.35));
                    scoreF += weight * softDistance(tail[tailIdx], filtered[candIdx]);
                }
                if (scoreF < bestScore) { bestScore = scoreF; bestShift = shift; bestRev = false; }

                const rev = [...filtered].reverse();
                let scoreR = 0;
                for (let tIdx = 0; tIdx < 3; tIdx++) {
                    const tailIdx = tail.length - 1 - tIdx;
                    const candIdx = shift + tIdx;
                    if (tailIdx < 0 || candIdx >= rev.length) continue;
                    const weight = (tIdx === 0 ? 1.0 : (tIdx === 1 ? 0.6 : 0.35));
                    scoreR += weight * softDistance(tail[tailIdx], rev[candIdx]);
                }
                if (scoreR < bestScore) { bestScore = scoreR; bestShift = shift; bestRev = true; }
            }

            let blockInsert = bestRev ? [...filtered].reverse() : filtered.slice();
            if (bestShift > 0) blockInsert = [...blockInsert.slice(bestShift), ...blockInsert.slice(0, bestShift)];
            blockInsert.forEach(t => { if (!seen.has(t.id)) { stitched.push(t); seen.add(t.id); } });
        }

        const idSet = new Set();
        stitched = stitched.filter(t => !idSet.has(t.id) && idSet.add(t.id));

        for (const m of tracks) {
            if (idSet.has(m.id)) continue;
            let bestPos = stitched.length, bestScore = Infinity;
            if (stitched.length > 1) {
                for (let i = 0; i < stitched.length - 1; i++) {
                    const prev = stitched[i], next = stitched[i + 1];
                    const prev2 = stitched[i - 1] || null, next2 = stitched[i + 2] || null;
                    let dist = softDistance(prev, m) + softDistance(m, next);
                    if (prev2) dist += 0.25 * (softDistance(prev2, m) + softDistance(m, prev));
                    if (next2) dist += 0.25 * (softDistance(m, next2) + softDistance(next, m));
                    if (dist < bestScore) { bestScore = dist; bestPos = i + 1; }
                }
            }
            stitched.splice(bestPos, 0, m);
            idSet.add(m.id);
        }
    }

    // --- Фінальны праход (зберагалы, кантэкстны, сіметрычны) ---

    function getFinalLook(N) {
        const minN = 4, maxN = 4500;
        const minDiv = 2, maxDiv = 20;
        const t = (N - minN) / (maxN - minN);
        const div = minDiv + (maxDiv - minDiv) * t;
        return Math.max(4, Math.floor(N / div));
    }

    let finalLook = Math.min(getFinalLook(N), 24);

    // --- ацэнка якасці бягучай плыні ---
    let avgDist = 0;
    for (let i = 1; i < stitched.length; i++) {
        avgDist += softDistance(stitched[i - 1], stitched[i]);
    }
    avgDist /= Math.max(1, stitched.length - 1);

    // калі плынь ужо добрая — рэзка абмяжоўваем зону ўмяшання
    if (avgDist < 0.22) finalLook = Math.min(finalLook, 8);

    const MIN_DELTA = 0.03;
    const REL_GAIN  = 0.08;   // мінімум 8% адноснага выйгрышу
    const GOOD_PAIR = 0.18;   // «здаровая» лакальная зона — не чапаць

    for (let pass = 0; pass < 2; pass++) {
        let improved = false;

        for (let i = 0; i < stitched.length - 1; i++) {

            // --- абарона лакальнай зоны вакол i ---
            const localCostI =
                (stitched[i - 1] ? softDistance(stitched[i - 1], stitched[i]) : 0) +
                (stitched[i + 1] ? softDistance(stitched[i], stitched[i + 1]) : 0);

            if (localCostI < GOOD_PAIR) continue;

            for (let j = i + 1; j < Math.min(stitched.length, i + 1 + finalLook); j++) {

                // --- абарона лакальнай зоны вакол j ---
                const localCostJ =
                    (stitched[j - 1] ? softDistance(stitched[j - 1], stitched[j]) : 0) +
                    (stitched[j + 1] ? softDistance(stitched[j], stitched[j + 1]) : 0);

                // Калі адзін з трэкаў у зоне перастаноўкі — пустышка, мы АБАВЯЗАНЫ рабіць разлік
                const isKeylessInvolved = stitched[i]._isKeyless || stitched[j]._isKeyless || 
                                          (stitched[i-1] && stitched[i-1]._isKeyless) ||
                                          (stitched[j+1] && stitched[j+1]._isKeyless);

                if (localCostJ < GOOD_PAIR && !isKeylessInvolved) continue;
                
                // 4. Даем пустышкам свабоду перамяшчэння, а звычайныя трэкі трымаем у аброці
                const dTempoLocal = Math.abs(stitched[i]._nTempo - stitched[j]._nTempo);
                const isFarJump = (j - i) > 6;
                if (dTempoLocal < 0.05 && isFarJump && !isKeylessInvolved) continue;

                const temp = stitched.slice();
                [temp[i], temp[j]] = [temp[j], temp[i]];

                const costBefore =
                    pairCost(stitched[i - 1] || null, stitched[i] || null,
                             stitched[j - 1] || null, stitched[j] || null) +
                    pairCost(stitched[i] || null, stitched[i + 1] || null,
                             stitched[j] || null, stitched[j + 1] || null);

                const costAfter =
                    pairCost(temp[i - 1] || null, temp[i] || null,
                             temp[j - 1] || null, temp[j] || null) +
                    pairCost(temp[i] || null, temp[i + 1] || null,
                             temp[j] || null, temp[j + 1] || null);

                const gain = costBefore - costAfter;

                // --- убудаваная абарона ад нуля і малога costBefore ---
                if (costBefore > 1e-6 &&
                    gain > MIN_DELTA &&
                    (gain / costBefore) > REL_GAIN) {
                    stitched = temp;
                    improved = true;
                }
            }
        }

        if (!improved) break;
    }
    
    // --- Узмоцнены кантэкстны пост-пас для keyless трэкаў ---
    // Мэта: захаваць MIN_GAP_KEYLESS, плыўнае ўбудаванне па BPM, не ламаць сцэнарый Б
    const MIN_GAP_KEYLESS = 2;    // мінімум трэкаў з ключом паміж пустышкамі
    const MAX_BPM_DIFF = 8;        // макс. дапушчальнае адрозненне BPM для суседства
    const MAX_SHIFT = 6;           // максімальны зрух пустышкі (толькі лакальна)

    for (let i = 0; i < stitched.length; i++) {
        if (!stitched[i]._isKeyless) continue;

        let lastKeylessIdx = i;

        for (let j = i + 1; j < stitched.length; j++) {
            if (!stitched[j]._isKeyless) continue;

            const gap = j - lastKeylessIdx - 1;

            if (gap < MIN_GAP_KEYLESS) {

                // --- Збіраем кандыдатаў для перамяшчэння ---
                let candidates = [];
                for (let k = Math.max(lastKeylessIdx + 1, j - MAX_SHIFT); k <= Math.min(stitched.length - 1, j + MAX_SHIFT); k++) {
                    const cand = stitched[k];
                    if (!cand._isKeyless) {
                        const tempoDiff = Math.abs((cand._rawTempo || 120) - (stitched[j]._rawTempo || 120));
                        if (tempoDiff <= MAX_BPM_DIFF) {
                            candidates.push({ idx: k, tempoDiff });
                        }
                    }
                }

                if (candidates.length > 0) {
                    // --- Выбіраем бліжэйшага па BPM, калі некалькі кандыдатаў, прыярытэт бліжэй да j ---
                    candidates.sort((a, b) => {
                        const distA = Math.abs(a.idx - j);
                        const distB = Math.abs(b.idx - j);
                        return (distA + a.tempoDiff / 10) - (distB + b.tempoDiff / 10);
                    });

                    const targetIdx = candidates[0].idx;

                    // --- Перастаноўка пустышкі ---
                    const tmp = stitched[j];
                    if (targetIdx > j) {
                        for (let m = j; m < targetIdx; m++) stitched[m] = stitched[m + 1];
                        stitched[targetIdx] = tmp;
                    } else if (targetIdx < j) {
                        for (let m = j; m > targetIdx; m--) stitched[m] = stitched[m - 1];
                        stitched[targetIdx] = tmp;
                    }

                    j = targetIdx; // абнаўляем індэкс пасля перастаноўкі
                }
            }

            lastKeylessIdx = j;
        }
    }

    console.log(`✅ sortBalancedWave вынік: ${stitched.length} трэкаў адсартавана`);

    return stitched;
};
