/* ================== AYARLAR ================== */
const API_BASE = "https://base.blockscout.com/api";  // Blockscout — free, no key required
const COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// GM/GN kontratı — deploy edildikten sonra adres buraya girilecek.
// Boş olduğu sürece GM/GN butonları "yakında aktif" mesajı gösterir.
const GMGN_CONTRACT_ADDRESS = "0xfd506cf3e7969348c41c8fbeecad7e72dd8427ae";
const GMGN_ABI = [
  "function gm() external",
  "function gn() external",
  "function canGm(address user) external view returns (bool)",
  "function canGn(address user) external view returns (bool)",
  "function getStats(address user) external view returns (uint256 lastGm, uint256 lastGn, uint32 gmStreak, uint32 gnStreak, uint32 bestGmStreak, uint32 bestGnStreak, uint32 totalGm, uint32 totalGn)"
];
const GMGN_COOLDOWN_SECONDS = 20 * 60 * 60; // kontrattaki COOLDOWN ile aynı (20 saat)

// Panda kontratı — deploy edildikten sonra adres buraya girilecek.
const PANDA_CONTRACT_ADDRESS = "0xad706978c08d860681899bdad410da6e884dfc0d";
const PANDA_ABI = [
  "function feed() external",
  "function feedPremium() external payable",
  "function setName(string name) external",
  "function setVariant(uint8 variantId) external",
  "function upgradeStat(uint8 statId) external",
  "function canFeed(address user) external view returns (bool)",
  "function premiumFeedsRemainingToday(address user) external view returns (uint32)",
  "function premiumPriceWei() external view returns (uint256)",
  "function getStats(address user) external view returns (uint256 lastFed, uint32 feedCount, uint32 xp, uint32 streak, uint32 bestStreak, uint32 premiumRemaining)",
  "function getBattleStats(address user) external view returns (uint32 level, uint32 attack, uint32 speed, uint32 defense, uint32 luck, uint32 statPoints)",
  "function getProfile(address user) external view returns (string name, uint8 variant)",
  "function getOwnersCount() external view returns (uint256)",
  "function getAllOwners() external view returns (address[])",
  "function totalXpForLevel(uint32 level) external pure returns (uint32)"
];
const PANDA_COOLDOWN_SECONDS = 6 * 60 * 60;
const PANDA_STREAK_WINDOW_SECONDS = 12 * 60 * 60;
// Basitleştirildi: artık ara aşama etiketleri (Young Panda/Panda/Elder) yok.
// Sadece Egg (0-4 XP) ve büyüyen Cub (5-99 XP) var. 100 XP'de seçim açılır,
// seçimden sonra panda kendi level/istatistik sistemine geçer (bkz. aşağı).
const PANDA_BASE_SCALE = 0.65;
const PANDA_STAGES = [
  { label: 'Egg', scale: 0.5, isEgg: true },
  { label: 'Cub', scale: PANDA_BASE_SCALE }
];
const PANDA_MODEL_URL = './BlueBabyPanda.glb';
const EGG_MODEL_URL = './EGG.glb';

// 100 XP'de açılan seçilebilir görünümler (kontrattaki VARIANT_UNLOCK_XP ile aynı).
// Sıra, kontrattaki setVariant(uint8) parametresiyle birebir eşleşmeli.
const PANDA_VARIANT_UNLOCK_XP = 100;
const PANDA_VARIANTS = [
  { file: './Shadow.glb', label: 'Shadow' },
  { file: './Zephyr.glb', label: 'Zephyr' },
  { file: './Spektrum.glb', label: 'Spektrum' },
  { file: './Ninja.glb', label: 'Ninja' },
  { file: './Nexus.glb', label: 'Nexus' }
];

const STAT_LABELS = ['Attack', 'Speed', 'Defense', 'Luck'];

// Kontrattaki totalXpForLevel() formülünün birebir aynısı (100 + 45n + 5n², n=level-5)
function totalXpForLevel(level){
  if(level <= 5) return 100;
  const n = level - 5;
  return 100 + 45 * n + 5 * n * n;
}

// Base Builder Code attribution (ERC-8021) — her işlemin sonuna eklenir,
// kontrat çalışmasını etkilemez, sadece base.dev analitiğinde bu uygulamaya
// ait olarak işaretlenmesini sağlar.
const BUILDER_CODE_SUFFIX = '62635f67306b736161786f0b0080218021802180218021802180218021';

async function sendWithAttribution(contract, methodName, args = []){
  const populatedTx = await contract.populateTransaction[methodName](...args);
  populatedTx.data = populatedTx.data + BUILDER_CODE_SUFFIX;
  return contract.signer.sendTransaction(populatedTx);
}



const BASE_CHAIN_ID_HEX = "0x2105"; // 8453 — Base mainnet
const BASE_CHAIN_PARAMS = {
  chainId: BASE_CHAIN_ID_HEX,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"]
};
/* =============================================== */

const input = document.getElementById('addr');
const terminalWindow = document.getElementById('terminal-window');
const terminal = document.getElementById('terminal');
let activeTerminal = terminal; // GM/GN gibi başka ekranlarda hedef değişebilir

/* ── açılış glitch flaşı temizliği ────────────────────────────── */
const bootOverlay = document.getElementById('boot-overlay');
setTimeout(() => { if(bootOverlay) bootOverlay.style.display = 'none'; }, 950);

/* ── ekran geçişleri (gate → menu → scanner) ──────────────────── */
const screenGate = document.getElementById('screen-gate');
const screenMenu = document.getElementById('screen-menu');
const screenStage = document.getElementById('stage');
const gatePass = document.getElementById('gate-pass');

function goToScreen(el){
  [screenGate, screenMenu, screenStage, screenGmgn, screenPanda, screenLeaderboard].forEach(s => s.classList.remove('active'));
  el.classList.add('active');

  // Uzun içerikli ekranlarda (scanner/GM-GN/panda/leaderboard) sayfa üstten
  // hizalanır ve alt logo/footer normal akışa geçer (üst üste binmesin diye).
  const longContentScreens = [screenStage, screenGmgn, screenPanda, screenLeaderboard];
  document.body.classList.toggle('scanning', longContentScreens.includes(el));
}

const GATE_STORAGE_KEY = 'baseTerminalUnlocked';

gatePass.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter') return;
  const value = gatePass.value.trim().toUpperCase();
  if(value === 'BASE'){
    try{ localStorage.setItem(GATE_STORAGE_KEY, '1'); }catch(e){ /* storage kapalıysa sessizce geç */ }
    goToScreen(screenMenu);
  }else{
    screenGate.classList.add('shake');
    setTimeout(() => screenGate.classList.remove('shake'), 400);
    gatePass.value = '';
  }
});

// Daha önce kod girilmişse (localStorage'da işaretliyse), sayfa yenilenince
// tekrar kod sormadan direkt menüye geç.
try{
  if(localStorage.getItem(GATE_STORAGE_KEY) === '1'){
    goToScreen(screenMenu);
  }
}catch(e){ /* storage kapalıysa sessizce geç, gate ekranı varsayılan kalır */ }

const connectBtn = document.getElementById('menu-connect-btn');
const airdropTasks = document.getElementById('airdrop-tasks');
let connectedAddress = null;

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  try{
    const address = await connectWallet();
    connectedAddress = address;
    connectBtn.textContent = `Connected: ${shortAddr(address)}`;
    airdropTasks.classList.add('visible');
  }catch(err){
    connectBtn.textContent = 'Connect Wallet';
    alert(err.message || 'Bağlantı başarısız.');
  }
  connectBtn.disabled = false;
});

