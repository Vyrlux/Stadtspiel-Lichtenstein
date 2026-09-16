(() => {
  "use strict";

  const STORAGE_KEY = "stadtspiel-lichtenstein-v1";
  const TEAM_KEY = "stadtspiel-lichtenstein-team-v1";
  const stationNames = [
    "Kulturpalais", "Schloss", "Altmarkt", "Stadtbibliothek", "Stadtpark",
    "Neumarkt", "Zwischenstation", "Goldener Helm", "Athos", "Kino"
  ];
  const state = loadState();
  let team = loadTeam();
  const stages = [...document.querySelectorAll(".stage")];
  const progressBar = document.querySelector("#progress-bar");
  const progressLabel = document.querySelector("#progress-label");
  const progressCount = document.querySelector("#progress-count");
  const startQuiz = document.querySelector("#start-quiz");
  const modePanel = document.querySelector("#mode-panel");
  const teamPanel = document.querySelector("#team-panel");
  const teamBar = document.querySelector("#team-bar");
  let toastTimer;
  let pollTimer;
  let syncing = false;
  let pendingTeamStage = null;

  function defaultState() {
    return { stage: 0, mode: null, branch: null, visited: [0], muted: false };
  }

  function loadState() {
    try {
      return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadTeam() {
    try {
      const saved = JSON.parse(localStorage.getItem(TEAM_KEY) || "null");
      return saved?.code && saved?.memberId ? saved : null;
    } catch {
      return null;
    }
  }

  function saveTeam() {
    if (team) localStorage.setItem(TEAM_KEY, JSON.stringify(team));
    else localStorage.removeItem(TEAM_KEY);
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("de-DE")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  }

  function go(stageNumber, options = {}) {
    const target = Math.max(0, Math.min(9, Number(stageNumber)));
    stages.forEach((stage) => {
      const active = Number(stage.dataset.stage) === target;
      stage.classList.toggle("active", active);
      stage.setAttribute("aria-hidden", String(!active));
    });
    document.querySelectorAll("audio, video").forEach((media) => media.pause());
    state.stage = target;
    if (!state.visited.includes(target)) state.visited.push(target);
    saveState();
    progressLabel.textContent = stationNames[target];
    progressCount.textContent = `${target} / 9`;
    progressBar.style.width = `${(target / 9) * 100}%`;
    if (target === 6) renderBranch();
    renderGeo(stages[target]);
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: "smooth" });
    if (team && !options.remote) syncTeamState();
  }

  function encodeGeohash(latitude, longitude, precision = 7) {
    const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
    let latRange = [-90, 90];
    let lonRange = [-180, 180];
    let evenBit = true;
    let bit = 0;
    let value = 0;
    let hash = "";
    while (hash.length < precision) {
      const range = evenBit ? lonRange : latRange;
      const coordinate = evenBit ? longitude : latitude;
      const midpoint = (range[0] + range[1]) / 2;
      if (coordinate >= midpoint) {
        value = (value << 1) + 1;
        range[0] = midpoint;
      } else {
        value <<= 1;
        range[1] = midpoint;
      }
      evenBit = !evenBit;
      bit += 1;
      if (bit === 5) {
        hash += alphabet[value];
        bit = 0;
        value = 0;
      }
    }
    return hash;
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    const rad = (degrees) => degrees * Math.PI / 180;
    const earth = 6371000;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function renderGeo(stage) {
    const holder = stage?.querySelector(".geo-card");
    if (!holder) return;
    const lat = Number(stage.dataset.lat);
    const lon = Number(stage.dataset.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      holder.innerHTML = "";
      return;
    }
    const place = stage.dataset.place || "diese Station";
    const placeHash = encodeGeohash(lat, lon);
    const isDesktop = state.mode === "desktop";
    holder.innerHTML = `
      <div class="geo-inner">
        <div class="geo-copy"><span class="geo-pin" aria-hidden="true">⌖</span><span><b>${place}</b><small>${isDesktop ? `PC-Modus · Stations-Geohash ${placeHash}` : `Bereit zur Standortprüfung · Geohash ${placeHash}`}</small></span></div>
        ${isDesktop ? "" : '<button class="geo-button" type="button">Standort prüfen</button>'}
      </div>`;
    const button = holder.querySelector(".geo-button");
    if (button) button.addEventListener("click", () => checkLocation(stage, holder));
  }

  function checkLocation(stage, holder) {
    const status = holder.querySelector("small");
    if (!navigator.geolocation) {
      status.textContent = "Standort ist in diesem Browser nicht verfügbar. Du kannst trotzdem weiterspielen.";
      return;
    }
    status.textContent = "Standort wird ermittelt …";
    navigator.geolocation.getCurrentPosition((position) => {
      const targetLat = Number(stage.dataset.lat);
      const targetLon = Number(stage.dataset.lon);
      const distance = Math.round(distanceMeters(position.coords.latitude, position.coords.longitude, targetLat, targetLon));
      const currentHash = encodeGeohash(position.coords.latitude, position.coords.longitude);
      const near = distance <= 250;
      status.textContent = `${near ? "Du bist an der Station" : `Noch etwa ${distance.toLocaleString("de-DE")} m entfernt`} · Dein Geohash ${currentHash}`;
      holder.querySelector(".geo-inner").style.borderColor = near ? "#5f956f" : "#d8cda8";
    }, () => {
      status.textContent = `Keine Standortfreigabe · Stations-Geohash ${encodeGeohash(Number(stage.dataset.lat), Number(stage.dataset.lon))}`;
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  function cleanCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Der Spielraum ist gerade nicht erreichbar.");
    return data;
  }

  function sharedState() {
    return { stage: state.stage, branch: state.branch, visited: [...new Set(state.visited)].filter((n) => Number.isInteger(n) && n >= 0 && n <= 9) };
  }

  function updateTeamBar(statusText, online = true) {
    if (!team) return;
    teamBar.classList.remove("hidden");
    document.querySelector("#team-bar-name").textContent = team.teamName;
    document.querySelector("#team-bar-code").textContent = team.code;
    document.querySelector("#team-bar-status").textContent = statusText || `${team.activeMembers || 1} ${team.activeMembers === 1 ? "Person" : "Personen"} aktiv · ${team.nickname}`;
    teamBar.querySelector(".team-dot").classList.toggle("offline", !online);
  }

  function adoptTeamState(remote, notify = false) {
    if (!remote) return;
    const nextStage = Math.max(0, Math.min(9, Number(remote.stage) || 0));
    const changed = nextStage !== state.stage || (remote.branch || null) !== state.branch;
    state.branch = remote.branch || null;
    state.visited = Array.isArray(remote.visited) ? remote.visited : [0];
    if (!state.visited.includes(nextStage)) state.visited.push(nextStage);
    saveState();
    if (!state.mode) {
      pendingTeamStage = nextStage;
      return;
    }
    if (changed) {
      go(nextStage, { remote: true });
      if (notify) showToast(`Euer Team ist jetzt bei: ${stationNames[nextStage]}`);
    }
  }

  async function syncTeamState() {
    if (!team || syncing) return;
    syncing = true;
    updateTeamBar("Fortschritt wird synchronisiert …");
    try {
      const data = await api(`/api/rooms/${team.code}/state`, {
        method: "PUT",
        body: JSON.stringify({ memberId: team.memberId, state: sharedState() })
      });
      team.revision = data.revision;
      team.activeMembers = data.activeMembers;
      saveTeam();
      updateTeamBar();
    } catch (error) {
      updateTeamBar("Offline · Verbindung wird erneut versucht", false);
    } finally {
      syncing = false;
    }
  }

  async function pollTeam() {
    if (!team) return;
    try {
      const data = await api(`/api/rooms/${team.code}?memberId=${encodeURIComponent(team.memberId)}`, { headers: {} });
      team.revision = data.revision;
      team.activeMembers = data.activeMembers;
      team.teamName = data.teamName;
      saveTeam();
      updateTeamBar();
      adoptTeamState(data.state, true);
    } catch (error) {
      updateTeamBar(error.message, false);
    }
  }

  function beginPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(pollTeam, 2500);
  }

  function activateTeam(data, showCode = false) {
    team = {
      code: data.code,
      memberId: data.memberId,
      nickname: data.nickname,
      teamName: data.teamName,
      revision: data.revision,
      activeMembers: data.activeMembers
    };
    saveTeam();
    teamPanel.classList.add("hidden");
    modePanel.classList.remove("hidden");
    if (showCode) {
      teamPanel.classList.remove("hidden");
      document.querySelector("#team-choice-grid").classList.add("hidden");
      document.querySelector("#create-team-form").classList.add("hidden");
      document.querySelector("#room-ready").classList.remove("hidden");
      document.querySelector("#room-ready-code").textContent = team.code;
    }
    updateTeamBar();
    adoptTeamState(data.state);
    beginPolling();
  }

  function showTeamForm(kind) {
    document.querySelector("#team-choice-grid").classList.add("hidden");
    document.querySelector("#create-team-form").classList.toggle("hidden", kind !== "create");
    document.querySelector("#join-team-form").classList.toggle("hidden", kind !== "join");
  }

  document.querySelectorAll("[data-team-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.teamAction;
            if (action === "solo") {
        teamPanel.classList.add("hidden");
        if (state.mode) {
          modePanel.classList.add("hidden");
          document.querySelector("#start-cta").classList.add("hidden");
          startQuiz.classList.remove("hidden");
          startQuiz.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          modePanel.classList.remove("hidden");
        } 
      } else if (action === "back") {
        document.querySelector("#team-choice-grid").classList.remove("hidden");
        document.querySelector("#create-team-form").classList.add("hidden");
        document.querySelector("#join-team-form").classList.add("hidden");
      } else {
        showTeamForm(action);
      }
    });
  });

  document.querySelector("#open-team-mode").addEventListener("click", () => {
    go(0, { remote: Boolean(team) });
    if (team) {
      updateTeamBar();
      showToast(`Du spielst im Raum ${team.code}.`);
      teamBar.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    document.querySelector("#team-choice-grid").classList.remove("hidden");
    document.querySelector("#create-team-form").classList.add("hidden");
    document.querySelector("#join-team-form").classList.add("hidden");
    document.querySelector("#room-ready").classList.add("hidden");
    teamPanel.classList.remove("hidden");
    modePanel.classList.add("hidden");
    startQuiz.classList.add("hidden");
    teamPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector("#join-room-code").addEventListener("input", (event) => {
    event.currentTarget.value = cleanCode(event.currentTarget.value);
  });

  document.querySelector("#create-team-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = document.querySelector("#create-team-feedback");
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    feedback.textContent = "Raum wird erstellt …";
    try {
      const data = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ teamName: document.querySelector("#create-team-name").value, nickname: document.querySelector("#create-nickname").value, state: sharedState() })
      });
      feedback.textContent = "";
      activateTeam(data, true);
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#join-team-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = document.querySelector("#join-team-feedback");
    const submit = event.currentTarget.querySelector('[type="submit"]');
    const code = cleanCode(document.querySelector("#join-room-code").value);
    submit.disabled = true;
    feedback.textContent = "Verbindung wird hergestellt …";
    try {
      const data = await api(`/api/rooms/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ nickname: document.querySelector("#join-nickname").value })
      });
      feedback.textContent = "";
      activateTeam(data);
      showToast(`Du spielst jetzt mit ${data.teamName}.`);
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  async function copyTeamCode() {
    if (!team) return;
    try {
      await navigator.clipboard.writeText(team.code);
      showToast(`Raumcode ${team.code} wurde kopiert.`);
    } catch {
      showToast(`Euer Raumcode lautet ${team.code}.`);
    }
  }

  document.querySelector("#copy-room-code").addEventListener("click", copyTeamCode);
  document.querySelector("#copy-ready-code").addEventListener("click", copyTeamCode);
  document.querySelector("#leave-team").addEventListener("click", () => {
    team = null;
    saveTeam();
    clearInterval(pollTimer);
    location.reload();
  });

    document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      saveState();
      modePanel.classList.add("hidden");
      teamPanel.classList.add("hidden");
      document.querySelector("#start-cta").classList.add("hidden");
      startQuiz.classList.remove("hidden");
      startQuiz.scrollIntoView({ behavior: "smooth", block: "center" });
      if (pendingTeamStage !== null && pendingTeamStage > 0) {
        const target = pendingTeamStage;
        pendingTeamStage = null;
        setTimeout(() => go(target, { remote: true }), 250);
      }
    });
  });

// „Die Suche starten"-Button auf der Startseite

document.querySelector("#start-cta").addEventListener("click", () => {
  document.querySelector("#start-cta").classList.add("hidden");
  startQuiz.classList.remove("hidden");
  startQuiz.scrollIntoView({ behavior: "smooth", block: "center" });
});

// „Weiter"-Button auf der Schloss-Seite
document.querySelector("#schloss-weiter").addEventListener("click", () => {
  document.querySelector("#schloss-photos").classList.remove("hidden");
  document.querySelector("#schloss-weiter").classList.add("hidden");
});

  document.querySelector("#check-start").addEventListener("click", () => {
    const selected = document.querySelector('input[name="princess-home"]:checked');
    const feedback = document.querySelector("#start-feedback");
    if (!selected) {
      feedback.textContent = "Wähle zuerst eine Antwort aus.";
      return;
    }
    if (selected.value !== "schloss") {
      feedback.classList.remove("success");
      feedback.textContent = "Die Prinzessin wird gleich von einem Drachen gefressen, versuche es noch einmal.";
      return;
    }
    feedback.classList.add("success");
    feedback.textContent = "Richtig! Deine Suche beginnt am Schloss.";
    setTimeout(() => go(1), 550);
  });

  document.querySelector("#schloss-note").addEventListener("click", () => {
    document.querySelector("#nightwatch-clue").classList.remove("hidden");
    document.querySelector("#nightwatch-clue").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector("#show-footprint").addEventListener("click", () => {
    document.querySelector("#footprint-riddle").classList.remove("hidden");
    document.querySelector("#footprint-riddle").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector("#footprint-photo").addEventListener("change", (event) => {
    const preview = document.querySelector("#photo-preview");
    const file = event.target.files?.[0];
    preview.replaceChildren();
    if (!file) return;
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = "Vorschau deines Fotos vom Schuhabdruck";
    image.onload = () => URL.revokeObjectURL(image.src);
    preview.append(image);
    showToast("Foto ausgewählt – es bleibt nur auf diesem Gerät.");
  });

  document.querySelector("#book-crown").addEventListener("click", () => {
    document.querySelector("#park-riddle").classList.remove("hidden");
    document.querySelector("#park-riddle").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelectorAll("[data-check-text]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`#${button.dataset.checkText}`);
      const feedback = document.querySelector(`#${button.dataset.checkText}-feedback`);
      if (normalize(input.value) !== normalize(button.dataset.solution)) {
        feedback.classList.remove("success");
        feedback.textContent = "Noch nicht ganz. Prüfe den Hinweis und versuche es erneut.";
        input.focus();
        return;
      }
      feedback.classList.add("success");
      feedback.textContent = "Richtig gelöst!";
      if (button.dataset.reveal) {
        const reveal = document.querySelector(`#${button.dataset.reveal}`);
        reveal.classList.remove("hidden");
        reveal.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (button.dataset.successStage) setTimeout(() => go(Number(button.dataset.successStage)), 500);
    });
  });

  document.querySelector("#pillory-quiz").addEventListener("submit", (event) => {
    event.preventDefault();
    const answer1 = new FormData(event.currentTarget).get("pillory-1");
    const answer2 = new FormData(event.currentTarget).get("pillory-2");
    const feedback = document.querySelector("#pillory-feedback");
    if (!answer1 || !answer2) {
      feedback.textContent = "Beantworte bitte beide Fragen.";
      return;
    }
    if (answer1 !== "b" || answer2 !== "a") {
      feedback.classList.remove("success");
      feedback.textContent = "Mindestens eine Antwort stimmt noch nicht. Hör noch einmal genau hin.";
      return;
    }
    feedback.classList.add("success");
    feedback.textContent = "Beide Antworten sind richtig!";
    document.querySelector("#library-audio").classList.remove("hidden");
  });

  document.querySelectorAll("[data-branch]").forEach((button) => {
    button.addEventListener("click", () => {
      state.branch = button.dataset.branch;
      saveState();
      go(6);
    });
  });

  function renderBranch() {
    const target = document.querySelector("[data-stage='6']");
    const content = document.querySelector("#branch-content");
    if (state.branch === "memos") {
      progressLabel.textContent = "Memo’s Döner-Eck";
      target.dataset.place = "Memo’s Döner-Eck";
      target.dataset.lat = "50.7533513";
      target.dataset.lon = "12.6331284";
      content.innerHTML = `
        <div class="stage-head"><div><p class="eyebrow">Station 6 · Pfad der Nase</p><h2 id="title-branch">Memo’s Döner-Eck</h2></div><span class="stage-glyph" aria-hidden="true">♨</span></div>
        <div class="geo-card"></div>
        <div class="story-grid"><img class="feature-image" src="assets/neumarkt-doener.webp" alt="Ein Döner als duftende Spur"><div><p class="lead">Ein betörender Duft steigt dir in die Nase. Eine Person läuft mit einem Döner vorbei – und in der Ferne entdeckst du eine Werbetafel.</p><img class="feature-image" src="assets/memos-aussen.webp" alt="Werbetafel von Memo’s Döner-Eck"></div></div>
        <div class="story-grid"><div><p class="lead">Memo’s Döner-Eck ist ein bekannter Imbiss in Lichtenstein – mit sehr leckeren türkischen Spezialitäten und Steinofenpizza. Seit 1999 ist er hier zuhause. Im Laden arbeitet der Besitzer an einer vergoldeten Ritterrüstung.</p><details><summary>Mehr über Memo’s</summary><p>Der bekannte Imbiss ist seit vielen Jahren in Lichtenstein zuhause. Ein Besuch lohnt sich – doch zuerst wartet dein Rätsel.</p></details></div><img class="feature-image" src="assets/memos-tresen.webp" alt="Tresen in Memo’s Döner-Eck"></div>
        <div class="challenge-block"><img class="feature-image" src="assets/memos-ruestung.webp" alt="Vergoldete Ritterrüstung, der ein Teil fehlt"><h3>Was fehlt an der Rüstung?</h3><label class="text-answer">Deine Antwort<input id="armor-answer" autocomplete="off" placeholder="Lösungswort"></label><button class="primary-button" id="check-armor" type="button">Lösung prüfen</button><p class="feedback" id="armor-feedback" role="alert"></p></div>`;
      document.querySelector("#check-armor").addEventListener("click", () => {
        const answer = document.querySelector("#armor-answer");
        const feedback = document.querySelector("#armor-feedback");
        if (normalize(answer.value) !== "helm") {
          feedback.textContent = "Schau dir den Kopf der Rüstung noch einmal an.";
          return;
        }
        feedback.classList.add("success");
        feedback.textContent = "Richtig – ein Helm!";
        setTimeout(() => go(7), 500);
      });
    } else {
      state.branch = "gymnasium";
      progressLabel.textContent = "Gymnasium";
      target.dataset.place = "Prof. Dr. Max Schneider Gymnasium";
      target.dataset.lat = "50.75360";
      target.dataset.lon = "12.63114";
      content.innerHTML = `
        <div class="stage-head"><div><p class="eyebrow">Station 6 · Pfad der Augen</p><h2 id="title-branch">Das Gymnasium</h2></div><span class="stage-glyph" aria-hidden="true">⌂</span></div>
        <div class="geo-card"></div>
        <div class="story-grid"><img class="feature-image" src="assets/neumarkt-ranzen.webp" alt="Verlassener Schulranzen auf dem Neumarkt"><div><p class="lead">Du entdeckst einen verlassenen Schulranzen. Auf dem Namensschild steht „Karl Max Schneider“.</p><p>Du bringst ihn zum Prof. Dr. Max Schneider Gymnasium zurück.</p></div></div>
        <div class="story-grid"><div><p class="lead">Im Sekretariat bedankt man sich für deine Hilfe. Auf dem Weg hinaus fällt dir etwas in der Vitrine auf.</p><details><summary>Mehr über das Gymnasium</summary><p>Karl Max Schneider war Zoologe und Direktor des Leipziger Zoos. Das Gymnasium wurde 1992 gegründet; seine Schulgebäude sind jedoch mehr als 100 Jahre alt. Mit 2 Schulgebäuden ist das Gymnasium 30000 m² groß.</p></details><video controls playsinline preload="metadata" poster="assets/gymnasium-front.webp"><source src="assets/gymnasium.mp4" type="video/mp4"><p>Das Video kann auf diesem Gerät nicht abgespielt werden.</p></video></div><div class="branch-gallery"><img src="assets/gymnasium-front.webp" alt="Gebäude des Gymnasiums"><img src="assets/gymnasium-sekretariat.webp" alt="Illustration eines Schulsekretariats"></div></div>
        <div class="challenge-block"><img class="feature-image" src="assets/gymnasium-vitrine.webp" alt="Schulgang mit einer Vitrine"><h3>Das ist kein Pokal …</h3><p>Es ist ein goldener Helm. Und weil dein Magen knurrt, folgst du diesem Hinweis.</p><button class="primary-button" type="button" id="gym-to-helm">Zum Goldenen Helm</button></div>`;
      document.querySelector("#gym-to-helm").addEventListener("click", () => go(7));
    }
    saveState();
  }

  const ingredients = [
    { name: "Butter", image: "butter.webp", target: "pfanne" },
    { name: "Fleisch", image: "schnitzel.webp", target: "pfanne" },
    { name: "Gewürze", image: "gewuerz.webp", target: "pfanne" },
    { name: "Kartoffeln", image: "kartoffeln.webp", target: "topf" },
    { name: "Sellerie", image: "sellerie.webp", target: "topf" },
    { name: "Karotten", image: "karotten.webp", target: "topf" },
    { name: "Lauch", image: "lauch.webp", target: "topf" }
  ];

  function renderIngredients() {
    const grid = document.querySelector("#ingredient-grid");
    grid.innerHTML = ingredients.map((item, index) => `
      <article class="ingredient" data-target="${item.target}" data-choice="">
        <img src="assets/${item.image}" alt="${item.name}">
        <div class="ingredient-body"><b>${item.name}</b><div class="ingredient-controls" role="group" aria-label="${item.name} zuordnen"><button type="button" data-choice="topf" aria-pressed="false">Topf</button><button type="button" data-choice="pfanne" aria-pressed="false">Pfanne</button></div></div>
      </article>`).join("");
    grid.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest(".ingredient");
        card.dataset.choice = button.dataset.choice;
        card.querySelectorAll("button").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      });
    });
  }

  document.querySelector("#check-kitchen").addEventListener("click", () => {
    const cards = [...document.querySelectorAll(".ingredient")];
    const feedback = document.querySelector("#kitchen-feedback");
    if (cards.some((card) => !card.dataset.choice)) {
      feedback.textContent = "Ordne zuerst jede Zutat einem Kochgefäß zu.";
      return;
    }
    if (cards.some((card) => card.dataset.choice !== card.dataset.target)) {
      feedback.classList.remove("success");
      feedback.textContent = "Fast! Mindestens eine Zutat liegt noch im falschen Kochgefäß.";
      return;
    }
    feedback.classList.add("success");
    feedback.textContent = "Perfekt sortiert – das Essen ist gerettet!";
    const reveal = document.querySelector("#cinema-ticket");
    reveal.classList.remove("hidden");
    reveal.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.addEventListener("click", (event) => {
    const goButton = event.target.closest("[data-go]");
    if (goButton) go(Number(goButton.dataset.go));
  });

  const soundToggle = document.querySelector("#sound-toggle");
  function applyMuted() {
    document.querySelectorAll("audio, video").forEach((media) => { media.muted = state.muted; });
    soundToggle.setAttribute("aria-pressed", String(state.muted));
    soundToggle.textContent = state.muted ? "×" : "♪";
    soundToggle.setAttribute("aria-label", state.muted ? "Töne einschalten" : "Töne ausschalten");
  }
  soundToggle.addEventListener("click", () => {
    state.muted = !state.muted;
    saveState();
    applyMuted();
  });
  document.addEventListener("play", applyMuted, true);

  function resetGame() {
    localStorage.removeItem(STORAGE_KEY);
    Object.assign(state, defaultState());
    document.querySelectorAll("input").forEach((input) => {
      if (input.type === "radio" || input.type === "checkbox") input.checked = false;
      else input.value = "";
    });
    document.querySelectorAll(".feedback").forEach((element) => { element.textContent = ""; element.classList.remove("success"); });
    document.querySelectorAll(".reveal-card").forEach((element) => element.classList.add("hidden"));
    document.querySelector("#footprint-riddle").classList.add("hidden");
    document.querySelector("#park-riddle").classList.add("hidden");
    document.querySelector("#start-cta").classList.remove("hidden");
    document.querySelector("#schloss-weiter").classList.remove("hidden");
    document.querySelector("#schloss-photos").classList.add("hidden");
    startQuiz.classList.add("hidden");
    teamPanel.classList.toggle("hidden", Boolean(team));
    modePanel.classList.remove("hidden");
    renderIngredients();
    applyMuted();
    go(0);
  }

  document.querySelector("#reset-progress").addEventListener("click", () => {
    if (window.confirm("Möchtest du den gesamten Spielstand zurücksetzen?")) resetGame();
  });
  document.querySelector("#restart-game").addEventListener("click", resetGame);

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const register = (tool) => {
      try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch { /* unsupported preview */ }
    };
    register({
      name: "read_game_state",
      title: "Spielstand lesen",
      description: "Liest die aktuelle Station, den Spielmodus und den gewählten Pfad des Stadtspiels.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() { return { stage: state.stage, station: stationNames[state.stage], mode: state.mode, branch: state.branch }; }
    });
    register({
      name: "navigate_to_visited_station",
      title: "Besuchte Station öffnen",
      description: "Öffnet eine bereits besuchte Station im sichtbaren Stadtspiel.",
      inputSchema: { type: "object", properties: { stage: { type: "integer", minimum: 0, maximum: 9 } }, required: ["stage"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !Number.isInteger(input.stage) || !state.visited.includes(input.stage)) throw new Error("Diese Station wurde noch nicht besucht.");
        go(input.stage);
        return { stage: state.stage, station: stationNames[state.stage] };
      }
    });
  }

  renderIngredients();
  applyMuted();
  if (team) {
    teamPanel.classList.add("hidden");
    modePanel.classList.toggle("hidden", Boolean(state.mode));
    startQuiz.classList.toggle("hidden", !state.mode);
    updateTeamBar("Verbindung wird hergestellt …");
    beginPolling();
    pollTeam();
  } else if (state.mode) {
    teamPanel.classList.add("hidden");
    modePanel.classList.add("hidden");
    startQuiz.classList.remove("hidden");
  } else {
    teamPanel.classList.remove("hidden");
    modePanel.classList.add("hidden");
  }
  go(state.stage, { keepScroll: true, remote: Boolean(team) });
  if (state.stage > 0) showToast(`Spielstand fortgesetzt: ${stationNames[state.stage]}`);
  registerWebMcpTools();
})();
