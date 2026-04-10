import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import multer from 'multer';
import { SERVER_HOST, SERVER_PORT, ASSETS_DIR, PET_STATES, DETECTION_INTERVAL, ADMIN_SECRET, PETS_BASE_DIR, VOLC_BASE_URL, VISION_MODEL, getHeaders } from './config';
import { generatePetAssets } from './generator/pipeline';
import { detectPetState } from './detector/detect_state';
import {
  getCodes, saveCodes, generateCode,
  getPets, savePets, generatePetId, ensurePetDir, getPetDir,
  getLikes, saveLikes,
  getReminders, saveReminders,
  type PetRecord, type CodeRecord, type LikeRecord, type Reminder,
} from './data/store';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// --- TTS ---
const TTS_DIR = path.join(ASSETS_DIR, 'tts');
if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true });

// Voice clone speaker IDs: petId -> cloned voice speaker ID
const VOICE_CLONE_MAP: Record<string, string> = {
  '7iwnvs7e': 'S_hjqRy6eX1',  // 乔瑟夫·乔斯达
};
const VOICE_CLONE_API_KEY = process.env.VOICE_CLONE_API_KEY || '';

// Voice clone TTS via V1 API (for cloned voices)
async function textToSpeechClone(text: string, speakerId: string): Promise<string | null> {
  try {
    const reqid = `clone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const resp = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': VOICE_CLONE_API_KEY,
      },
      body: JSON.stringify({
        app: { cluster: 'volcano_icl' },
        user: { uid: 'desktop_pet' },
        audio: { voice_type: speakerId, encoding: 'mp3', speed_ratio: 1.0 },
        request: { reqid, text, operation: 'query' },
      }),
    });
    if (!resp.ok) { console.error('[TTS-Clone] HTTP error:', resp.status); return null; }
    const data = await resp.json() as any;
    if (data.code !== 3000 || !data.data) {
      console.error('[TTS-Clone] Error:', data.code, data.message);
      return null;
    }
    const audio = Buffer.from(data.data, 'base64');
    const filename = `tts_${Date.now()}.mp3`;
    fs.writeFileSync(path.join(TTS_DIR, filename), audio);
    console.log(`[TTS-Clone] ${speakerId} -> ${audio.length} bytes -> ${filename}`);
    const files = fs.readdirSync(TTS_DIR).filter(f => f.endsWith('.mp3')).sort();
    while (files.length > 50) { fs.unlinkSync(path.join(TTS_DIR, files.shift()!)); }
    return `/api/tts/${filename}`;
  } catch (err) {
    console.error('[TTS-Clone] Error:', err);
    return null;
  }
}

async function textToSpeech(text: string, petId?: string): Promise<string | null> {
  // Use cloned voice if available for this pet
  if (petId && VOICE_CLONE_MAP[petId]) {
    return textToSpeechClone(text, VOICE_CLONE_MAP[petId]);
  }
  try {
    const resp = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Access-Key': process.env.TTS_ACCESS_KEY || '',
        'X-Api-App-Key': process.env.TTS_APP_KEY || '',
        'X-Api-Resource-Id': 'seed-tts-2.0',
      },
      body: JSON.stringify({
        user: { uid: 'desktop_pet' },
        req_params: {
          text,
          speaker: 'zh_female_xiaohe_uranus_bigtts',
          audio_params: { format: 'mp3', sample_rate: 24000 },
        },
      }),
    });
    if (!resp.ok) { console.error('[TTS] HTTP error:', resp.status); return null; }
    const body = await resp.text();
    const lines = body.split('\n').filter(l => l.trim());
    const audioParts: Buffer[] = [];
    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        if (chunk.data) audioParts.push(Buffer.from(chunk.data, 'base64'));
      } catch {}
    }
    if (audioParts.length === 0) { console.error('[TTS] No audio data in response'); return null; }
    const audio = Buffer.concat(audioParts);
    const filename = `tts_${Date.now()}.mp3`;
    fs.writeFileSync(path.join(TTS_DIR, filename), audio);
    console.log(`[TTS] Generated ${audio.length} bytes -> ${filename}`);
    // Clean up old files (keep last 50)
    const files = fs.readdirSync(TTS_DIR).filter(f => f.endsWith('.mp3')).sort();
    while (files.length > 50) { fs.unlinkSync(path.join(TTS_DIR, files.shift()!)); }
    return `/api/tts/${filename}`;
  } catch (err) {
    console.error('[TTS] Error:', err);
    return null;
  }
}

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

app.use(express.json());
app.use('/api/tts', express.static(TTS_DIR));

// ---- Traffic stats ----
interface DayStats {
  date: string;
  requests: number;
  bytesOut: number;
  uniqueIPs: Set<string>;
  electronIPs: Set<string>;
  browserIPs: Set<string>;
  paths: Record<string, number>;
}

const statsHistory: DayStats[] = [];

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getTodayStats(): DayStats {
  const today = getToday();
  let s = statsHistory.find(d => d.date === today);
  if (!s) {
    s = { date: today, requests: 0, bytesOut: 0, uniqueIPs: new Set(), electronIPs: new Set(), browserIPs: new Set(), paths: {} };
    statsHistory.push(s);
    // Keep only 30 days
    while (statsHistory.length > 30) statsHistory.shift();
  }
  return s;
}

// Track request stats
app.use((req, res, next) => {
  const stats = getTodayStats();
  stats.requests++;
  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
  if (ip) stats.uniqueIPs.add(ip);
  // Simplify path for grouping
  const p = req.path.replace(/\/[a-z0-9]{8}\//g, '/:id/').replace(/\/(sitting|sleeping|eating|moving)\./g, '/:state.');
  stats.paths[p] = (stats.paths[p] || 0) + 1;

  // Track response bytes
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  res.write = function(chunk: any, ...args: any[]) {
    if (chunk) stats.bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return origWrite(chunk, ...args);
  } as any;
  const originalEnd = res.end;
  res.end = function(chunk?: any, ...args: any[]) {
    if (chunk) stats.bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return originalEnd.call(res, chunk, ...args);
  } as any;

  next();
});

// Client type heartbeat — frontend calls this on load
app.post('/api/heartbeat', (req, res) => {
  const stats = getTodayStats();
  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
  const client = req.body?.client; // 'electron' or 'browser'
  if (ip) {
    if (client === 'electron') stats.electronIPs.add(ip);
    else stats.browserIPs.add(ip);
  }
  res.json({ ok: true });
});

// Dynamic multer storage — per-pet upload directory
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const petId = req.params.petId;
    const uploadDir = path.join(PETS_BASE_DIR, petId, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// ---- Per-pet in-memory state ----

interface GenerationState {
  status: 'idle' | 'generating' | 'ready' | 'error';
  stage: string;
  progress: number;
  message: string;
  manifest: Record<string, any> | null;
}

interface PetInstance {
  id: string;
  generationState: GenerationState;
  currentPetState: string;
  mockTimer: ReturnType<typeof setInterval> | null;
  wsConnections: Set<WebSocket>;
}

const petInstances = new Map<string, PetInstance>();

function getPetInstance(petId: string): PetInstance | null {
  if (petInstances.has(petId)) return petInstances.get(petId)!;
  // Check if pet exists on disk
  const pets = getPets();
  if (!pets[petId]) return null;
  // Hydrate from disk
  const inst: PetInstance = {
    id: petId,
    generationState: {
      status: 'idle',
      stage: '',
      progress: 0,
      message: '',
      manifest: null,
    },
    currentPetState: 'sitting',
    mockTimer: null,
    wsConnections: new Set(),
  };
  // Check if manifest exists → mark as ready
  const manifestPath = path.join(PETS_BASE_DIR, petId, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    inst.generationState.status = 'ready';
    inst.generationState.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }
  petInstances.set(petId, inst);
  return inst;
}

function broadcastToPet(petId: string, message: Record<string, any>) {
  const inst = petInstances.get(petId);
  if (!inst) return;
  const data = JSON.stringify(message);
  for (const ws of inst.wsConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// ---- WebSocket ----

// Map ws -> petId for cleanup
const wsSubscriptions = new Map<WebSocket, string>();

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'subscribe' && msg.petId) {
        // Unsubscribe from previous pet
        const prevPetId = wsSubscriptions.get(ws);
        if (prevPetId) {
          petInstances.get(prevPetId)?.wsConnections.delete(ws);
        }
        // Subscribe to new pet
        const inst = getPetInstance(msg.petId);
        if (inst) {
          inst.wsConnections.add(ws);
          wsSubscriptions.set(ws, msg.petId);
          // Send current state
          ws.send(JSON.stringify({ type: 'status', ...inst.generationState }));
          // Start reminder scheduler for this pet
          scheduleReminders(msg.petId);
        }
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch {}
  });

  ws.on('close', () => {
    const petId = wsSubscriptions.get(ws);
    if (petId) {
      petInstances.get(petId)?.wsConnections.delete(ws);
      wsSubscriptions.delete(ws);
    }
  });
});

// ---- Admin: Stats Dashboard ----

app.get('/api/admin/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = statsHistory.map(s => ({
    date: s.date,
    requests: s.requests,
    bytesOut: s.bytesOut,
    uniqueVisitors: s.uniqueIPs.size,
    topPaths: Object.entries(s.paths).sort((a, b) => b[1] - a[1]).slice(0, 20),
  }));
  res.json(data);
});

app.get('/admin/dashboard', (req, res) => {
  const secret = req.query.key;
  if (secret !== ADMIN_SECRET) {
    return res.status(401).send('Unauthorized. Use ?key=YOUR_ADMIN_SECRET');
  }

  const formatBytes = (b: number) => {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const today = getTodayStats();
  const rows = [...statsHistory].reverse().map(s => `
    <tr style="${s.date === getToday() ? 'background:#1a3a2a;' : ''}">
      <td>${s.date}</td>
      <td>${s.requests.toLocaleString()}</td>
      <td>${formatBytes(s.bytesOut)}</td>
      <td>${s.uniqueIPs.size}</td>
      <td>${s.electronIPs.size}</td>
      <td>${s.browserIPs.size}</td>
    </tr>
  `).join('');

  const topPaths = Object.entries(today.paths)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([p, n]) => `<tr><td>${p}</td><td>${n}</td></tr>`)
    .join('');

  // Active WebSocket connections
  let wsCount = 0;
  wss.clients.forEach(() => wsCount++);

  // Pet stats
  const pets = getPets();
  const petCount = Object.keys(pets).length;
  const readyCount = Object.values(pets).filter(p => p.status === 'ready').length;

  const codes = getCodes();
  const totalCodes = Object.keys(codes).length;
  const usedCodes = Object.values(codes).filter(c => c.usedBy).length;

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>桌面陪伴 - 管理后台</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
  h1{font-size:22px;margin-bottom:16px;color:#58a6ff}
  h2{font-size:16px;margin:20px 0 10px;color:#8b949e}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px 20px;min-width:140px}
  .card .num{font-size:28px;font-weight:700;color:#58a6ff}
  .card .label{font-size:12px;color:#8b949e;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
  th{color:#8b949e;font-weight:500}
  tr:hover{background:#161b22}
  .refresh{color:#58a6ff;font-size:12px;cursor:pointer;text-decoration:underline}
</style>
</head><body>
<h1>桌面陪伴 - 管理后台</h1>
<div class="cards">
  <div class="card"><div class="num">${today.requests.toLocaleString()}</div><div class="label">今日请求</div></div>
  <div class="card"><div class="num">${formatBytes(today.bytesOut)}</div><div class="label">今日流量</div></div>
  <div class="card"><div class="num">${today.uniqueIPs.size}</div><div class="label">今日访客 (UV)</div></div>
  <div class="card"><div class="num">${today.electronIPs.size}</div><div class="label">Electron 用户</div></div>
  <div class="card"><div class="num">${today.browserIPs.size}</div><div class="label">浏览器用户</div></div>
  <div class="card"><div class="num">${wsCount}</div><div class="label">WebSocket 连接</div></div>
  <div class="card"><div class="num">${readyCount}/${petCount}</div><div class="label">宠物 (就绪/总数)</div></div>
  <div class="card"><div class="num">${usedCodes}/${totalCodes}</div><div class="label">兑换码 (已用/总数)</div></div>
</div>

<h2>每日统计</h2>
<table><tr><th>日期</th><th>请求数</th><th>流量</th><th>独立访客</th><th>Electron</th><th>浏览器</th></tr>${rows}</table>

<h2>今日热门路径</h2>
<table><tr><th>路径</th><th>请求数</th></tr>${topPaths}</table>

<p style="margin-top:20px;font-size:11px;color:#484f58">自动刷新：<a class="refresh" onclick="location.reload()">刷新</a> | 数据从服务器启动时开始统计，重启会清零</p>
</body></html>`);
});