const gmgnTerminal = document.getElementById('gmgn-terminal');
const screenGmgn = document.getElementById('screen-gmgn');
const gmgnBtn = document.getElementById('gmgn-task-btn');
const gmgnBackBtn = document.getElementById('gmgn-back-btn');

gmgnBtn.addEventListener('click', async () => {
  gmgnBtn.disabled = true;
  try{
    if(!connectedAddress){
      gmgnBtn.textContent = 'Connecting...';
      connectedAddress = await connectWallet();
      connectBtn.textContent = `Connected: ${shortAddr(connectedAddress)}`;
      airdropTasks.classList.add('visible');
    }
    activeTerminal = gmgnTerminal;
    activeTerminal.innerHTML = '';
    goToScreen(screenGmgn);
    await addFieldRow('Wallet:', shortAddr(connectedAddress));
    await showGmGnSection(connectedAddress);
  }catch(err){
    alert(err.message || 'Bağlantı başarısız.');
  }
  gmgnBtn.textContent = 'GM / GN';
  gmgnBtn.disabled = false;
});

gmgnBackBtn.addEventListener('click', () => {
  if(gmgnCountdownTimer) clearInterval(gmgnCountdownTimer);
  goToScreen(screenMenu);
});

/* ── Feed Panda ────────────────────────────────────────────────── */
const screenPanda = document.getElementById('screen-panda');
const pandaTaskBtn = document.getElementById('panda-task-btn');
const pandaBackBtn = document.getElementById('panda-back-btn');
const pandaFeedBtn = document.getElementById('panda-feed-btn');
const pandaPremiumBtn = document.getElementById('panda-premium-btn');
const pandaNameDisplay = document.getElementById('panda-name-display');
const pandaNameInput = document.getElementById('panda-name-input');
const pandaNameBtn = document.getElementById('panda-name-btn');
const pandaVariantSelect = document.getElementById('panda-variant-select');
const pandaVariantGrid = document.getElementById('panda-variant-grid');
const pandaBattleStats = document.getElementById('panda-battle-stats');
const pandaBattleValues = document.getElementById('panda-battle-values');
const pandaStatUpgrade = document.getElementById('panda-stat-upgrade');
const pandaStatGrid = document.getElementById('panda-stat-grid');
const pandaEmoji = document.getElementById('panda-emoji');
const pandaStageLabel = document.getElementById('panda-stage-label');
const pandaMood = document.getElementById('panda-mood');
const pandaProgressFill = document.getElementById('panda-progress-fill');
const pandaProgressLabel = document.getElementById('panda-progress-label');
const pandaStats = document.getElementById('panda-stats');
const pandaCountdown = document.getElementById('panda-countdown');
let pandaCountdownTimer = null;

function getPandaContract(){
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  return new ethers.Contract(PANDA_CONTRACT_ADDRESS, PANDA_ABI, signer);
}

/* ── 3D panda sahnesi (Three.js + GLTF) ───────────────────────────── */
let pandaThreeReady = false;
let pandaScene, pandaCamera, pandaRenderer, pandaModel, pandaMixer, pandaClock, pandaControls;
let pandaRafId = null;
let pandaCurrentStageScale = 0.65;
let pandaMoodAmplitude = 0.035;
let pandaMoodSpeed = 1.3;
let pandaBounceUntil = 0;
const pandaHudBreath = document.getElementById('panda-hud-breath');
const pandaHudUptime = document.getElementById('panda-hud-uptime');

function initPandaThree(){
  if(pandaThreeReady) return;
  pandaThreeReady = true;

  const container = document.getElementById('panda-emoji');
  const width = container.clientWidth || 300;
  const height = container.clientHeight || 230;

  pandaScene = new THREE.Scene();
  pandaCamera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
  pandaCamera.position.set(0, 1.1, 4.2);

  pandaRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  pandaRenderer.setSize(width, height);
  pandaRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  pandaRenderer.outputEncoding = THREE.sRGBEncoding;
  pandaRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  pandaRenderer.toneMappingExposure = 1.0;
  container.innerHTML = '';
  container.appendChild(pandaRenderer.domElement);

  if(THREE.OrbitControls){
    pandaControls = new THREE.OrbitControls(pandaCamera, pandaRenderer.domElement);
    pandaControls.enableDamping = true;
    pandaControls.dampingFactor = 0.08;
    pandaControls.enablePan = false;
    pandaControls.minDistance = 2.5;
    pandaControls.maxDistance = 7;
    pandaControls.target.set(0, 0.4, 0);
    pandaControls.update();
  }

  pandaScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xaaccff, 0.8);
  keyLight.position.set(2, 3, 4);
  pandaScene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x0052ff, 0.5);
  rimLight.position.set(-3, 2, -2);
  pandaScene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(0, -2, 3);
  pandaScene.add(fillLight);

  pandaClock = new THREE.Clock();

  window.addEventListener('resize', () => {
    if(!pandaRenderer || !container.clientWidth) return;
    const w = container.clientWidth, h = container.clientHeight;
    pandaCamera.aspect = w / h;
    pandaCamera.updateProjectionMatrix();
    pandaRenderer.setSize(w, h);
  });

  loadPandaModel(pandaCurrentModelUrl || PANDA_MODEL_URL);
}

let pandaCurrentModelUrl = null;

/// Modeli (baştaki panda ya da bir Elder Panda varyantı) yükler/değiştirir.
/// Zaten yüklü bir model varsa önce sahneden kaldırıp belleğini temizler.
function loadPandaModel(url){
  if(pandaCurrentModelUrl === url && pandaModel) return; // zaten bu model yüklü
  pandaCurrentModelUrl = url;

  const container = document.getElementById('panda-emoji');
  const loader = new THREE.GLTFLoader();

  loader.load(
    url,
    (gltf) => {
      // eski modeli sahneden kaldır ve belleğini serbest bırak
      if(pandaModel){
        pandaScene.remove(pandaModel);
        pandaModel.traverse((child) => {
          if(child.geometry) child.geometry.dispose();
          if(child.material){
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(m => {
              if(m.map) m.map.dispose();
              m.dispose();
            });
          }
        });
      }
      if(pandaMixer){ pandaMixer.stopAllAction(); pandaMixer = null; }

      pandaModel = gltf.scene;

      const box = new THREE.Box3().setFromObject(pandaModel);
      const size3 = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      pandaModel.position.sub(center);

      const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
      const baseScale = 2.1 / maxDim;
      pandaModel.userData.baseScale = baseScale;
      pandaModel.scale.setScalar(baseScale * pandaCurrentStageScale);

      pandaScene.add(pandaModel);

      if(gltf.animations && gltf.animations.length){
        pandaMixer = new THREE.AnimationMixer(pandaModel);
        pandaMixer.clipAction(gltf.animations[0]).play();
      }
    },
    undefined,
    (err) => {
      console.error('Panda model yüklenemedi:', err);
      if(container) container.innerHTML = '<span id="panda-loading">🐼</span>';
    }
  );
}

function setPandaMood(mood){
  if(mood === 'happy'){ pandaMoodAmplitude = 0.05; pandaMoodSpeed = 1.8; }
  else if(mood === 'sad'){ pandaMoodAmplitude = 0.02; pandaMoodSpeed = 0.8; }
  else { pandaMoodAmplitude = 0.035; pandaMoodSpeed = 1.3; }
}

let pandaElapsed = 0;

function triggerPandaBounce(){
  pandaBounceUntil = pandaElapsed + 0.7;
}

