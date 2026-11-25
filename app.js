(() => {
  "use strict";

  const STORAGE_REGION = "eatwhere-region";
  const STORAGE_PREFS = "eatwhere-prefs:";
  const EARTH_KM = 6371;
  const MEAL_LABELS = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", night: "宵夜" };
  const WEATHER_MAP = {
    0: ["☀️", "晴朗"],
    1: ["🌤️", "大致晴朗"],
    2: ["⛅", "多雲"],
    3: ["☁️", "陰天"],
    45: ["🌫️", "有霧"],
    48: ["🌫️", "霧"],
    51: ["🌦️", "毛毛雨"],
    53: ["🌦️", "毛毛雨"],
    55: ["🌦️", "毛毛雨"],
    61: ["🌧️", "小雨"],
    63: ["🌧️", "下雨"],
    65: ["🌧️", "大雨"],
    71: ["❄️", "飄雪"],
    73: ["❄️", "下雪"],
    75: ["❄️", "大雪"],
    80: ["🌧️", "陣雨"],
    81: ["🌧️", "陣雨"],
    82: ["🌧️", "強陣雨"],
    85: ["❄️", "陣雪"],
    86: ["❄️", "陣雪"],
    95: ["⛈️", "雷雨"],
    96: ["⛈️", "雷雨夾冰雹"],
    99: ["⛈️", "雷雨夾冰雹"]
  };

  const state = {
    catalog: null,
    region: null,
    shops: [],
    origin: null,
    weather: { ok: false, rain: false, hot: false, cold: false, text: "" },
    mode: "quiz",
    meal: "lunch",
    step: 0,
    answers: defaultAnswers(),
    lastShown: [],
    relaxed: false
  };

  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  function defaultAnswers() {
    return {
      meal: "lunch",
      persona: "",
      approach: "",
      mood: "",
      hunger: "",
      flavors: [],
      staple: "any",
      temp: "any",
      time: "ok",
      party: "alone",
      likes: [],
      dislikes: []
    };
  }

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function travelMinutes(km, speedKmh) {
    return Math.max(1, Math.round((km / speedKmh) * 60));
  }

  function unique(arr) {
    return [...new Set(arr)];
  }

  function has(list, value) {
    return Array.isArray(list) && list.includes(value);
  }

  function intersects(a, b) {
    if (!a || !b) return [];
    return a.filter((x) => b.includes(x));
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(message, ms = 4200) {
    const el = $("coming-soon");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, ms);
  }

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error("讀取失敗：" + path);
    return res.json();
  }

  function savedRegionId(catalog) {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get("region");
    const fromHash = location.hash.replace(/^#/, "");
    const saved = localStorage.getItem(STORAGE_REGION);
    const wanted = fromQuery || (catalog.regions.some((r) => r.id === fromHash) ? fromHash : "") || saved || catalog.defaultRegion;
    const found = catalog.regions.find((r) => r.id === wanted && r.enabled !== false && !r.comingSoon);
    return found ? found.id : catalog.defaultRegion;
  }

  function applyDistances() {
    const origin = state.origin;
    const travel = state.region.travel;
    state.shops.forEach((shop) => {
      if (typeof shop.lat !== "number" || typeof shop.lon !== "number") {
        shop.distanceKm = Infinity;
        shop.travelMinutes = Infinity;
        shop.inRange = false;
        return;
      }
      shop.distanceKm = haversineKm(origin.lat, origin.lon, shop.lat, shop.lon);
      shop.travelMinutes = travelMinutes(shop.distanceKm, travel.speedKmh);
      shop.inRange = shop.distanceKm <= travel.radiusKm && shop.travelMinutes <= travel.maxMinutes;
    });
  }

  function setOrigin(origin) {
    state.origin = origin;
    applyDistances();
    renderOrigin();
    if (state.mode === "list") renderList();
    if (!$("recommendations").hidden) showRecommendations(false);
  }

  function fixedOrigin(region) {
    return {
      lat: region.origin.lat,
      lon: region.origin.lon,
      label: region.origin.label || region.locationLabel,
      source: "fixed"
    };
  }

  function renderOrigin() {
    const region = state.region;
    const travel = region.travel;
    const origin = state.origin;
    $("origin-status").textContent = `以${origin.label}為中心 · ${travel.label} ${travel.maxMinutes} 分鐘內（約 ${travel.radiusKm} 公里）`;
    const needsLive = region.origin.mode === "geolocation";
    $("origin-controls").hidden = !needsLive;
    $("district-wrap").hidden = !(needsLive && (region.districts || []).length);
  }

  function locate() {
    if (!navigator.geolocation) {
      toast("這個瀏覽器沒有定位功能，請改用手動選區。");
      return;
    }
    $("origin-status").textContent = "正在取得目前位置…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "目前位置",
          source: "geolocation"
        });
        toast("已改用你現在的位置重新計算距離。");
      },
      () => {
        renderOrigin();
        toast("定位沒成功。你可以手動選區，或繼續用預設中心。");
        if ((state.region.districts || []).length) $("district-wrap").hidden = false;
        $("origin-controls").hidden = false;
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }

  function chooseDistrict() {
    const id = $("district").value;
    const district = (state.region.districts || []).find((d) => d.id === id);
    if (!district) return;
    setOrigin({
      lat: district.lat,
      lon: district.lon,
      label: district.name,
      source: "manual_district"
    });
  }

  function weatherText(code, current) {
    const [icon, label] = WEATHER_MAP[code] || ["⛅", "天氣"];
    const temp = Math.round(current.temperature_2m);
    const feel = Math.round(current.apparent_temperature);
    const rain = current.precipitation > 0 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code);
    let extra = `${temp}°C，體感 ${feel}°C`;
    if (rain) extra += "，有雨";
    return { icon, text: `${label}，${extra}`, rain, hot: feel >= 28, cold: feel <= 18 };
  }

  async function loadWeather(region) {
    const card = $("weather-card");
    const label = region.weather?.label || `${region.name}現在的天氣`;
    $("weather-label").textContent = label;
    $("weather").textContent = "正在讀取天氣…";
    card.classList.remove("is-fail");
    const lat = region.weather?.lat ?? region.origin.lat ?? region.center?.lat;
    const lon = region.weather?.lon ?? region.origin.lon ?? region.center?.lon;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FTaipei`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("weather http");
      const data = await res.json();
      const parsed = weatherText(data.current.weather_code, data.current);
      state.weather = { ok: true, ...parsed };
      $("weather-icon").textContent = parsed.icon;
      $("weather").textContent = parsed.text;
    } catch {
      clearTimeout(timer);
      state.weather = { ok: false, rain: false, hot: false, cold: false, text: "" };
      card.classList.add("is-fail");
      $("weather-icon").textContent = "⛅";
      $("weather").textContent = "暫時讀不到天氣，先依你的心情推薦";
    }
  }

  function categoryList() {
    const counts = new Map();
    state.shops.forEach((s) => (s.categories || []).forEach((c) => counts.set(c, (counts.get(c) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"));
  }

  function renderRegionBar() {
    const bar = $("region-bar");
    bar.innerHTML = "";
    state.catalog.regions.forEach((region) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.region = region.id;
      const soon = region.comingSoon || region.enabled === false;
      btn.className = soon ? "is-soon" : "";
      btn.setAttribute("aria-pressed", String(region.id === state.region.id));
      btn.innerHTML = escapeHtml(region.name) + (soon ? "<small>即將推出</small>" : "");
      btn.addEventListener("click", () => {
        if (soon) {
          toast(region.comingSoonNote || `${region.name}版即將推出，之後可用定位篩選${region.travel?.label || ""}約 ${region.travel?.maxMinutes || ""} 分鐘內的店。`);
          return;
        }
        if (region.id !== state.region.id) switchRegion(region.id);
      });
      bar.appendChild(btn);
    });
  }

  function renderDistanceOptions() {
    const select = $("distance");
    const radius = state.region.travel.radiusKm;
    const steps = unique([1, 2, 3, 4, 5, 6, 8, 10].filter((n) => n <= radius).concat([radius]));
    select.innerHTML = steps
      .map((n) => `<option value="${n}"${n === radius ? " selected" : ""}>${n} 公里</option>`)
      .join("");
  }

  function renderCategoryChips() {
    $("categories").innerHTML = categoryList()
      .map(
        ([name, count]) =>
          `<label class="chip"><input type="checkbox" name="category" value="${escapeHtml(name)}"> ${escapeHtml(name)} <small>${count}</small></label>`
      )
      .join("");
    qsa("#categories input").forEach((input) => {
      input.addEventListener("change", () => {
        input.closest(".chip").classList.toggle("selected", input.checked);
        renderList();
      });
    });
  }

  function renderMealFilter() {
    const meals = state.region.meals || ["lunch"];
    const wrap = $("meal-filter");
    wrap.hidden = meals.length <= 1;
    $("meals").innerHTML = meals
      .map(
        (m) =>
          `<label class="chip${m === state.meal ? " selected" : ""}"><input type="radio" name="meal" value="${m}"${m === state.meal ? " checked" : ""}> ${MEAL_LABELS[m] || m}</label>`
      )
      .join("");
    qsa("#meals input").forEach((input) => {
      input.addEventListener("change", () => {
        state.meal = input.value;
        qsa("#meals .chip").forEach((c) => c.classList.toggle("selected", qs("input", c).checked));
        updateOpenLabel();
        renderList();
      });
    });
    updateOpenLabel();
  }

  function updateOpenLabel() {
    const label = MEAL_LABELS[state.meal] || "這個時段";
    $("open-label").textContent = `僅看${label}通常有開`;
  }

  function renderChrome() {
    const region = state.region;
    document.title = region.title || `${region.name}吃什麼`;
    $("location-label").textContent = "⌖　" + region.locationLabel;
    $("title-lead").textContent = region.titleLead || region.name;
    $("subtitle").textContent = region.subtitle;
    $("weather-label").textContent = region.weather?.label || `${region.name}現在的天氣`;
    renderRegionBar();
    renderOrigin();
    renderDistanceOptions();
    renderCategoryChips();
    renderMealFilter();
  }

  function attachShopMetrics(raw) {
    return raw
      .filter((s) => typeof s.lat === "number" && typeof s.lon === "number")
      .map((s) => ({
        ...s,
        flavors: s.flavors || [],
        portion: s.portion || [],
        speed: s.speed || [],
        temps: s.temps || [],
        meal_types: s.meal_types || [],
        party: s.party || [],
        meals: s.meals || [],
        categories: s.categories || [],
        distanceKm: 0,
        travelMinutes: 0,
        inRange: false
      }));
  }

  async function switchRegion(id) {
    const region = state.catalog.regions.find((r) => r.id === id);
    if (!region || region.comingSoon || region.enabled === false) return;
    $("loading").hidden = false;
    $("quiz").hidden = true;
    $("list").hidden = true;
    try {
      const data = await loadJson(region.dataFile);
      state.region = region;
      state.shops = attachShopMetrics(data.restaurants || []);
      state.meal = (region.meals && region.meals[0]) || "lunch";
      state.answers = loadPrefs(region.id);
      state.answers.meal = state.meal;
      state.lastShown = [];
      state.step = 0;
      localStorage.setItem(STORAGE_REGION, region.id);
      const startOrigin = {
        lat: region.origin.lat ?? region.weather?.lat ?? region.center?.lat,
        lon: region.origin.lon ?? region.weather?.lon ?? region.center?.lon,
        label: region.origin.mode === "fixed"
          ? (region.origin.label || region.locationLabel)
          : (region.origin.label || "預設中心（尚未定位）"),
        source: region.origin.mode === "fixed" ? "fixed" : "fallback"
      };
      setOrigin(startOrigin);
      renderChrome();
      loadWeather(region);
      $("loading").hidden = true;
      showMode(state.mode);
      resetQuizView();
    } catch (err) {
      $("loading").textContent = "店家資料讀取失敗，請稍後再重新整理。";
      console.error(err);
    }
  }

  function loadPrefs(regionId) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFS + regionId);
      if (!raw) return defaultAnswers();
      return { ...defaultAnswers(), ...JSON.parse(raw) };
    } catch {
      return defaultAnswers();
    }
  }

  function savePrefs() {
    localStorage.setItem(STORAGE_PREFS + state.region.id, JSON.stringify(state.answers));
  }

  const STEPS = [
    {
      id: "persona",
      title: "先用兩個小問題認識今天的你",
      description: "沒有標準答案，選最接近現在心情的就好。",
      fields: ["persona", "approach"]
    },
    {
      id: "mood",
      title: "現在的心情和肚子",
      description: "這會決定要不要選份量較大、或是清爽一點的店。",
      fields: ["mood", "hunger"]
    },
    {
      id: "taste",
      title: "想吃什麼味道？",
      description: "口味可以多選。不確定就先不選，我們再依心情和天氣幫你挑。",
      fields: ["flavors", "staple", "temp"]
    },
    {
      id: "context",
      title: "時間和人數",
      description: "趕時間會優先推薦較近、出餐快的店。",
      fields: ["time", "party"]
    },
    {
      id: "prefs",
      title: "有特別想吃或不想吃的嗎？",
      description: "都可以跳過。不想吃的種類會盡量避開。",
      fields: ["likes", "dislikes"],
      optional: true
    }
  ];

  const QUESTIONS = {
    persona: {
      title: "今天的你比較像？",
      type: "single",
      options: [
        { id: "hamster", label: "趕報告的倉鼠", hint: "時間很緊，想快一點解決" },
        { id: "cat", label: "想吹風的貓", hint: "想吃清爽、不要太負擔" },
        { id: "macaron", label: "需要充電的馬卡龍", hint: "想吃甜的、犒賞一下" },
        { id: "chili", label: "準備開砲的辣椒", hint: "想吃辣的或重口味" }
      ]
    },
    approach: {
      title: "走到校門口，你會先？",
      type: "single",
      options: [
        { id: "weather", label: "先抬頭看天氣", hint: "熱、冷、下雨都會影響選擇" },
        { id: "belly", label: "跟著肚子走", hint: "餓了就聽身體的" },
        { id: "rating", label: "先滑評價", hint: "想找口碑比較穩的" },
        { id: "near", label: "找最近的就好", hint: "不想跑太遠" }
      ]
    },
    mood: {
      title: "現在的心情比較接近？",
      type: "single",
      options: [
        { id: "happy", label: "開心想犒賞" },
        { id: "tired", label: "好累，只想被好好對待" },
        { id: "stressed", label: "有點煩，想吃暢快一點的" },
        { id: "chill", label: "平常心，想慢慢吃" },
        { id: "sad", label: "有點悶，想被甜的或熱的安慰" }
      ]
    },
    hunger: {
      title: "飢餓程度",
      type: "single",
      options: [
        { id: "light", label: "小餓", hint: "墊墊胃就好" },
        { id: "normal", label: "普通", hint: "正常一餐" },
        { id: "hungry", label: "很餓", hint: "要能吃飽" },
        { id: "starving", label: "餓爆", hint: "請給我份量大的" }
      ]
    },
    flavors: {
      title: "想吃的口味（可多選）",
      type: "multi",
      options: [
        { id: "清淡", label: "清淡" },
        { id: "重鹹", label: "重鹹" },
        { id: "辣", label: "辣" },
        { id: "甜", label: "甜" },
        { id: "酸", label: "酸" },
        { id: "炸物", label: "炸物" },
        { id: "湯湯水水", label: "湯湯水水" }
      ]
    },
    staple: {
      title: "比較想吃飯還是麵？",
      type: "single",
      options: [
        { id: "飯", label: "吃飯" },
        { id: "麵", label: "吃麵" },
        { id: "any", label: "都可以／其他也行" }
      ]
    },
    temp: {
      title: "想吃熱的還是冰的？",
      type: "single",
      options: [
        { id: "熱", label: "想吃熱的" },
        { id: "冷", label: "想吃冰的或喝冷的" },
        { id: "any", label: "都可以" }
      ]
    },
    time: {
      title: "午餐時間夠不夠？",
      type: "single",
      options: [
        { id: "rush", label: "趕時間", hint: "優先近的、出餐快的" },
        { id: "ok", label: "還可以", hint: "普通節奏" },
        { id: "plenty", label: "很充裕", hint: "可以慢慢挑、慢慢等" }
      ]
    },
    party: {
      title: "幾個人吃？",
      type: "single",
      options: [
        { id: "alone", label: "一個人" },
        { id: "friends", label: "跟同學或朋友" }
      ]
    },
    likes: { title: "有特別想吃的種類嗎？（可多選，可跳過）", type: "categories", key: "likes" },
    dislikes: { title: "有不想吃的種類嗎？（可多選，可跳過）", type: "categories", key: "dislikes" }
  };

  function renderQuizStep() {
    const step = STEPS[state.step];
    $("quiz-form").hidden = false;
    $("recommendations").hidden = true;
    $("step-count").textContent = `第 ${state.step + 1} / ${STEPS.length} 題`;
    $("step-title").textContent = step.title;
    $("step-description").textContent = step.description;
    $("progress").max = STEPS.length;
    $("progress").value = state.step + 1;
    $("back").hidden = state.step === 0;
    $("next").textContent = state.step === STEPS.length - 1 ? "幫我決定 →" : "下一步 →";
    $("quiz-questions").innerHTML = step.fields.map((field) => renderQuestion(field)).join("");
    bindQuestionInputs();
    $("step-title").focus();
  }

  function renderQuestion(field) {
    const q = QUESTIONS[field];
    if (q.type === "categories") {
      const selected = new Set(state.answers[q.key] || []);
      const chips = categoryList()
        .map(([name]) => {
          const on = selected.has(name);
          return `<label class="chip${on ? " selected" : ""}"><input type="checkbox" data-multi="${q.key}" value="${escapeHtml(name)}"${on ? " checked" : ""}> ${escapeHtml(name)}</label>`;
        })
        .join("");
      return `<div class="question" data-field="${field}"><h3>${escapeHtml(q.title)}</h3><div class="chips">${chips}</div></div>`;
    }
    if (q.type === "multi") {
      const selected = new Set(state.answers[field] || []);
      const chips = q.options
        .map((opt) => {
          const on = selected.has(opt.id);
          return `<label class="chip${on ? " selected" : ""}"><input type="checkbox" data-multi="${field}" value="${escapeHtml(opt.id)}"${on ? " checked" : ""}> ${escapeHtml(opt.label)}</label>`;
        })
        .join("");
      return `<div class="question" data-field="${field}"><h3>${escapeHtml(q.title)}</h3><div class="chips">${chips}</div></div>`;
    }
    const options = q.options
      .map((opt) => {
        const on = state.answers[field] === opt.id;
        return `<button type="button" class="option" data-single="${field}" data-value="${escapeHtml(opt.id)}" aria-pressed="${on}">${escapeHtml(opt.label)}${opt.hint ? `<small>${escapeHtml(opt.hint)}</small>` : ""}</button>`;
      })
      .join("");
    return `<div class="question" data-field="${field}"><h3>${escapeHtml(q.title)}</h3><div class="options">${options}</div></div>`;
  }

  function bindQuestionInputs() {
    qsa("[data-single]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = btn.dataset.single;
        state.answers[field] = btn.dataset.value;
        qsa(`[data-single="${field}"]`).forEach((other) => other.setAttribute("aria-pressed", String(other === btn)));
        const err = qs(".quiz-error");
        if (err) err.remove();
      });
    });
    qsa("[data-multi]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.multi;
        const values = qsa(`[data-multi="${key}"]`).filter((i) => i.checked).map((i) => i.value);
        state.answers[key] = values;
        input.closest(".chip").classList.toggle("selected", input.checked);
      });
    });
  }

  function validateStep() {
    const step = STEPS[state.step];
    if (step.optional) return true;
    const missing = step.fields.filter((field) => {
      const q = QUESTIONS[field];
      if (q.type === "multi" || q.type === "categories") return false;
      return !state.answers[field];
    });
    if (!missing.length) return true;
    const box = $("quiz-questions");
    if (!qs(".quiz-error", box)) {
      const p = document.createElement("p");
      p.className = "quiz-error";
      p.textContent = "還有題目還沒選完喔。";
      box.appendChild(p);
    }
    const first = missing[0];
    const target = qs(`[data-single="${first}"], [data-field="${first}"]`);
    if (target) target.focus?.() || qs("h3", target)?.scrollIntoView({ block: "center" });
    return false;
  }

  function resetQuizView() {
    state.step = 0;
    renderQuizStep();
  }

  function serveMeal(shop, meal) {
    if (!meal) return true;
    if (Array.isArray(shop.meals) && shop.meals.includes(meal)) return true;
    if (meal === "lunch") return shop.open_at_lunch === true || shop.open_at_lunch === "weekend_only" || shop.open_at_lunch == null;
    return !shop.meals || shop.meals.length === 0;
  }

  function lunchOpenToday(shop) {
    if (shop.open_at_lunch === true) return true;
    if (shop.open_at_lunch === false) return false;
    if (shop.open_at_lunch === "weekend_only") {
      const day = new Date().getDay();
      return day === 0 || day === 6;
    }
    return null;
  }

  function scoreShop(shop, answers, weather, relaxed) {
    let score = 0;
    const reasons = [];
    const mins = shop.travelMinutes;
    const travelLabel = state.region.travel.label;
    const flavors = answers.flavors || [];
    const overlap = intersects(flavors, shop.flavors);

    if (answers.time === "rush") {
      if (mins <= 3) {
        score += 18;
        reasons.push("很近，趕時間也來得及");
      } else if (mins <= 6) score += 8;
      else score -= 10;
      if (has(shop.speed, "快速")) {
        score += 10;
        reasons.push("出餐比較快");
      }
      if (has(shop.speed, "需等待") && !has(shop.speed, "快速")) score -= 8;
    } else if (answers.time === "plenty") {
      if (has(shop.speed, "需等待")) score += 3;
      if (mins <= 8) score += 4;
    } else if (mins <= 5) {
      score += 8;
      reasons.push(`${travelLabel}約 ${mins} 分鐘`);
    } else if (mins <= 8) score += 3;

    if (overlap.length) {
      score += overlap.length * 8;
      reasons.push(`符合你想吃的「${overlap.slice(0, 3).join("、")}」`);
    }

    if (answers.hunger === "light") {
      if (has(shop.portion, "小") || shop.categories.some((c) => ["飲料", "甜點", "豆花剉冰", "咖啡廳", "麵包烘焙", "蛋糕"].includes(c))) {
        score += 8;
        reasons.push("小餓剛好墊墊胃");
      }
      if (has(shop.portion, "超大") && !has(shop.portion, "小")) score -= 4;
    }
    if (answers.hunger === "hungry" && (has(shop.portion, "大") || has(shop.portion, "超大"))) {
      score += 10;
      reasons.push("份量比較能吃飽");
    }
    if (answers.hunger === "starving") {
      if (has(shop.portion, "超大") || has(shop.portion, "大") || shop.categories.some((c) => ["便當", "火鍋", "麵食", "中式"].includes(c))) {
        score += 14;
        reasons.push("餓爆就吃能飽的");
      }
      if (shop.categories.every((c) => ["飲料", "甜點", "咖啡廳", "蛋糕", "麵包烘焙"].includes(c))) score -= 12;
    }

    if (answers.staple === "飯" && (has(shop.meal_types, "飯") || shop.categories.some((c) => ["便當", "中式", "日式", "韓式", "早午餐"].includes(c)))) {
      score += 10;
      reasons.push("想吃飯的話很適合");
    }
    if (answers.staple === "麵" && (has(shop.meal_types, "麵") || shop.categories.includes("麵食"))) {
      score += 10;
      reasons.push("想吃麵的話很適合");
    }

    if (answers.temp === "熱" && has(shop.temps, "熱") && (has(shop.flavors, "湯湯水水") || shop.categories.some((c) => ["火鍋", "滷味", "麵食", "便當"].includes(c)))) {
      score += 8;
      reasons.push("想吃熱的");
    }
    if (answers.temp === "冷" && (has(shop.temps, "冷") || shop.categories.some((c) => ["飲料", "豆花剉冰", "甜點"].includes(c)))) {
      score += 8;
      reasons.push("想吃冰的或喝冷的");
    }

    if (answers.mood === "happy" && (has(shop.flavors, "甜") || shop.rating >= 4.3)) {
      score += 6;
      if (has(shop.flavors, "甜")) reasons.push("開心就犒賞一點甜的");
    }
    if (answers.mood === "tired") {
      if (mins <= 5 || has(shop.speed, "快速") || shop.categories.includes("便當")) {
        score += 8;
        reasons.push("累的時候選省事一點的");
      }
      if (has(shop.flavors, "湯湯水水")) score += 4;
    }
    if (answers.mood === "stressed" && (has(shop.flavors, "辣") || has(shop.flavors, "炸物") || has(shop.flavors, "重鹹"))) {
      score += 8;
      reasons.push("想吃暢快一點的重口味");
    }
    if (answers.mood === "chill" && shop.categories.some((c) => ["咖啡廳", "甜點", "火鍋"].includes(c))) {
      score += 6;
      reasons.push("適合慢慢吃");
    }
    if (answers.mood === "sad" && (has(shop.flavors, "甜") || has(shop.flavors, "湯湯水水"))) {
      score += 8;
      reasons.push("甜的或熱湯比較能安慰一下");
    }

    if (answers.persona === "hamster") {
      if (mins <= 4) score += 8;
      if (has(shop.speed, "快速")) score += 6;
    }
    if (answers.persona === "cat" && (has(shop.flavors, "清淡") || shop.categories.some((c) => ["豆花剉冰", "咖啡廳", "甜點"].includes(c)))) {
      score += 8;
      reasons.push("清爽一點，負擔比較小");
    }
    if (answers.persona === "macaron" && has(shop.flavors, "甜")) {
      score += 10;
      reasons.push("來點甜的充充電");
    }
    if (answers.persona === "chili" && (has(shop.flavors, "辣") || has(shop.flavors, "重鹹"))) {
      score += 10;
      reasons.push("重口味來了");
    }

    if (answers.approach === "weather" && weather.ok) score += 2;
    if (answers.approach === "belly" && (answers.hunger === "hungry" || answers.hunger === "starving") && (has(shop.portion, "大") || has(shop.portion, "超大"))) score += 6;
    if (answers.approach === "rating" && shop.rating >= 4.3 && (shop.review_count || 0) >= 10) {
      score += 10;
      reasons.push(`Google ${shop.rating} 星`);
    }
    if (answers.approach === "near" && mins <= 4) {
      score += 10;
      reasons.push("離你很近");
    }

    if (weather.ok && weather.rain) {
      if (mins <= 4) {
        score += 10;
        reasons.push("下雨就選近一點的");
      } else if (mins >= 8) score -= 6;
      if (has(shop.flavors, "湯湯水水") || shop.categories.some((c) => ["火鍋", "咖啡廳", "滷味"].includes(c))) {
        score += 8;
        reasons.push("下雨天適合喝熱的、待室內");
      }
    }
    if (weather.ok && weather.hot) {
      if (shop.categories.some((c) => ["豆花剉冰", "飲料", "甜點"].includes(c)) || has(shop.temps, "冷")) {
        score += 8;
        reasons.push("天氣熱來點冰的");
      }
      if (shop.categories.includes("火鍋")) score -= 5;
    }
    if (weather.ok && weather.cold) {
      if (shop.categories.includes("火鍋") || has(shop.flavors, "湯湯水水") || shop.categories.includes("滷味")) {
        score += 10;
        reasons.push("天氣涼，吃熱的最對味");
      }
    }

    if ((answers.likes || []).some((c) => shop.categories.includes(c))) {
      score += 14;
      reasons.push("是你喜歡的種類");
    }
    const disliked = (answers.dislikes || []).some((c) => shop.categories.includes(c));
    if (disliked) score -= relaxed ? 8 : 28;

    if (shop.rating >= 4.5 && (shop.review_count || 0) >= 20) {
      score += 10;
      if (!reasons.some((r) => r.includes("星"))) reasons.push(`Google ${shop.rating} 星`);
    } else if (shop.rating >= 4) score += 6;
    else if (shop.rating && shop.rating < 3.5) score -= 4;

    const meal = answers.meal || state.meal;
    if (meal === "lunch") {
      const open = lunchOpenToday(shop);
      if (open === true) score += 6;
      if (open === false) score -= relaxed ? 8 : 30;
    }

    if (answers.party === "friends" && (has(shop.party, "適合多人") || shop.categories.some((c) => ["火鍋", "韓式", "美式"].includes(c)))) {
      score += 8;
      reasons.push("適合跟朋友一起吃");
    }
    if (answers.party === "alone" && has(shop.party, "適合一人")) score += 2;

    return { score, reasons: unique(reasons).slice(0, 3), disliked };
  }

  function candidateShops(relaxed) {
    const answers = state.answers;
    const meal = answers.meal || state.meal;
    return state.shops.filter((shop) => {
      if (!shop.inRange && !relaxed) return false;
      if (relaxed && shop.distanceKm > state.region.travel.radiusKm * 1.15) return false;
      if (!serveMeal(shop, meal) && !relaxed) return false;
      if (!relaxed && (answers.dislikes || []).some((c) => shop.categories.includes(c))) return false;
      if (!relaxed && meal === "lunch" && lunchOpenToday(shop) === false) return false;
      return true;
    });
  }

  function rankShops(relaxed) {
    return candidateShops(relaxed)
      .map((shop) => ({ shop, ...scoreShop(shop, state.answers, state.weather, relaxed) }))
      .sort((a, b) => b.score - a.score || a.shop.distanceKm - b.shop.distanceKm);
  }

  function pickThree(ranked, excludeIds) {
    const excluded = new Set(excludeIds || []);
    let pool = ranked.filter((x) => !excluded.has(x.shop.id));
    if (pool.length < 3) pool = ranked.slice();
    const top = pool.slice(0, Math.min(12, pool.length));
    if (top.length <= 3) return top;
    const picked = [];
    const bag = top.slice();
    while (picked.length < 3 && bag.length) {
      const weights = bag.map((x, i) => Math.max(1, (bag.length - i) * 3 + Math.max(0, x.score)));
      const total = weights.reduce((s, w) => s + w, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < bag.length; idx++) {
        r -= weights[idx];
        if (r <= 0) break;
      }
      picked.push(bag.splice(Math.min(idx, bag.length - 1), 1)[0]);
    }
    return picked.sort((a, b) => b.score - a.score);
  }

  function recommend(reroll) {
    let ranked = rankShops(false);
    let relaxed = false;
    if (ranked.length < 3) {
      ranked = rankShops(true);
      relaxed = ranked.length > 0;
    }
    state.relaxed = relaxed;
    const picked = pickThree(ranked, reroll ? state.lastShown : []);
    state.lastShown = picked.map((x) => x.shop.id);
    return picked;
  }

  function formatDistance(shop) {
    const km = shop.distanceKm;
    const kmText = km < 1 ? `${Math.round(km * 1000)} 公尺` : `${km.toFixed(1)} 公里`;
    return `${kmText} · ${state.region.travel.label}約 ${shop.travelMinutes} 分鐘`;
  }

  function shopCard(entry, rank) {
    const shop = entry.shop || entry;
    const reasons = entry.reasons || [];
    const rating =
      shop.rating != null
        ? `★ ${shop.rating}${shop.review_count != null ? `（${shop.review_count} 則）` : ""}`
        : "尚無評分";
    const cats = (shop.categories || []).map((c) => `<span>${escapeHtml(c)}</span>`).join("");
    const tags = unique([...(shop.flavors || []), ...(shop.portion || []).map((p) => `份量${p}`), ...(shop.speed || [])])
      .slice(0, 6)
      .map((t) => `<span>${escapeHtml(t)}</span>`)
      .join("");
    const hours = shop.hours ? `<p class="detail">營業：${escapeHtml(shop.hours)}</p>` : "";
    const note = shop.hours_note ? `<p class="hours-note">${escapeHtml(shop.hours_note)}</p>` : "";
    const why = reasons.length
      ? `<ul class="reasons">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
      : "";
    const rankBadge = rank ? `<span class="rank">推薦 ${rank}</span>` : "";
    const maps = shop.maps_url
      ? `<a class="map" href="${escapeHtml(shop.maps_url)}" target="_blank" rel="noopener noreferrer">在 Google 地圖開啟</a>`
      : "";
    return `<article class="card">
      ${rankBadge}
      <h3>${escapeHtml(shop.name)}</h3>
      <div class="badges">${cats}</div>
      <p class="stats">${escapeHtml(rating)}</p>
      <p class="detail">${escapeHtml(formatDistance(shop))}</p>
      <p class="detail">${escapeHtml(shop.address || "")}</p>
      ${hours}${note}
      <div class="badges tags">${tags}</div>
      ${why}
      ${maps}
    </article>`;
  }

  function showRecommendations(reroll) {
    const picked = recommend(reroll);
    const mealName = MEAL_LABELS[state.answers.meal || state.meal] || "這一餐";
    $("quiz-form").hidden = true;
    $("recommendations").hidden = false;
    $("result-title").textContent = picked.length ? `今天就吃這${picked.length === 3 ? "三" : picked.length}家` : "這邊暫時找不到合適的店";
    const relaxed = $("relaxed");
    if (!picked.length) {
      relaxed.hidden = false;
      relaxed.textContent = "目前的條件下沒有合適的店，試試改答案，或改到「自己找」看完整清單。";
      $("result-cards").innerHTML = "";
    } else {
      relaxed.hidden = !state.relaxed;
      relaxed.textContent = state.relaxed ? "條件有點嚴，已稍微放寬再幫你挑。" : "";
      $("result-cards").innerHTML = picked.map((entry, i) => shopCard(entry, i + 1)).join("");
    }
    $("reroll-status").textContent = reroll ? `已再抽一次${mealName}提案。` : `已依你的答案排出${mealName}提案。`;
    $("result-title").focus();
  }

  function listFilters() {
    const q = $("search").value.trim().toLowerCase();
    const cats = qsa("#categories input:checked").map((i) => i.value);
    const minRating = $("rating").value ? Number($("rating").value) : 0;
    const maxKm = Number($("distance").value) || state.region.travel.radiusKm;
    const onlyOpen = $("open-now").checked;
    const meal = state.meal;
    return state.shops.filter((shop) => {
      if (!shop.inRange && shop.distanceKm > maxKm) return false;
      if (shop.distanceKm > maxKm) return false;
      if (q && !shop.name.toLowerCase().includes(q) && !(shop.address || "").toLowerCase().includes(q)) return false;
      if (cats.length && !cats.some((c) => shop.categories.includes(c))) return false;
      if (minRating && !(shop.rating >= minRating)) return false;
      if (onlyOpen) {
        if (meal === "lunch" && lunchOpenToday(shop) !== true) return false;
        if (meal !== "lunch" && !serveMeal(shop, meal)) return false;
      }
      return true;
    });
  }

  function sortShops(list) {
    const mode = $("sort").value;
    const copy = list.slice();
    if (mode === "rating") copy.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.review_count || 0) - (a.review_count || 0) || a.distanceKm - b.distanceKm);
    else if (mode === "reviews") copy.sort((a, b) => (b.review_count || 0) - (a.review_count || 0) || (b.rating || 0) - (a.rating || 0));
    else if (mode === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    else copy.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name, "zh-Hant"));
    return copy;
  }

  function renderList() {
    const shops = sortShops(listFilters());
    $("count").textContent = shops.length ? `共 ${shops.length} 家` : "沒有符合的店";
    $("list-cards").innerHTML = shops.length
      ? shops.map((shop) => shopCard({ shop })).join("")
      : `<p class="empty">沒有符合目前篩選的店，試試放寬距離、種類或評分。</p>`;
  }

  function resetFilters() {
    $("search").value = "";
    $("rating").value = "";
    $("sort").value = "distance";
    $("open-now").checked = false;
    renderDistanceOptions();
    qsa("#categories input").forEach((i) => {
      i.checked = false;
      i.closest(".chip").classList.remove("selected");
    });
    renderList();
  }

  function showMode(mode) {
    state.mode = mode;
    qsa(".modes button").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode)));
    $("quiz").hidden = mode !== "quiz";
    $("list").hidden = mode !== "list";
    if (mode === "list") renderList();
  }

  function bindUi() {
    qsa(".modes button").forEach((btn) => btn.addEventListener("click", () => showMode(btn.dataset.mode)));
    $("quiz-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!validateStep()) return;
      if (state.step < STEPS.length - 1) {
        state.step += 1;
        renderQuizStep();
        return;
      }
      state.answers.meal = state.meal;
      savePrefs();
      showRecommendations(false);
    });
    $("back").addEventListener("click", () => {
      if (state.step > 0) {
        state.step -= 1;
        renderQuizStep();
      }
    });
    $("edit").addEventListener("click", () => {
      $("recommendations").hidden = true;
      $("quiz-form").hidden = false;
      state.step = STEPS.length - 1;
      renderQuizStep();
    });
    $("reroll").addEventListener("click", () => showRecommendations(true));
    ["search", "rating", "distance", "sort", "open-now"].forEach((id) => {
      const el = $(id);
      el.addEventListener(el.tagName === "INPUT" && el.type === "search" ? "input" : "change", renderList);
    });
    $("reset").addEventListener("click", resetFilters);
    $("locate").addEventListener("click", locate);
    $("district").addEventListener("change", chooseDistrict);
  }

  async function init() {
    bindUi();
    try {
      const catalog = await loadJson("data/regions.json");
      state.catalog = catalog;
      const startId = savedRegionId(catalog);
      await switchRegion(startId);
    } catch (err) {
      $("loading").textContent = "店家資料讀取失敗，請稍後再重新整理。";
      console.error(err);
    }
  }

  window.__eatwhere = {
    state,
    haversineKm,
    travelMinutes,
    scoreShop,
    recommend,
    listFilters
  };

  init();
})();