// ---- Admin: Redemption Codes ----

function requireAdmin(req: express.Request, res: express.Response): boolean {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${ADMIN_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// POST /api/admin/codes — generate N codes
app.post('/api/admin/codes', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const count = Math.min(req.body.count || 1, 100);
  const codes = getCodes();
  const newCodes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code: string;
    do { code = generateCode(); } while (codes[code]);
    codes[code] = { createdAt: new Date().toISOString(), usedBy: null, usedAt: null };
    newCodes.push(code);
  }
  saveCodes(codes);
  console.log(`[Admin] Generated ${count} codes: ${newCodes.join(', ')}`);
  res.json({ codes: newCodes });
});

// GET /api/admin/codes — list all codes
app.get('/api/admin/codes', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(getCodes());
});

// ---- Redeem + Pet List ----

// POST /api/redeem — validate code, create pet instance
app.post('/api/redeem', (req, res) => {
  const { code, name } = req.body;
  if (!code) return res.status(400).json({ error: '请输入兑换码' });

  const codes = getCodes();
  const codeRecord = codes[code.toUpperCase()];
  if (!codeRecord) return res.status(400).json({ error: '兑换码无效' });
  if (codeRecord.usedBy) return res.status(400).json({ error: '兑换码已被使用' });

  // Create pet
  const petId = generatePetId();
  const pets = getPets();
  pets[petId] = {
    id: petId,
    name: name || '我的萌宠',
    code: code.toUpperCase(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  savePets(pets);

  // Mark code as used
  codeRecord.usedBy = petId;
  codeRecord.usedAt = new Date().toISOString();
  saveCodes(codes);

  // Create directory
  ensurePetDir(petId);

  console.log(`[Redeem] Code ${code.toUpperCase()} → Pet ${petId} (${name || '我的萌宠'})`);
  res.json({ petId, name: pets[petId].name });
});

// GET /api/pets — list all pets (public)
const HIDDEN_PETS = new Set(['tpa5f8zz']);

app.get('/api/pets', (req, res) => {
  const pets = getPets();
  const likes = getLikes();
  const clientId = (req.query.clientId as string) || '';
  const list = Object.values(pets).filter(p => !HIDDEN_PETS.has(p.id)).map(p => {
    // Check actual status from disk
    const manifestPath = path.join(PETS_BASE_DIR, p.id, 'manifest.json');
    const hasManifest = fs.existsSync(manifestPath);
    // Check if matted moving video exists
    const mattedMovingPath = path.join(PETS_BASE_DIR, p.id, 'matted', 'moving.webm');
    const hasMattedMoving = fs.existsSync(mattedMovingPath);
    // Likes info
    const petLikes = likes[p.id] || { count: 0, voters: [] };
    return {
      id: p.id,
      name: p.name,
      status: hasManifest ? 'ready' : p.status,
      createdAt: p.createdAt,
      photoUrl: `/api/pets/${p.id}/assets/pet_photo.jpg`,
      likes: petLikes.count,
      mattedMovingUrl: hasMattedMoving ? `/api/pets/${p.id}/assets/matted/moving.webm` : null,
    };
  });
  // Count total likes this client has given across all pets
  let totalMyLikes = 0;
  if (clientId) {
    for (const rec of Object.values(likes)) {
      totalMyLikes += (rec as any).voters.filter((v: string) => v === clientId).length;
    }
  }
  res.json({ pets: list, totalMyLikes });
});

// POST /api/pets/:petId/like — 点赞（每个用户全局最多 3 次）
app.post('/api/pets/:petId/like', (req, res) => {
  const { petId } = req.params;
  const { clientId } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const pets = getPets();
  if (!pets[petId]) return res.status(404).json({ error: 'Pet not found' });

  const likes = getLikes();
  if (!likes[petId]) likes[petId] = { count: 0, voters: [] };

  // Count total likes across ALL pets for this client
  let totalMyLikes = 0;
  for (const rec of Object.values(likes)) {
    totalMyLikes += rec.voters.filter(v => v === clientId).length;
  }

  if (totalMyLikes >= 3) {
    return res.json({ likes: likes[petId].count, totalMyLikes });
  }

  likes[petId].count++;
  likes[petId].voters.push(clientId);
  saveLikes(likes);

  res.json({ likes: likes[petId].count, totalMyLikes: totalMyLikes + 1 });
});

// ---- Reminder system ----

const reminderTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

const DEFAULT_REMINDERS: Omit<Reminder, 'id' | 'petId' | 'createdAt'>[] = [
  { label: '吃午饭', message: '主人～该吃午饭啦！别饿着肚子哦～', type: 'fixed', time: '12:00', enabled: true },
  { label: '吃晚饭', message: '主人～该吃晚饭啦！', type: 'fixed', time: '18:00', enabled: true },
  { label: '起来活动', message: '主人～坐太久了，起来活动一下吧！', type: 'interval', intervalMinutes: 120, enabled: true },
  { label: '该下班了', message: '主人～该下班啦！今天辛苦了～', type: 'fixed', time: '18:30', enabled: true },
];

function seedDefaultReminders(petId: string) {
  const reminders = getReminders();
  const existing = Object.values(reminders).filter(r => r.petId === petId);
  if (existing.length > 0) return;
  for (const def of DEFAULT_REMINDERS) {
    const id = generatePetId();
    reminders[id] = { ...def, id, petId, createdAt: new Date().toISOString() };
  }
  saveReminders(reminders);
}

function scheduleReminders(petId: string) {
  // Clear existing
  const existing = reminderTimers.get(petId);
  if (existing) {
    for (const t of existing.values()) clearTimeout(t);
  }
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const reminders = getReminders();
  const petReminders = Object.values(reminders).filter(r => r.petId === petId && r.enabled);

  for (const r of petReminders) {
    if (r.type === 'fixed' && r.time) {
      const scheduleNext = () => {
        const [h, m] = r.time!.split(':').map(Number);
        const now = new Date();
        const target = new Date();
        target.setHours(h, m, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        const delay = target.getTime() - now.getTime();
        timers.set(r.id, setTimeout(async () => {
          const audioUrl = await textToSpeech(r.message, petId);
          broadcastToPet(petId, { type: 'reminder', reminderId: r.id, label: r.label, message: r.message, audioUrl });
          scheduleNext();
        }, delay));
      };
      scheduleNext();
    } else if (r.type === 'interval' && r.intervalMinutes) {
      const ms = r.intervalMinutes * 60 * 1000;
      const iv = setInterval(async () => {
        const audioUrl = await textToSpeech(r.message, petId);
        broadcastToPet(petId, { type: 'reminder', reminderId: r.id, label: r.label, message: r.message, audioUrl });
      }, ms);
      timers.set(r.id, iv as any);
    }
  }
  reminderTimers.set(petId, timers);
}

// GET /api/pets/:petId/reminders
app.get('/api/pets/:petId/reminders', (req, res) => {
  const { petId } = req.params;
  seedDefaultReminders(petId);
  const reminders = getReminders();
  const list = Object.values(reminders).filter(r => r.petId === petId);
  res.json(list);
});

// POST /api/pets/:petId/reminders
app.post('/api/pets/:petId/reminders', (req, res) => {
  const { petId } = req.params;
  const { label, message, type, time, intervalMinutes, enabled } = req.body;
  if (!label || !message) return res.status(400).json({ error: 'label and message required' });

  const reminders = getReminders();
  const id = generatePetId();
  const reminder: Reminder = {
    id, petId, label, message,
    type: type || 'fixed',
    time, intervalMinutes,
    enabled: enabled !== false,
    createdAt: new Date().toISOString(),
  };
  reminders[id] = reminder;
  saveReminders(reminders);
  scheduleReminders(petId);
  res.json(reminder);
});

// PUT /api/pets/:petId/reminders/:reminderId
app.put('/api/pets/:petId/reminders/:reminderId', (req, res) => {
  const { petId, reminderId } = req.params;
  const reminders = getReminders();
  if (!reminders[reminderId] || reminders[reminderId].petId !== petId) {
    return res.status(404).json({ error: 'Reminder not found' });
  }
  const { label, message, type, time, intervalMinutes, enabled } = req.body;
  if (label !== undefined) reminders[reminderId].label = label;
  if (message !== undefined) reminders[reminderId].message = message;
  if (type !== undefined) reminders[reminderId].type = type;
  if (time !== undefined) reminders[reminderId].time = time;
  if (intervalMinutes !== undefined) reminders[reminderId].intervalMinutes = intervalMinutes;
  if (enabled !== undefined) reminders[reminderId].enabled = enabled;
  saveReminders(reminders);
  scheduleReminders(petId);
  res.json(reminders[reminderId]);
});

// DELETE /api/pets/:petId/reminders/:reminderId
app.delete('/api/pets/:petId/reminders/:reminderId', (req, res) => {
  const { petId, reminderId } = req.params;
  const reminders = getReminders();
  if (!reminders[reminderId] || reminders[reminderId].petId !== petId) {
    return res.status(404).json({ error: 'Reminder not found' });
  }
  delete reminders[reminderId];
  saveReminders(reminders);
  scheduleReminders(petId);
  res.json({ ok: true });
});

// ---- Chat ----

app.post('/api/pets/:petId/chat', async (req, res) => {
  const { petId } = req.params;
  const { message, history } = req.body as { message: string; history?: { role: string; content: string }[] };
  if (!message) return res.status(400).json({ error: 'message required' });

  const pets = getPets();
  const pet = pets[petId];
  if (!pet) return res.status(404).json({ error: 'Pet not found' });

  // Build system prompt with pet personality
  let petDesc = '';
  try {
    const manifestPath = path.join(getPetDir(petId), 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.description) petDesc = manifest.description;
    }
  } catch {}

  const systemPrompt = `你是一只名叫"${pet.name}"的桌面宠物。${petDesc ? `关于你：${petDesc}。` : ''}
你的性格：可爱、活泼、关心主人、偶尔撒娇。
回复要求：
- 用1-2句话简短回复
- 语气亲切可爱，适当使用"～"等语气词
- 跟随用户使用的语言回复（中文回中文，英文回英文）
- 你是主人的桌面伙伴，会关心主人的生活和工作`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...(history || []).slice(-10),
    { role: 'user', content: message },
  ];

  try {
    const resp = await fetch(`${VOLC_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ model: VISION_MODEL, messages, max_tokens: 256 }),
    });
    const data = await resp.json() as any;
    const reply = data?.choices?.[0]?.message?.content || '喵～我好像没听清，再说一次吧？';
    // Generate TTS audio in parallel (don't block response if slow)
    const audioUrl = await textToSpeech(reply, petId);
    res.json({ reply, audioUrl });
  } catch (err) {
    console.error('Chat API error:', err);
    res.json({ reply: '呜呜，我的脑子卡住了...等一下再试试吧～' });
  }
});

// ---- Per-pet routes ----

// Middleware to validate petId
function petMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const { petId } = req.params;
  const pets = getPets();
  if (!pets[petId]) {
    return res.status(404).json({ error: 'Pet not found' });
  }
  next();
}

// POST /api/pets/:petId/generate
app.post('/api/pets/:petId/generate', petMiddleware, upload.single('photo'), async (req, res) => {
  const { petId } = req.params;
  const inst = getPetInstance(petId)!;

  if (inst.generationState.status === 'generating') {
    return res.status(409).json({ error: 'Generation already in progress' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded' });
  }

  const petDir = ensurePetDir(petId);
  const photoPath = path.join(petDir, 'pet_photo.jpg');
  fs.renameSync(req.file.path, photoPath);

  // Update pet status
  const pets = getPets();
  pets[petId].status = 'generating';
  savePets(pets);

  // Start generation
  inst.generationState.status = 'generating';
  inst.generationState.stage = 'starting';
  inst.generationState.progress = 0;
  inst.generationState.message = 'Starting...';

  runGeneration(petId, photoPath, petDir);

  res.json({ status: 'started', petId });
});

async function runGeneration(petId: string, photoPath: string, outputDir: string) {
  const inst = getPetInstance(petId);
  if (!inst) return;

  function progressCallback(stage: string, progress: number, message: string) {
    inst.generationState.stage = stage;
    inst.generationState.progress = progress;
    inst.generationState.message = message;
    broadcastToPet(petId, { type: 'progress', stage, progress, message });
  }

  try {
    const manifest = await generatePetAssets(photoPath, outputDir, progressCallback);
    inst.generationState.status = 'ready';
    inst.generationState.manifest = manifest;
    inst.generationState.message = 'Complete!';

    const pets = getPets();
    pets[petId].status = 'ready';
    savePets(pets);

    broadcastToPet(petId, { type: 'ready', manifest });
  } catch (err: any) {
    inst.generationState.status = 'error';
    inst.generationState.message = err.message || String(err);

    const pets = getPets();
    pets[petId].status = 'error';
    savePets(pets);

    broadcastToPet(petId, { type: 'error', message: inst.generationState.message });
  }
}

// GET /api/pets/:petId/status
app.get('/api/pets/:petId/status', petMiddleware, (req, res) => {
  const inst = getPetInstance(req.params.petId);
  if (!inst) return res.status(404).json({ error: 'Pet not found' });
  res.json(inst.generationState);
});

// GET /api/pets/:petId/manifest
app.get('/api/pets/:petId/manifest', petMiddleware, (req, res) => {
  const manifestPath = path.join(PETS_BASE_DIR, req.params.petId, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
  } else {
    res.status(404).json({ error: 'No manifest found' });
  }
});

// GET /api/pets/:petId/assets/*
app.get('/api/pets/:petId/assets/*', petMiddleware, (req, res) => {
  const filepath = req.params[0];
  const fullPath = path.join(PETS_BASE_DIR, req.params.petId, filepath);
  if (fs.existsSync(fullPath)) {
    // Cache videos and images for 7 days — saves bandwidth on repeat visits
    const ext = path.extname(fullPath).toLowerCase();
    if (['.mp4', '.webm', '.jpg', '.jpeg', '.png'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
    res.sendFile(fullPath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// ---- Per-pet mock state simulator ----

// POST /api/pets/:petId/mock/start
app.post('/api/pets/:petId/mock/start', petMiddleware, (req, res) => {
  const inst = getPetInstance(req.params.petId)!;
  if (inst.mockTimer) clearInterval(inst.mockTimer);
  console.log(`[Mock:${req.params.petId}] Starting pet state simulator`);
  inst.mockTimer = setInterval(() => {
    const candidates = PET_STATES.filter((s) => s !== inst.currentPetState);
    const newState = candidates[Math.floor(Math.random() * candidates.length)];
    const prev = inst.currentPetState;
    inst.currentPetState = newState;
    broadcastToPet(req.params.petId, { type: 'state_change', prev_state: prev, new_state: newState });
  }, 8000 + Math.random() * 7000);
  res.json({ status: 'mock started' });
});

// POST /api/pets/:petId/mock/stop
app.post('/api/pets/:petId/mock/stop', petMiddleware, (req, res) => {
  const inst = getPetInstance(req.params.petId)!;
  if (inst.mockTimer) {
    clearInterval(inst.mockTimer);
    inst.mockTimer = null;
  }
  res.json({ status: 'mock stopped' });
});

// POST /api/pets/:petId/state
app.post('/api/pets/:petId/state', petMiddleware, (req, res) => {
  const { state } = req.body;
  if (!PET_STATES.includes(state)) {
    return res.status(400).json({ error: `Invalid state. Must be one of: ${PET_STATES.join(', ')}` });
  }
  const inst = getPetInstance(req.params.petId)!;
  const prev = inst.currentPetState;
  inst.currentPetState = state;
  broadcastToPet(req.params.petId, { type: 'state_change', prev_state: prev, new_state: state });
  res.json({ prev_state: prev, new_state: state });
});

// GET /api/pets/:petId/pet-state
app.get('/api/pets/:petId/pet-state', petMiddleware, (req, res) => {
  const inst = getPetInstance(req.params.petId)!;
  res.json({ state: inst.currentPetState });
});

// ---- Camera integration (global, unchanged) ----
let cameraProcess: ChildProcess | null = null;
let detectionTimer: ReturnType<typeof setInterval> | null = null;
let cameraState = {
  status: 'disconnected' as 'disconnected' | 'connecting' | 'connected' | 'error',
  lastDetection: '',
  detectionCount: 0,
};

app.post('/api/camera/start', async (req, res) => {
  if (cameraProcess) {
    return res.json({ status: 'already_running', camera: cameraState });
  }

  const useMock = req.query.mock === 'true';
  const cameraScript = useMock
    ? path.join(__dirname, 'camera', 'mock_camera.py')
    : path.join(__dirname, 'camera', 'camera_service.py');
  const framePath = path.join(ASSETS_DIR, 'camera_frame.jpg');

  cameraState.status = 'connecting';

  const scriptArgs = useMock
    ? [cameraScript, '--output', framePath, '--interval', '8', '--frame-interval', '1']
    : [cameraScript, '--output', framePath, '--interval', '1000'];

  cameraProcess = spawn('python3.11', scriptArgs, {
    cwd: path.join(__dirname, 'camera'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  cameraProcess.on('error', (err) => {
    console.error(`[CameraPy] Failed to start: ${err.message}`);
    cameraProcess = null;
    cameraState.status = 'error';
  });

  cameraProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[CameraPy] ${line}`);
    if (line.includes('Status: connected') || line.includes('[MockCam] Playing:')) {
      if (cameraState.status !== 'connected') {
        cameraState.status = 'connected';
      }
    }
  });

  cameraProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[CameraPy] ${data.toString().trim()}`);
  });

  cameraProcess.on('exit', (code) => {
    console.log(`[CameraPy] Exited with code ${code}`);
    cameraProcess = null;
    cameraState.status = 'disconnected';
    if (detectionTimer) {
      clearInterval(detectionTimer);
      detectionTimer = null;
    }
  });

  if (useMock) {
    setTimeout(() => {
      if (cameraState.status === 'connecting') {
        cameraState.status = 'connected';
      }
    }, 2000);
  }

  if (detectionTimer) clearInterval(detectionTimer);
  detectionTimer = setInterval(async () => {
    const detected = await detectPetState();
    // Camera detection is global — not tied to a specific pet for now
    if (detected) {
      console.log(`[Detect] Detected: ${detected}`);
    }
  }, DETECTION_INTERVAL * 1000);

  res.json({ status: 'started', camera: cameraState });
});

app.post('/api/camera/stop', (_req, res) => {
  if (detectionTimer) {
    clearInterval(detectionTimer);
    detectionTimer = null;
  }
  if (cameraProcess) {
    cameraProcess.kill('SIGTERM');
    cameraProcess = null;
  }
  cameraState.status = 'disconnected';
  console.log('[Camera] Stopped');
  res.json({ status: 'stopped' });
});

app.get('/api/camera/status', (_req, res) => {
  res.json(cameraState);
});

// ---- Downloads ----
app.get('/api/download/mac', (_req, res) => {
  const dmgPath = path.join(__dirname, '..', 'dist', 'DesktopPet.dmg');
  if (fs.existsSync(dmgPath)) {
    res.download(dmgPath, 'DesktopPet.dmg');
  } else {
    res.status(404).json({ error: 'Desktop app not available' });
  }
});

app.get('/api/download/win', (_req, res) => {
  const zipPath = path.join(__dirname, '..', 'dist', 'DesktopPet-Windows.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'DesktopPet-Windows.zip');
  } else {
    res.status(404).json({ error: 'Windows app not available' });
  }
});

// ---- Serve frontend ----
const PROJECT_ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// ---- Start ----
function main() {
  const port = parseInt(process.env.PORT || String(SERVER_PORT), 10);
  const host = process.env.HOST || SERVER_HOST;

  // Ensure directories
  fs.mkdirSync(PETS_BASE_DIR, { recursive: true });

  server.listen(port, host, () => {
    console.log(`Desktop Pet Backend starting on ${host}:${port}`);
  });
}

main();