function animatePandaFrame(){
  pandaRafId = requestAnimationFrame(animatePandaFrame);
  const delta = pandaClock ? Math.min(pandaClock.getDelta(), 0.1) : 0.016;
  pandaElapsed += delta;
  if(pandaMixer) pandaMixer.update(delta);
  if(pandaControls) pandaControls.update();

  if(pandaModel){
    const t = pandaElapsed;
    const breathe = 1 + Math.sin(t * pandaMoodSpeed) * pandaMoodAmplitude;
    const base = pandaModel.userData.baseScale * pandaCurrentStageScale;

    let bounce = 0;
    if(t < pandaBounceUntil){
      const progress = 1 - (pandaBounceUntil - t) / 0.7;
      bounce = Math.sin(progress * Math.PI) * 0.35;
    }

    pandaModel.scale.setScalar(base * breathe);
    pandaModel.position.y = bounce;
    if(!pandaControls){
      pandaModel.rotation.y = Math.sin(t * 0.4) * 0.18;
    }
  }

  if(pandaHudBreath) pandaHudBreath.textContent = `sin·${pandaMoodSpeed.toFixed(1)}`;
  if(pandaHudUptime){
    const secs = Math.floor(pandaElapsed);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    pandaHudUptime.textContent = `${mm}:${ss}`;
  }

  if(pandaRenderer && pandaScene && pandaCamera){
    pandaRenderer.render(pandaScene, pandaCamera);
  }
}

function startPandaAnimation(){
  initPandaThree();
  if(!pandaRafId) animatePandaFrame();
}

function stopPandaAnimation(){
  if(pandaRafId){ cancelAnimationFrame(pandaRafId); pandaRafId = null; }
}

function renderPandaStats(s){
  const feedCount = Number(s.feedCount);
  const xp = Number(s.xp);
  const streak = Number(s.streak);
  const bestStreak = Number(s.bestStreak);
  const lastFed = Number(s.lastFed);
  const premiumRemaining = Number(s.premiumRemaining);
  const pandaName = s.name || '';
  const selectedVariantIdx = Number(s.variant) || 0;

  const battleLevel = Number(s.battleLevel);
  const attack = Number(s.attack);
  const speed = Number(s.speed);
  const defense = Number(s.defense);
  const luck = Number(s.luck);
  const statPoints = Number(s.statPoints);
  const hasSelected = battleLevel >= 5;

  pandaNameDisplay.textContent = pandaName ? `"${pandaName}"` : '// unnamed';
  if(!pandaNameInput.matches(':focus')){
    pandaNameInput.value = '';
    pandaNameInput.placeholder = pandaName ? `RENAME (current: ${pandaName})` : 'NAME YOUR PANDA';
  }

  // ── model & etiket ──
  const isEgg = xp < 5;
  let targetModelUrl;

  if(hasSelected){
    targetModelUrl = PANDA_VARIANTS[selectedVariantIdx].file;
    pandaStageLabel.textContent = `${PANDA_VARIANTS[selectedVariantIdx].label} — Lv.${battleLevel}`;
    pandaCurrentStageScale = 1.0;
  }else if(isEgg){
    targetModelUrl = EGG_MODEL_URL;
    pandaStageLabel.textContent = 'Egg';
    pandaCurrentStageScale = 0.5;
  }else{
    targetModelUrl = PANDA_MODEL_URL;
    pandaStageLabel.textContent = 'Cub';
    pandaCurrentStageScale = PANDA_BASE_SCALE;
  }

  if(pandaEmoji.querySelector('canvas') === null){
    pandaEmoji.innerHTML = '<span id="panda-loading">// loading...</span>';
    pandaThreeReady = false;
    pandaCurrentModelUrl = targetModelUrl;
  }
  startPandaAnimation();

  if(pandaThreeReady && pandaCurrentModelUrl !== targetModelUrl){
    loadPandaModel(targetModelUrl);
  }

  // ── panda seçim ızgarası: yalnızca 100 XP'de ve henüz seçim yapılmadıysa ──
  if(!hasSelected && xp >= PANDA_VARIANT_UNLOCK_XP){
    pandaVariantSelect.classList.add('visible');
    pandaVariantGrid.innerHTML = '';
    PANDA_VARIANTS.forEach((v, idx) => {
      const btn = document.createElement('button');
      btn.className = 'variant-btn';
      btn.textContent = v.label;
      btn.addEventListener('click', () => selectPandaVariant(idx));
      pandaVariantGrid.appendChild(btn);
    });
  }else{
    pandaVariantSelect.classList.remove('visible');
  }

  // ── ilerleme çubuğu ──
  if(!hasSelected){
    const pct = Math.min(100, Math.round((xp / PANDA_VARIANT_UNLOCK_XP) * 100));
    pandaProgressFill.style.width = `${pct}%`;
    pandaProgressLabel.textContent = `${xp} / ${PANDA_VARIANT_UNLOCK_XP} XP to Choose Your Panda`;
  }else{
    const nextThreshold = totalXpForLevel(battleLevel + 1);
    const prevThreshold = totalXpForLevel(battleLevel);
    const pct = Math.max(0, Math.min(100, Math.round(((xp - prevThreshold) / (nextThreshold - prevThreshold)) * 100)));
    pandaProgressFill.style.width = `${pct}%`;
    pandaProgressLabel.textContent = `${xp} / ${nextThreshold} XP to Level ${battleLevel + 1}`;
  }

  // ── temel istatistikler (güvenli DOM — textContent) ──
  pandaStats.innerHTML = '';
  [
    ['Total Feeds:', feedCount],
    ['XP:', xp],
    ['Current Streak:', streak],
    ['Best Streak:', bestStreak]
  ].forEach(([label, value]) => {
    const line = document.createElement('div');
    line.appendChild(document.createTextNode(label + ' '));
    const valSpan = document.createElement('span');
    valSpan.className = 'p-value';
    valSpan.textContent = value;
    line.appendChild(valSpan);
    pandaStats.appendChild(line);
  });

  // ── savaş istatistikleri + yükseltme (yalnızca seçim yapıldıysa) ──
  if(hasSelected){
    pandaBattleStats.classList.add('visible');
    pandaBattleValues.innerHTML = '';

    [
      ['Level', battleLevel, true],
      ['Attack', attack, false],
      ['Speed', speed, false],
      ['Defense (HP)', defense, false],
      ['Luck', `${luck}%`, false]
    ].forEach(([label, value, isLevel]) => {
      const box = document.createElement('div');
      box.className = 'battle-stat-box' + (isLevel ? ' bs-level' : '');
      const labelDiv = document.createElement('div');
      labelDiv.className = 'bs-label';
      labelDiv.textContent = label;
      const valueDiv = document.createElement('div');
      valueDiv.className = 'bs-value';
      valueDiv.textContent = value;
      box.appendChild(labelDiv);
      box.appendChild(valueDiv);
      pandaBattleValues.appendChild(box);
    });

    if(statPoints > 0){
      pandaStatUpgrade.classList.add('visible');
      const upgradeLabel = document.getElementById('panda-stat-upgrade-label');
      upgradeLabel.textContent = `// LEVEL UP! CHOOSE A STAT (${statPoints} available)`;
      pandaStatGrid.innerHTML = '';
      STAT_LABELS.forEach((label, idx) => {
        const btn = document.createElement('button');
        btn.className = 'stat-upgrade-btn';
        btn.textContent = idx === 3 ? `${label} +5%` : `${label} +5`;
        btn.addEventListener('click', () => upgradePandaStat(idx));
        pandaStatGrid.appendChild(btn);
      });
    }else{
      pandaStatUpgrade.classList.remove('visible');
    }
  }else{
    pandaBattleStats.classList.remove('visible');
    pandaStatUpgrade.classList.remove('visible');
  }

  pandaPremiumBtn.disabled = premiumRemaining <= 0;
  pandaPremiumBtn.textContent = premiumRemaining > 0
    ? `Premium Bamboo 🎋 (${premiumRemaining}/5 today)`
    : `Premium Bamboo 🎋 (0/5 — resets daily)`;

  function updatePandaLiveState(){
    const now = Math.floor(Date.now() / 1000);
    const sinceLastFed = lastFed === 0 ? Infinity : now - lastFed;
    const remain = lastFed === 0 ? 0 : (lastFed + PANDA_COOLDOWN_SECONDS) - now;

    let moodText, canFeedNow, moodKey;
    if(lastFed === 0){
      moodText = '// never fed — waiting for first meal';
      canFeedNow = true;
      moodKey = 'neutral';
      pandaCountdown.textContent = 'Ready now ✅';
    }else if(sinceLastFed < PANDA_COOLDOWN_SECONDS){
      moodText = '😊 Full';
      canFeedNow = false;
      moodKey = 'happy';
      pandaCountdown.textContent = `Next free feed in: ${formatCountdown(remain)}`;
    }else if(sinceLastFed < PANDA_STREAK_WINDOW_SECONDS){
      moodText = '🙂 Hungry — ready to feed';
      canFeedNow = true;
      moodKey = 'neutral';
      pandaCountdown.textContent = 'Ready now ✅';
    }else{
      moodText = '😢 Starving — streak will reset';
      canFeedNow = true;
      moodKey = 'sad';
      pandaCountdown.textContent = 'Ready now ✅';
    }
    pandaMood.textContent = moodText;
    pandaFeedBtn.disabled = !canFeedNow;
    pandaFeedBtn.textContent = canFeedNow ? 'Feed 🍃 (free)' : 'Fed — come back later';
    setPandaMood(moodKey);

    if(canFeedNow && pandaCountdownTimer){
      clearInterval(pandaCountdownTimer);
      pandaCountdownTimer = null;
    }
  }

  updatePandaLiveState();
  if(pandaCountdownTimer) clearInterval(pandaCountdownTimer);
  pandaCountdownTimer = setInterval(updatePandaLiveState, 1000);
}

