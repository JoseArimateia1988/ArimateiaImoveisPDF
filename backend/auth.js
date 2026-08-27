import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import {
  databaseMode,
  createUser,
  findUserByEmail,
  createSession,
  getSessionUser,
  deleteSession,
  getUserProfile,
  saveUserProfile,
} from './db.js';
import { registerMercadoPagoRoutes } from './mercadopago.js';

const COOKIE = 'imovel_session';
const SESSION_DAYS = 30;
const productDbReady = () => ['postgres','d1'].includes(databaseMode());

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [kind, salt, hashHex] = String(stored || '').split(':');
    if (kind !== 'scrypt' || !salt || !hashHex) return false;
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('='); if (i < 0) return;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}
function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
async function openSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await createSession({ tokenHash: hashToken(token), userId, expiresAt });
  setSessionCookie(res, token);
}
export async function sessionUser(req) {
  if (!productDbReady()) return null;
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  try { return await getSessionUser(hashToken(token)); } catch { return null; }
}
export async function requireUser(req, res, next) {
  if (!productDbReady()) return res.status(503).json({ erro: 'O banco do produto ainda não foi configurado.' });
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ erro: 'Faça login para continuar.' });
  req.user = user; next();
}
export function registerAuthRoutes(app, { sanitizeProfile }) {
  registerMercadoPagoRoutes(app);
  app.get('/api/auth/me', async (req, res) => {
    if (!productDbReady()) return res.status(503).json({ erro: 'Banco ainda não configurado.' });
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ erro: 'Não autenticado.' });
    res.json({ user: { id: user.id, email: user.email }, profile: sanitizeProfile(user.profile || {}) });
  });
  app.post('/api/auth/register', async (req, res) => {
    if (!productDbReady()) return res.status(503).json({ erro: 'Banco ainda não configurado.' });
    const email = normalizeEmail(req.body?.email), password = String(req.body?.password || '');
    if (!validEmail(email)) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
    if (password.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    if (password.length > 200) return res.status(400).json({ erro: 'Senha inválida.' });
    const profile = sanitizeProfile({ email });
    try {
      const id = randomUUID();
      await createUser({ id, email, passwordHash: hashPassword(password), profile });
      await openSession(res, id);
      res.status(201).json({ user: { id, email }, profile });
    } catch (e) {
      if (e?.code === '23505' || e?.code === 'D1_UNIQUE') return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
      console.error('Erro ao criar conta:', e.message);
      res.status(500).json({ erro: 'Não foi possível criar a conta.' });
    }
  });
  app.post('/api/auth/login', async (req, res) => {
    if (!productDbReady()) return res.status(503).json({ erro: 'Banco ainda não configurado.' });
    const email = normalizeEmail(req.body?.email), password = String(req.body?.password || '');
    if (!validEmail(email) || !password) return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });
    try {
      const user = await findUserByEmail(email);
      if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
      await openSession(res, user.id);
      res.json({ user: { id: user.id, email: user.email }, profile: sanitizeProfile(user.profile || {}) });
    } catch (e) {
      console.error('Erro no login:', e.message);
      res.status(500).json({ erro: 'Não foi possível entrar.' });
    }
  });
  app.post('/api/auth/logout', async (req, res) => {
    const token = cookies(req)[COOKIE];
    if (token && productDbReady()) { try { await deleteSession(hashToken(token)); } catch {} }
    clearSessionCookie(res); res.json({ ok: true });
  });
  app.get('/api/profile', requireUser, async (req, res) => {
    try { res.json({ profile: sanitizeProfile(await getUserProfile(req.user.id)) }); }
    catch (e) { console.error('Erro ao buscar perfil:', e.message); res.status(500).json({ erro: 'Não foi possível carregar o perfil.' }); }
  });
  app.put('/api/profile', requireUser, async (req, res) => {
    try { const profile = sanitizeProfile(req.body?.profile || {}); await saveUserProfile(req.user.id, profile); res.json({ profile }); }
    catch (e) { console.error('Erro ao salvar perfil:', e.message); res.status(500).json({ erro: 'Não foi possível salvar o perfil.' }); }
  });
}