async function loadPandaScreen(address){
  if(pandaCountdownTimer){ clearInterval(pandaCountdownTimer); pandaCountdownTimer = null; }
  if(!PANDA_CONTRACT_ADDRESS){
    pandaMood.textContent = '// Kontrat henüz deploy edilmedi — çok yakında aktif olacak';
    pandaCountdown.textContent = '';
    pandaFeedBtn.disabled = true;
    pandaFeedBtn.textContent = 'Coming Soon';
    pandaPremiumBtn.disabled = true;
    pandaPremiumBtn.textContent = 'Coming Soon';
    pandaStats.innerHTML = '';
    pandaProgressLabel.textContent = '';
    return;
  }
  try{
    const contract = getPandaContract();
    const [stats, profile, battle] = await Promise.all([
      contract.getStats(address),
      contract.getProfile(address),
      contract.getBattleStats(address)
    ]);
    renderPandaStats({
      ...stats,
      name: profile.name,
      variant: profile.variant,
      battleLevel: battle.level,
      attack: battle.attack,
      speed: battle.speed,
      defense: battle.defense,
      luck: battle.luck,
      statPoints: battle.statPoints
    });
  }catch(err){
    pandaMood.textContent = `// Hata: ${err.message || 'veri okunamadı'}`;
  }
}

pandaTaskBtn.addEventListener('click', async () => {
  pandaTaskBtn.disabled = true;
  try{
    if(!connectedAddress){
      pandaTaskBtn.textContent = 'Connecting...';
      connectedAddress = await connectWallet();
      connectBtn.textContent = `Connected: ${shortAddr(connectedAddress)}`;
      airdropTasks.classList.add('visible');
    }
    goToScreen(screenPanda);
    await loadPandaScreen(connectedAddress);
  }catch(err){
    alert(err.message || 'Bağlantı başarısız.');
  }
  pandaTaskBtn.textContent = 'Feed Panda';
  pandaTaskBtn.disabled = false;
});

pandaFeedBtn.addEventListener('click', async () => {
  if(!PANDA_CONTRACT_ADDRESS || !connectedAddress) return;
  pandaFeedBtn.disabled = true;
  const originalText = pandaFeedBtn.textContent;
  pandaFeedBtn.textContent = 'Confirm in wallet...';
  try{
    const contract = getPandaContract();
    const tx = await sendWithAttribution(contract, 'feed');
    pandaFeedBtn.textContent = 'Feeding...';
    await tx.wait();
    await loadPandaScreen(connectedAddress);
    setPandaMood('happy');
    triggerPandaBounce();
  }catch(err){
    const reason = err?.reason || err?.error?.message || err?.message || 'İşlem başarısız.';
    alert(reason);
    pandaFeedBtn.textContent = originalText;
    pandaFeedBtn.disabled = false;
  }
});

pandaPremiumBtn.addEventListener('click', async () => {
  if(!PANDA_CONTRACT_ADDRESS || !connectedAddress) return;
  pandaPremiumBtn.disabled = true;
  const originalText = pandaPremiumBtn.textContent;
  pandaPremiumBtn.textContent = 'Confirm in wallet...';
  try{
    const contract = getPandaContract();
    const priceWei = await contract.premiumPriceWei();
    const tx = await sendWithAttribution(contract, 'feedPremium', [{ value: priceWei }]);
    pandaPremiumBtn.textContent = 'Feeding...';
    await tx.wait();
    await loadPandaScreen(connectedAddress);
    setPandaMood('happy');
    triggerPandaBounce();
  }catch(err){
    const reason = err?.reason || err?.error?.message || err?.message || 'İşlem başarısız.';
    alert(reason);
    pandaPremiumBtn.textContent = originalText;
    pandaPremiumBtn.disabled = false;
  }
});

pandaNameBtn.addEventListener('click', async () => {
  if(!PANDA_CONTRACT_ADDRESS || !connectedAddress) return;
  const name = pandaNameInput.value.trim();
  if(!name){
    alert('Bir isim yaz.');
    return;
  }
  if(name.length > 20){
    alert('İsim en fazla 20 karakter olabilir.');
    return;
  }
  pandaNameBtn.disabled = true;
  const originalText = pandaNameBtn.textContent;
  pandaNameBtn.textContent = 'Confirm in wallet...';
  try{
    const contract = getPandaContract();
    const tx = await sendWithAttribution(contract, 'setName', [name]);
    pandaNameBtn.textContent = 'Saving...';
    await tx.wait();
    await loadPandaScreen(connectedAddress);
  }catch(err){
    const reason = err?.reason || err?.error?.message || err?.message || 'İşlem başarısız.';
    alert(reason);
  }
  pandaNameBtn.textContent = originalText;
  pandaNameBtn.disabled = false;
});

async function selectPandaVariant(variantIdx){
  if(!PANDA_CONTRACT_ADDRESS || !connectedAddress) return;
  const buttons = pandaVariantGrid.querySelectorAll('.variant-btn');
  buttons.forEach(b => b.disabled = true);
  const clickedBtn = buttons[variantIdx];
  const originalText = clickedBtn ? clickedBtn.textContent : '';
  if(clickedBtn) clickedBtn.textContent = 'Confirm in wallet...';
  try{
    const contract = getPandaContract();
    const tx = await sendWithAttribution(contract, 'setVariant', [variantIdx]);
    if(clickedBtn) clickedBtn.textContent = 'Saving...';
    await tx.wait();
    await loadPandaScreen(connectedAddress);
  }catch(err){
    const reason = err?.reason || err?.error?.message || err?.message || 'İşlem başarısız.';
    alert(reason);
    if(clickedBtn) clickedBtn.textContent = originalText;
    buttons.forEach(b => b.disabled = false);
  }
}

async function upgradePandaStat(statIdx){
  if(!PANDA_CONTRACT_ADDRESS || !connectedAddress) return;
  const buttons = pandaStatGrid.querySelectorAll('.stat-upgrade-btn');
  buttons.forEach(b => b.disabled = true);
  const clickedBtn = buttons[statIdx];
  const originalText = clickedBtn ? clickedBtn.textContent : '';
  if(clickedBtn) clickedBtn.textContent = 'Confirm in wallet...';
  try{
    const contract = getPandaContract();
    const tx = await sendWithAttribution(contract, 'upgradeStat', [statIdx]);
    if(clickedBtn) clickedBtn.textContent = 'Saving...';
    await tx.wait();
    await loadPandaScreen(connectedAddress);
    setPandaMood('happy');
    triggerPandaBounce();
  }catch(err){
    const reason = err?.reason || err?.error?.message || err?.message || 'İşlem başarısız.';
    alert(reason);
    if(clickedBtn) clickedBtn.textContent = originalText;
    buttons.forEach(b => b.disabled = false);
  }
}

pandaBackBtn.addEventListener('click', () => {
  if(pandaCountdownTimer){ clearInterval(pandaCountdownTimer); pandaCountdownTimer = null; }
  stopPandaAnimation();
  goToScreen(screenMenu);
});

/* ── Leaderboard ───────────────────────────────────────────────── */
const screenLeaderboard = document.getElementById('screen-leaderboard');
const leaderboardTaskBtn = document.getElementById('leaderboard-task-btn');
const leaderboardBackBtn = document.getElementById('leaderboard-back-btn');
const leaderboardList = document.getElementById('leaderboard-list');

async function loadLeaderboard(){
  leaderboardList.innerHTML = '<span id="leaderboard-loading">// loading leaderboard...</span>';

  if(!PANDA_CONTRACT_ADDRESS){
    leaderboardList.textContent = '// Kontrat henüz deploy edilmedi — çok yakında aktif olacak.';
    return;
  }

  try{
    const provider = new ethers.providers.JsonRpcProvider('https://mainnet.base.org');
    const contract = new ethers.Contract(PANDA_CONTRACT_ADDRESS, PANDA_ABI, provider);

    const owners = await contract.getAllOwners();
    if(!owners || owners.length === 0){
      leaderboardList.textContent = '// Henüz kimse beslenmemiş — ilk sen ol!';
      return;
    }

    const entries = await Promise.all(owners.map(async (addr) => {
      try{
        const [s, profile] = await Promise.all([
          contract.getStats(addr),
          contract.getProfile(addr)
        ]);
        return { address: addr, name: profile.name || '', xp: Number(s.xp) };
      }catch(e){
        return null;
      }
    }));

    const ranked = entries
      .filter(e => e !== null)
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 20);

    leaderboardList.innerHTML = '';
    ranked.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';

      const rank = document.createElement('span');
      rank.className = 'lb-rank' + (i < 3 ? ' lb-top' : '');
      rank.textContent = `#${i + 1}`;

      const name = document.createElement('span');
      name.className = 'lb-name';
      // Güvenlik: name kullanıcı tarafından (on-chain) belirlenmiş olabilir —
      // textContent kullanılıyor, innerHTML KULLANILMIYOR (XSS koruması).
      name.textContent = entry.name ? entry.name : shortAddr(entry.address);

      const xp = document.createElement('span');
      xp.className = 'lb-xp';
      xp.textContent = `${entry.xp} XP`;

      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(xp);
      leaderboardList.appendChild(row);
    });
  }catch(err){
    leaderboardList.textContent = `// Hata: ${err.message || 'liderlik tablosu yüklenemedi'}`;
  }
}

leaderboardTaskBtn.addEventListener('click', () => {
  goToScreen(screenLeaderboard);
  loadLeaderboard();
});

leaderboardBackBtn.addEventListener('click', () => {
  goToScreen(screenMenu);
});

function wait(min, max){
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(res => setTimeout(res, ms));
}

/* ── ses efekti (Web Audio API, dışarıdan dosya gerektirmez) ─── */
let audioCtx = null;
let soundEnabled = true;

function initAudio(){
  if(!audioCtx){
    try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ audioCtx = null; }
  }
}

function playTick(){
  if(!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1150 + Math.random() * 250;
  gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.02);
}

const soundToggle = document.getElementById('sound-toggle');
soundToggle.addEventListener('click', () => {
  initAudio();
  soundEnabled = !soundEnabled;
  soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
});

/* Karakter karakter "daktilo" efekti ile bir satır yazdırır */
async function addRow(text, cls){
  const div = document.createElement('div');
  div.className = 'row ' + (cls || '');
  activeTerminal.appendChild(div);

  const cursor = document.createElement('span');
  cursor.className = 'type-cursor';

  for(let i = 0; i < text.length; i++){
    div.textContent = text.slice(0, i + 1);
    div.appendChild(cursor);
    if(text[i] !== ' ') playTick();
    await wait(14, 32);
  }
  cursor.remove();

  return wait(700, 1000);
}

/* Etiket + değer içeren satırı yazar, yazım bitince etiketi renklendirir.
   Güvenlik notu: innerHTML KULLANILMIYOR — value dışarıdan (örn. Basename API'si)
   gelebileceği için textContent ile güvenli DOM oluşturuluyor (XSS koruması). */
async function addFieldRow(label, value){
  const full = `${label} ${value}`;
  await addRow(full, 'value');
  const rows = activeTerminal.querySelectorAll('.row');
  const last = rows[rows.length - 1];
  last.textContent = '';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'label';
  labelSpan.textContent = label;
  last.appendChild(labelSpan);
  last.appendChild(document.createTextNode(' ' + value));
}

let rateLimitNotified = false;

async function apiCall(params, attempt = 1){
  const url = `${API_BASE}?${params}`;
  const res = await fetch(url);

  if(res.status === 429 || res.status === 503){
    if(attempt <= 4){
      if(!rateLimitNotified){
        rateLimitNotified = true;
        const row = document.createElement('div');
        row.className = 'row warn';
        row.textContent = '⏳ Sunucu yoğun, lütfen bekleyin — otomatik tekrar deneniyor...';
        activeTerminal.appendChild(row);
      }
      await wait(1400 * attempt, 1800 * attempt);
      return apiCall(params, attempt + 1);
    }
    throw new Error('Rate limit exceeded — lütfen birkaç dakika sonra tekrar deneyin.');
  }

  if(!res.ok) throw new Error('network');
  const data = await res.json();

  const msgText = `${data.message || ''} ${data.result || ''}`.toLowerCase();
  if(/rate limit|too many requests/.test(msgText)){
    if(attempt <= 4){
      if(!rateLimitNotified){
        rateLimitNotified = true;
        const row = document.createElement('div');
        row.className = 'row warn';
        row.textContent = '⏳ Sunucu yoğun, lütfen bekleyin — otomatik tekrar deneniyor...';
        activeTerminal.appendChild(row);
      }
      await wait(1400 * attempt, 1800 * attempt);
      return apiCall(params, attempt + 1);
    }
    throw new Error('Rate limit exceeded — lütfen birkaç dakika sonra tekrar deneyin.');
  }

  return data;
}

async function fetchEthPrice(){
  try{
    const res = await fetch(COINGECKO_PRICE_URL);
    const data = await res.json();
    return Number(data?.ethereum?.usd || 0);
  }catch(e){
    return 0;
  }
}

async function fetchBasename(address){
  try{
    const res = await fetch(`https://api.web3.bio/profile/basenames/${address}`);
    if(!res.ok) return null;
    const data = await res.json();
    const profile = Array.isArray(data) ? data[0] : data;
    if(!profile || profile.error) return null;
    return profile.identity || profile.displayName || null;
  }catch(e){
    return null;
  }
}

/*
 * Airdrop tahmini — resmi bir $BASE airdrop'u şu an duyurulmadığı için
 * bu, cüzdan metriklerine dayalı SİMÜLE EDİLMİŞ / TAHMİNİ bir puandır.
 * Gerçek bir dağıtım miktarı ya da garantisi değildir.
 *
 * Metodoloji, geçmişteki büyük L2 airdrop'larının (Arbitrum ARB, Optimism OP,
 * zkSync ZK) kamuya açık kriterlerinden esinlenilmiştir:
 *   - Arbitrum: puan bazlı sistem — işlem sayısı, köprü (bridge) kullanımı,
 *     kullanım süresi, ve FARKLI AYLARDA işlem yapmış olmak (süreklilik) ekstra
 *     ağırlık kazandırdı ("6 farklı ayda işlem yapanlar çok daha yüksek pay aldı").
 *   - Optimism: erken kullanıcı + tekrarlayan aktivite + governance/topluluk sinyali.
 *   - Genel pattern: tek seferlik/az sayıda işlem yapan "sybil" cüzdanlar düşük puan,
 *     çeşitli ve süreklilik gösteren cüzdanlar yüksek puan alır.
 *
 * Puanlama kasıtlı olarak CÖMERT tutulmuştur (gerçek kampanyalardan daha
 * kolay üst tier'lara ulaşılabilir) — bu bir eğlence/simülasyon aracıdır.
 */
function calculateAirdrop(d, basename){
  const breakdown = [];

  const activityPts = Math.round(Math.min(d.txCount, 1500) * 0.9);
  breakdown.push({
    label: 'Activity Volume',
    points: activityPts,
    note: `${d.txCount} tx — network kullanım hacmi`
  });

  const longevityPts = Math.round(Math.min(d.walletAgeDays, 730) * 1.1);
  breakdown.push({
    label: 'Longevity',
    points: longevityPts,
    note: `${d.walletAgeDays} gün — erken/uzun süreli kullanıcı sinyali`
  });

  const consistencyPts = Math.round(
    Math.min(d.activeDaysCount, 365) * 1.6 +
    Math.min(d.distinctMonthsActive || 0, 12) * 55
  );
  breakdown.push({
    label: 'Consistency',
    points: consistencyPts,
    note: `${d.distinctMonthsActive || 0} farklı ayda aktif — Arbitrum tarzı süreklilik bonusu`
  });

  const gasPts = Math.round(Math.min(d.gasSpentEth * 25000, 900));
  breakdown.push({
    label: 'Gas Contribution',
    points: gasPts,
    note: `${d.gasSpentEth.toFixed(4)} ETH — gerçek ağ kullanımı / fee katkısı`
  });

  const assetPts = Math.round(Math.min(d.totalAssetsUsd, 5000) * 0.1);
  breakdown.push({
    label: 'Asset Commitment',
    points: assetPts,
    note: `$${fmtNum(d.totalAssetsUsd)} — sermaye bağlılığı`
  });

  const nftPts = Math.round(Math.min(d.nftCount, 50) * 6);
  breakdown.push({
    label: 'Ecosystem Diversity',
    points: nftPts,
    note: `${d.nftCount} NFT — ekosistem içi çeşitlilik`
  });

  const rawScore = activityPts + longevityPts + consistencyPts + gasPts + assetPts + nftPts;

  const identityPts = basename ? Math.round(rawScore * 0.15) : 0;
  breakdown.push({
    label: 'Identity Bonus',
    points: identityPts,
    note: basename ? `Basename sahibi (${basename}) — topluluk kimliği / sybil-direnç sinyali` : 'Basename yok — bonus uygulanmadı'
  });

  const totalScore = rawScore + identityPts;
  const baseAmount = Math.max(0, Math.round(totalScore * 1.9));

  let tier = "Low";
  if(baseAmount >= 4500) tier = "Elite";
  else if(baseAmount >= 2000) tier = "High";
  else if(baseAmount >= 700) tier = "Medium";

  return { amount: baseAmount, tier, hasBasename: !!basename, breakdown, totalScore };
}

function isValidAddress(a){
  return /^0x[a-fA-F0-9]{40}$/.test(a.trim());
}

function fmtNum(n, decimals = 2){
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function shortAddr(a){
  return a.slice(0,6) + '....' + a.slice(-4);
}

async function fetchWalletData(address){
  const [balanceRes, txRes, usdcRes, ethPriceUsd, nftRes, basename] = await Promise.all([
    apiCall(`module=account&action=balance&address=${address}&tag=latest`),
    apiCall(`module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc`),
    apiCall(`module=account&action=tokenbalance&contractaddress=${USDC_CONTRACT}&address=${address}&tag=latest`),
    fetchEthPrice(),
    apiCall(`module=account&action=tokennfttx&address=${address}&sort=asc`),
    fetchBasename(address)
  ]);

  if(balanceRes.status !== "1" && balanceRes.message !== "No transactions found"){
    throw new Error(`${balanceRes.message || 'API error'}: ${balanceRes.result || ''}`);
  }

  const ethBalance = Number(balanceRes.result || 0) / 1e18;
  const ethPrice = Number(ethPriceUsd || 0);
  const usdcRaw = (usdcRes && typeof usdcRes.result === 'object' && usdcRes.result !== null)
    ? usdcRes.result.balance
    : usdcRes.result;
  const usdcBalance = Number(usdcRaw || 0) / 1e6;

  const txs = Array.isArray(txRes.result) ? txRes.result : [];
  const txCount = txs.length;

  let walletAgeDays = 0;
  let lastTxAgoText = "N/A";
  let activeDaysCount = 0;
  let mostActiveMonth = "N/A";
  let gasSpentEth = 0;

  if(txCount > 0){
    const firstTs = Number(txs[0].timeStamp) * 1000;
    const lastTs = Number(txs[txCount - 1].timeStamp) * 1000;
    const now = Date.now();

    walletAgeDays = Math.floor((now - firstTs) / 86400000);

    const hoursAgo = Math.max(1, Math.floor((now - lastTs) / 3600000));
    lastTxAgoText = hoursAgo < 24 ? `${hoursAgo} saat önce` : `${Math.floor(hoursAgo/24)} gün önce`;

    const dateSet = new Set();
    const monthCount = {};
    for(const tx of txs){
      const d = new Date(Number(tx.timeStamp) * 1000);
      dateSet.add(d.toISOString().slice(0,10));
      const monthKey = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      monthCount[monthKey] = (monthCount[monthKey] || 0) + 1;

      if(tx.from && tx.from.toLowerCase() === address.toLowerCase()){
        const gasUsed = Number(tx.gasUsed || 0);
        const gasPrice = Number(tx.gasPrice || 0);
        gasSpentEth += (gasUsed * gasPrice) / 1e18;
      }
    }
    activeDaysCount = dateSet.size;
    var distinctMonthsActive = Object.keys(monthCount).length;

    let maxCount = 0;
    for(const [month, count] of Object.entries(monthCount)){
      if(count > maxCount){ maxCount = count; mostActiveMonth = month; }
    }
  }
  var distinctMonthsActive = typeof distinctMonthsActive === 'undefined' ? 0 : distinctMonthsActive;

  // NFT holdings (net of transfers in/out)
  const nftTxs = Array.isArray(nftRes.result) ? nftRes.result : [];
  const held = new Set();
  for(const t of nftTxs){
    const key = `${t.contractAddress}:${t.tokenID}`;
    if(t.to && t.to.toLowerCase() === address.toLowerCase()) held.add(key);
    if(t.from && t.from.toLowerCase() === address.toLowerCase()) held.delete(key);
  }
  const nftCount = held.size;

  const ethUsdValue = ethBalance * ethPrice;
  const totalAssetsUsd = ethUsdValue + usdcBalance;

  // Basit sezgisel risk skoru (gerçek bir güvenlik denetimi değildir)
  let riskScore = "Medium";
  if(walletAgeDays > 180 && txCount > 50) riskScore = "Low";
  if(walletAgeDays < 14 || txCount < 3) riskScore = "High";

  const airdrop = calculateAirdrop({
    txCount, walletAgeDays, activeDaysCount, gasSpentEth, nftCount, totalAssetsUsd, distinctMonthsActive
  }, basename);

  return {
    address,
    walletAgeDays,
    txCount,
    activeDaysCount,
    currentBalanceUsd: ethUsdValue,
    ethBalance,
    usdcBalance,
    totalAssetsUsd,
    nftCount,
    gasSpentEth,
    mostActiveMonth,
    lastTxAgoText,
    riskScore,
    basename,
    airdrop
  };
}

async function runStatusSequence(){
  const lines = [
    "Connecting to Base Network...",
    "Wallet detected.",
    "Fetching transaction history...",
    "Reading wallet metadata...",
    "Calculating wallet age...",
    "Checking balances...",
    "Analyzing activity...",
    "Scan completed."
  ];
  for(const line of lines){
    await addRow(line, 'status');
  }
}

function addSection(title){
  const div = document.createElement('div');
  div.className = 'row section';
  div.textContent = title;
  activeTerminal.appendChild(div);
}

async function showAirdropBreakdown(data){
  addSection('SCORE BREAKDOWN');
  for(const item of data.airdrop.breakdown){
    const sign = item.points > 0 ? '+' : '';
    await addFieldRow(`${item.label}:`, `${sign}${item.points} pts`);
  }
  await addFieldRow('Total Score:', `${data.airdrop.totalScore} pts`);
}

async function showAirdropBox(data){
  await showAirdropBreakdown(data);

  await wait(700, 1000);
  const box = document.createElement('div');
  box.className = 'airdrop-box';
  box.innerHTML = `
    <div class="ad-label">ESTIMATED AIRDROP</div>
    <div class="ad-amount">~${fmtNum(data.airdrop.amount, 0)} $BASE</div>
    <div class="ad-note">Tier: ${data.airdrop.tier}${data.basename ? ' · Basename bonus applied' : ''} — tahmini, resmi değil</div>
  `;
  activeTerminal.appendChild(box);

  await wait(500, 700);
  const shareBtn = document.createElement('button');
  shareBtn.className = 'share-btn';
  shareBtn.textContent = 'Share on X';
  shareBtn.addEventListener('click', () => shareResult(data));
  activeTerminal.appendChild(shareBtn);

  await askIncreaseAirdrop();
}

/* ── Cüzdan bağlama (MetaMask / Coinbase Wallet / EIP-1193) ─────── */
async function connectWallet(){
  if(!window.ethereum){
    throw new Error('Cüzdan bulunamadı. MetaMask veya Coinbase Wallet uygulaması içinden açmayı dene.');
  }

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if(!accounts || accounts.length === 0){
    throw new Error('Cüzdan bağlantısı reddedildi.');
  }

  const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
  if(currentChain !== BASE_CHAIN_ID_HEX){
    try{
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_CHAIN_ID_HEX }]
      });
    }catch(switchErr){
      if(switchErr.code === 4902){
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [BASE_CHAIN_PARAMS]
        });
      }else{
        throw new Error('Base ağına geçiş reddedildi.');
      }
    }
  }

  return accounts[0];
}

/* ── GM / GN — gerçek on-chain kontrat çağrıları ─────────────────── */
let gmgnCountdownTimer = null;

function formatCountdown(seconds){
  if(seconds <= 0) return 'Ready now ✅';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

async function showGmGnSection(walletAddress){
  addSection('GM / GN — ON-CHAIN CHECK-IN');

  if(!GMGN_CONTRACT_ADDRESS){
    await addRow('Kontrat henüz deploy edilmedi — çok yakında aktif olacak.', 'status');
    return;
  }

  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  const contract = new ethers.Contract(GMGN_CONTRACT_ADDRESS, GMGN_ABI, signer);

  let lastGm = 0, lastGn = 0;
  try{
    const s = await contract.getStats(walletAddress);
    await addFieldRow('Current GM Streak:', `${s.gmStreak} 🔥`);
    await addFieldRow('Current GN Streak:', `${s.gnStreak} 🌙`);
    lastGm = Number(s.lastGm);
    lastGn = Number(s.lastGn);
  }catch(e){
    await addRow('Streak verisi okunamadı, yine de check-in yapabilirsin.', 'status');
  }

  const gmCountdownEl = document.createElement('div');
  gmCountdownEl.className = 'row value';
  const gnCountdownEl = document.createElement('div');
  gnCountdownEl.className = 'row value';
  activeTerminal.appendChild(gmCountdownEl);
  activeTerminal.appendChild(gnCountdownEl);

  const wrap = document.createElement('div');
  wrap.className = 'choice-row';

  const gmBtn = document.createElement('button');
  gmBtn.className = 'choice-btn yes';
  gmBtn.textContent = 'GM ☀️';

  const gnBtn = document.createElement('button');
  gnBtn.className = 'choice-btn yes';
  gnBtn.textContent = 'GN 🌙';

  wrap.appendChild(gmBtn);
  wrap.appendChild(gnBtn);
  activeTerminal.appendChild(wrap);

  function updateGmGnCountdown(){
    const now = Math.floor(Date.now() / 1000);
    const gmRemain = (lastGm + GMGN_COOLDOWN_SECONDS) - now;
    const gnRemain = (lastGn + GMGN_COOLDOWN_SECONDS) - now;
    gmCountdownEl.textContent = `Next GM: ${lastGm === 0 ? 'Ready now ✅' : formatCountdown(gmRemain)}`;
    gnCountdownEl.textContent = `Next GN: ${lastGn === 0 ? 'Ready now ✅' : formatCountdown(gnRemain)}`;
    gmBtn.disabled = lastGm !== 0 && gmRemain > 0;
    gnBtn.disabled = lastGn !== 0 && gnRemain > 0;
  }
  updateGmGnCountdown();
  if(gmgnCountdownTimer) clearInterval(gmgnCountdownTimer);
  gmgnCountdownTimer = setInterval(updateGmGnCountdown, 1000);

  const doCheckIn = async (type, btn) => {
    btn.disabled = true;
    try{
      await addRow(`${type.toUpperCase()} işlemi gönderiliyor, cüzdanda onayla...`, 'status');
      const tx = await sendWithAttribution(contract, type);
      await addRow('İşlem onaylanıyor...', 'status');
      await tx.wait();
      await addRow(`${type.toUpperCase()} başarılı! Streak güncellendi.`, 'value');
      const now = Math.floor(Date.now() / 1000);
      if(type === 'gm') lastGm = now; else lastGn = now;
      updateGmGnCountdown();
    }catch(err){
      const reason = err?.reason || err?.error?.message || err?.message || 'İşlem başarısız.';
      await addRow(`Hata: ${reason}`, 'err');
    }
    btn.disabled = false;
  };

  gmBtn.addEventListener('click', () => doCheckIn('gm', gmBtn));
  gnBtn.addEventListener('click', () => doCheckIn('gn', gnBtn));
}

async function askIncreaseAirdrop(){
  await wait(900, 1200);
  await addRow('Do you want to increase your Airdrop?', 'status');

  const wrap = document.createElement('div');
  wrap.className = 'choice-row';

  const yesBtn = document.createElement('button');
  yesBtn.className = 'choice-btn yes';
  yesBtn.textContent = 'Yes';

  const noBtn = document.createElement('button');
  noBtn.className = 'choice-btn no';
  noBtn.textContent = 'No';

  wrap.appendChild(yesBtn);
  wrap.appendChild(noBtn);
  activeTerminal.appendChild(wrap);

  return new Promise((resolve) => {
    const finish = async (answer) => {
      yesBtn.disabled = true; noBtn.disabled = true;
      wrap.classList.add('answered');
      if(answer === 'yes'){
        try{
          await addRow('Connecting wallet...', 'status');
          const address = await connectWallet();
          await addRow(`Wallet connected: ${shortAddr(address)}`, 'value');
          await showGmGnSection(address);
        }catch(err){
          await addRow(`Error: ${err.message || 'Bağlantı başarısız.'}`, 'err');
        }
      }else{
        await addRow('Ok, maybe next time.', 'status');
      }
      resolve();
    };
    yesBtn.addEventListener('click', () => finish('yes'));
    noBtn.addEventListener('click', () => finish('no'));
  });
}

/* ── paylaşım kartı görseli oluşturma ───────────────────── */
async function buildShareImageBlob(data){
  try{ await document.fonts.load('700 40px "Share Tech Mono"'); }catch(e){}
  try{ await document.fonts.load('400 20px "Share Tech Mono"'); }catch(e){}

  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const BLUE = '#0052FF';
  const DIM = '#3A5DBF';
  const FAINT = '#0d1524';

  // arka plan
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  // hafif grid
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  for(let x = 0; x < W; x += 40){
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for(let y = 0; y < H; y += 40){
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // dış çerçeve
  ctx.strokeStyle = '#12203a';
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  // pencere başlığı
  ctx.fillStyle = FAINT;
  ctx.fillRect(30, 30, W - 60, 46);
  ctx.fillStyle = BLUE;
  ctx.beginPath(); ctx.arc(56, 53, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a2a4a';
  ctx.beginPath(); ctx.arc(74, 53, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(92, 53, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = DIM;
  ctx.font = '16px "Share Tech Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('root@base:~/scan', W - 50, 58);

  ctx.textAlign = 'left';

  // etiket
  ctx.fillStyle = '#5C8CFF';
  ctx.font = '20px "Share Tech Mono", monospace';
  ctx.fillText('// ESTIMATED AIRDROP', 70, 150);

  // büyük miktar (glow)
  ctx.shadowColor = 'rgba(0,82,255,0.6)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = BLUE;
  ctx.font = 'bold 92px "Share Tech Mono", monospace';
  ctx.fillText(`~${fmtNum(data.airdrop.amount, 0)} $BASE`, 68, 250);
  ctx.shadowBlur = 0;

  // tier / not
  ctx.fillStyle = DIM;
  ctx.font = '22px "Share Tech Mono", monospace';
  ctx.fillText(`Tier: ${data.airdrop.tier}${data.basename ? '  ·  Basename bonus' : ''}  —  tahmini, resmi değil`, 70, 300);

  // ayraç
  ctx.strokeStyle = FAINT;
  ctx.beginPath(); ctx.moveTo(70, 340); ctx.lineTo(W - 70, 340); ctx.stroke();

  // alt metrik satırı
  const metrics = [
    ['WALLET', shortAddr(data.address)],
    ['AGE', `${data.walletAgeDays}d`],
    ['TXS', `${data.txCount}`],
    ['RISK', data.riskScore],
  ];
  const colW = (W - 140) / metrics.length;
  metrics.forEach(([label, value], i) => {
    const x = 70 + i * colW;
    ctx.fillStyle = '#5C8CFF';
    ctx.font = '16px "Share Tech Mono", monospace';
    ctx.fillText(label, x, 385);
    ctx.fillStyle = BLUE;
    ctx.font = 'bold 26px "Share Tech Mono", monospace';
    ctx.fillText(value, x, 418);
  });

  // alt: ASCII kare logo + BASE
  ctx.fillStyle = BLUE;
  ctx.fillRect(W/2 - 26, H - 150, 52, 52);
  ctx.fillStyle = BLUE;
  ctx.font = '28px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '8px';
  ctx.fillText('BASE', W/2, H - 70);
  ctx.letterSpacing = '0px';

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function shareResult(data){
  const blob = await buildShareImageBlob(data);
  const fileName = 'base-airdrop-scan.png';
  const file = new File([blob], fileName, { type: 'image/png' });

  const text = `Base cüzdanım için tahmini airdrop: ~${fmtNum(data.airdrop.amount,0)} $BASE (${data.airdrop.tier})\n\nSen de kontrol et 👇`;

  if(navigator.canShare && navigator.canShare({ files: [file] })){
    try{
      await navigator.share({ files: [file], text, title: 'Base Airdrop Scan' });
      return;
    }catch(e){ /* kullanıcı iptal etti veya desteklenmiyor, aşağı düş */ }
  }

  // fallback: görseli indir + X compose ekranını hazır metinle aç
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(intent, '_blank', 'noopener,noreferrer');
}

async function showResults(data){
  addSection('IDENTITY');
  await addFieldRow('Wallet Address:', shortAddr(data.address));
  if(data.basename){
    await addFieldRow('Basename:', data.basename);
  }
  await addFieldRow('Network:', 'Base');

  addSection('ACTIVITY');
  await addFieldRow('Wallet Age:', `${data.walletAgeDays} Days`);
  await addFieldRow('Transactions:', `${data.txCount}`);
  await addFieldRow('Active Days:', `${data.activeDaysCount}`);
  await addFieldRow('Most Active Month:', data.mostActiveMonth);
  await addFieldRow('Last Transaction:', data.lastTxAgoText);

  addSection('ASSETS');
  await addFieldRow('Current Balance:', `$${fmtNum(data.currentBalanceUsd)}`);
  await addFieldRow('ETH Balance:', `${fmtNum(data.ethBalance, 4)} ETH`);
  await addFieldRow('USDC:', `${fmtNum(data.usdcBalance)}`);
  await addFieldRow('Total Assets:', `$${fmtNum(data.totalAssetsUsd)}`);
  await addFieldRow('NFT Count:', `${data.nftCount}`);
  await addFieldRow('Gas Spent:', `${fmtNum(data.gasSpentEth, 4)} ETH`);

  addSection('SCORE');
  await addFieldRow('Risk Score:', data.riskScore);
  await showAirdropBox(data);

  const cursor = document.createElement('span');
  cursor.className = 'end-cursor';
  activeTerminal.appendChild(cursor);
}

async function startScan(address){
  input.style.display = 'none';
  document.body.classList.add('scanning');
  terminalWindow.style.display = 'block';
  activeTerminal = terminal;
  activeTerminal.innerHTML = '';
  rateLimitNotified = false;

  const statusPromise = runStatusSequence();
  const dataPromise = fetchWalletData(address).catch(err => ({ __error: true, __msg: (err && err.message) || 'unknown' }));

  const [, data] = await Promise.all([statusPromise, dataPromise]);

  if(!data || data.__error){
    await addRow(`Error: Wallet verisi alınamadı.`, 'err');
    await addRow(`Detay: ${data.__msg}`, 'err');
    return;
  }

  await showResults(data);
}

input.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    const value = input.value.trim();
    if(!isValidAddress(value)){
      input.value = '';
      input.placeholder = 'Geçersiz adres — tekrar deneyin';
      return;
    }
    initAudio();
    startScan(value);
  }
});

input.addEventListener('focus', () => input.select());
