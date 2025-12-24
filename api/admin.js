// Minimal admin API server for Studyflow Admin
// Uses Supabase service role for secure admin-only operations
// Environment:
//   - EXPO_PUBLIC_SUPABASE_URL

try { require('dotenv').config(); } catch {}
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.ADMIN_API_PORT ? Number(process.env.ADMIN_API_PORT) : 8787;
const HOST = process.env.ADMIN_API_HOST || '0.0.0.0';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

if (!SUPABASE_URL) {
  console.error('[admin-api] Missing EXPO_PUBLIC_SUPABASE_URL');
}

const supabase = createClient(
  SUPABASE_URL || 'https://invalid.supabase.co',
);

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...headers,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(text);
}

function ok(res, data) { send(res, 200, { ok: true, ...data }); }
function bad(res, msg) { send(res, 400, { ok: false, error: msg }); }
function unauthorized(res) { send(res, 401, { ok: false, error: 'Unauthorized' }); }

function requireAdmin(req) {
  const header = req.headers['x-admin-password'];
}

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString(); }
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { req.destroy(); reject(new Error('Payload too large')); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function postGeminiWithRetry(url, body, options) {
  const maxRetries = (options && options.maxRetries) ? options.maxRetries : 2;
  const baseDelayMs = (options && options.baseDelayMs) ? options.baseDelayMs : 1000;
  let attempt = 0;
  while (true) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const errTxt = await res.text();
    console.log('[admin-api] Gemini error:', res.status, errTxt);
    const is429 = res.status === 429 || /RESOURCE_EXHAUSTED/i.test(errTxt) || res.status === 503;
    if (is429 && attempt < maxRetries) {
      const jitter = Math.floor(Math.random() * 300);
      const waitMs = baseDelayMs * Math.pow(2, attempt) + jitter;
      await new Promise(r => setTimeout(r, waitMs));
      attempt += 1;
      continue;
    }
    const friendly = is429 ? 'AI service is busy (429 RESOURCE_EXHAUSTED). Please try again shortly.' : ('Gemini API error: ' + res.status + ' ' + res.statusText);
    throw new Error(friendly + ' - ' + errTxt);
  }
}

function sanitizeJsonText(raw) {
  let s = (raw || '').trim();
  if (!s) return s;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  s = s.replace(/'([A-Za-z0-9_]+)'\s*:/g, '"$1":');
  s = s.replace(/:\s*'([^']*)'/g, ': "$1"');
  s = s.replace(/,\s*(?=[\]\}])/g, '');
  return s;
}

function extractJson(text) {
  let cleaned = sanitizeJsonText(text);
  if (!cleaned) throw new Error('No JSON content returned by AI');
  try { return JSON.parse(cleaned); } catch {}
  const braceMatch = cleaned.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(sanitizeJsonText(braceMatch[0])); } catch {}
  }
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { const arr = JSON.parse(sanitizeJsonText(arrayMatch[0])); return { classes: arr }; } catch {}
  }
  throw new Error('Invalid JSON returned by AI');
}

function normalizeHM(t) {
  if (!t) return '';
  let s = String(t).trim();
  s = s.replace(/\.|。|：/g, ':').replace(/–|—|-/g, '-');
  const ampmMatch = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const mer = ampmMatch[3].toUpperCase();
    if (mer === 'PM' && h < 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  const hmMatch = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hmMatch) {
    const h = parseInt(hmMatch[1], 10);
    const m = parseInt(hmMatch[2], 10);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  const compact = s.match(/^(\d{1,2})(\d{2})$/);
  if (compact) {
    const h = parseInt(compact[1], 10);
    const m = parseInt(compact[2], 10);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  return s;
}

function dayNameToIndex(d) {
  if (!d) return 0;
  const s = String(d).trim().toLowerCase();
  if (['mon','monday'].includes(s)) return 1;
  if (['tue','tues','tuesday'].includes(s)) return 2;
  if (['wed','weds','wednesday'].includes(s)) return 3;
  if (['thu','thur','thurs','thursday'].includes(s)) return 4;
  if (['fri','friday'].includes(s)) return 5;
  if (['sat','saturday'].includes(s)) return 6;
  if (['sun','sunday'].includes(s)) return 7;
  if (s.includes('一')) return 1;
  if (s.includes('二')) return 2;
  if (s.includes('三')) return 3;
  if (s.includes('四')) return 4;
  if (s.includes('五')) return 5;
  if (s.includes('六')) return 6;
  if (s.includes('日') || s.includes('天')) return 7;
  const asNum = parseInt(s, 10);
  if (!isNaN(asNum)) return asNum;
  return 0;
}

function buildTaskInstruction(classContext) {
  const now = new Date();
  const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).toString().padStart(2, '0')}-${String(now.getDate()).toString().padStart(2, '0')}`;
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekday = weekdayNames[now.getDay()];
  const lines = [
    'You are an assistant that converts an English description into a structured school task.',
    'Classify the content strictly as one of: assignment, exam, or note.',
    'Return ONLY a single JSON object with the following keys:',
    '{',
    '  "type": "assignment" | "exam" | "note",',
    '  "title": string,',
    '  "description"?: string,',
    '  "dueDate"?: "YYYY-MM-DD",',
    '  "time"?: "HH:MM" or "HH:MM:SS" in 24h,',
    '  "examType"?: string,',
    '  "location"?: string,',
    '  "priority"?: "low" | "normal" | "important"',
    '}',
    'Rules:',
    `- Today is ${todayYMD} (${weekday}). Interpret any relative dates using this as the reference.`,
    '- If no explicit due date, omit dueDate.',
    '- If no explicit time, omit time.',
    '- For notes, at minimum include title and description.',
    '- Title should be concise and meaningful.',
    '- Relative date handling:',
    '- Phrase "end of this week": return Friday of the current week (week starts Monday; if today is Sunday, use the upcoming week).',
    '- Phrase "end of next week": return Friday of next week.'
  ];
  if (classContext && classContext.subject) {
    lines.push(`- The class subject context is: ${classContext.subject}. Prefer a title referencing this subject.`);
  }
  return lines.join('\n');
}

function buildTimetableInstruction() {
  return [
    'You are an assistant that extracts a school weekly timetable from an image.',
    'Return ONLY a single JSON object with this schema:',
    '{ "classes": [',
    '  {',
    '    "subject": string,',
    '    "teacher"?: string,',
    '    "room"?: string,',
    '    "dayOfWeek": number, // 1=Mon,2=Tue,3=Wed,4=Thu,5=Fri (use 6/7 if weekend)',
    '    "startTime": "HH:MM" (24h),',
    '    "endTime": "HH:MM" (24h)',
    '  }',
    '] }',
    'Rules:',
    '- If the timetable shows multiple periods for the same subject on different days, include each as a separate entry.',
    '- Map day names to numbers as specified; prefer 1-5 for Mon-Fri.',
    '- Normalize times to 24h HH:MM (e.g., 09:05).',
    '- If teacher or room not visible, omit the field.',
    '- Do not include any commentary outside the JSON.',
  ].join('\n');
}

async function getUsersMetrics(role) {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, role, created_at')
    .limit(5000);
  if (error) throw error;
  const total = profiles.length;
  const parents = profiles.filter(p=>p.role==='parent').length;
  const students = profiles.filter(p=>p.role==='student').length;
  const new7 = profiles.filter(p=> (Date.now() - new Date(p.created_at).getTime()) <= 7*86400000).length;
  
  // 计算30天注册趋势
  const now = new Date();
  const registrationTrend = Array.from({length: 30}, (_, i) => {
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - (29 - i));
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
    
    return profiles.filter(p => {
      const created = new Date(p.created_at);
      return created >= startDate && created <= endDate;
    }).length;
  });
  
  return { total, parents, students, new7, registrationTrend, list: profiles };
}

async function getUsersList(role, page = 1, limit = 50) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from('profiles')
    .select('id, full_name, email, role, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (role && role !== 'all') q = q.eq('role', role);
  
  const { data: users, count, error } = await q;
  if (error) throw error;
  
  if (!users || users.length === 0) return { users: [], total: count || 0 };

  // Fetch auth users to get status
  const { data: { users: authUsers }, error: authError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });

  const authMap = new Map();
  if (authUsers) {
    authUsers.forEach(u => authMap.set(u.id, u));
  }
  
  // Get user settings for all users
  const userIds = users.map(user => user.id);
  const { data: userSettings, error: settingsError } = await supabase
    .from('user_settings')
    .select('id, age, gender, grade, school_name, selected_courses')
    .in('id', userIds);
  
  if (settingsError) {
    console.error('Error fetching user settings:', settingsError);
    // Return users without settings if there's an error
    return { users, total: count };
  }
  
  // Create a map of user settings by user ID
  const settingsMap = new Map();
  (userSettings || []).forEach(setting => {
    settingsMap.set(setting.id, setting);
  });
  
  // Merge user data with settings and auth status
  const processedUsers = users.map(user => {
    const authUser = authMap.get(user.id);
    let status = 'lost'; // Default to lost (10+ days or never)
    
    // Determine last active time: prefer last_sign_in_at, fallback to created_at
    let lastActive = user.created_at ? new Date(user.created_at) : new Date(0);
    if (authUser && authUser.last_sign_in_at) {
      lastActive = new Date(authUser.last_sign_in_at);
    }
    
    const now = new Date();
    const diffTime = Math.abs(now - lastActive);
    const diffDays = diffTime / (1000 * 60 * 60 * 24); // Floating point days

    if (diffDays <= 3) {
      status = 'active';
    } else if (diffDays <= 10) {
      status = 'idle';
    } else {
      status = 'lost';
    }

    return {
      ...user,
      status,
      last_sign_in_at: authUser?.last_sign_in_at,
      age: settingsMap.get(user.id)?.age || null,
      gender: settingsMap.get(user.id)?.gender || null,
      grade: settingsMap.get(user.id)?.grade || null,
      school_name: settingsMap.get(user.id)?.school_name || null,
      selected_courses: settingsMap.get(user.id)?.selected_courses || []
    };
  });

  return { users: processedUsers, total: count };
}

async function getBehaviorMetrics(role) {
  try {
    console.log(`[getBehaviorMetrics] Starting with role: ${role || 'all'}`);
    const since30 = daysAgo(30);
    const since7 = daysAgo(7);
    const since1 = daysAgo(1);
    console.log(`[getBehaviorMetrics] Date ranges - since30: ${since30}, since7: ${since7}, since1: ${since1}`);

    // 获取学习会话数据
    const { data: sessionsRaw, error: sessionsError } = await supabase
      .from('learning_sessions')
      .select('user_id, duration, start_time')
      .gte('start_time', since30)
      .limit(20000);
    
    if (sessionsError) {
      console.error(`[getBehaviorMetrics] Error fetching learning_sessions:`, sessionsError);
    }
    console.log(`[getBehaviorMetrics] Raw sessions count: ${(sessionsRaw||[]).length}`);
    if (sessionsRaw && sessionsRaw.length > 0) {
      console.log(`[getBehaviorMetrics] Sample session:`, sessionsRaw[0]);
    }

    

    // 角色过滤函数
    const filterRole = async (rows) => {
      if (!role || role === 'all') {
        console.log(`[getBehaviorMetrics] No role filter applied, returning all ${(rows||[]).length} rows`);
        return rows || [];
      }
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, role')
        .in('role', ['parent','student'])
        .limit(10000);
      
      if (profilesError) {
        console.error(`[getBehaviorMetrics] Error fetching profiles:`, profilesError);
      }
      
      const ids = new Set((profiles||[]).filter(p=>p.role===role).map(p=>p.id));
      const filteredRows = (rows||[]).filter(s=> ids.has(s.user_id));
      console.log(`[getBehaviorMetrics] Role filter '${role}' - profiles: ${(profiles||[]).length}, matching IDs: ${ids.size}, filtered rows: ${filteredRows.length}`);
      return filteredRows;
    };

    const rows = await filterRole(sessionsRaw||[]);
    console.log(`[getBehaviorMetrics] Filtered rows count: ${rows.length}`);

    // 计算活跃用户
    const distinctUsers = (rows, sinceIso) => {
      const filteredRows = (rows||[]).filter(r=> new Date(r.start_time) >= new Date(sinceIso));
      const set = new Set(filteredRows.map(r=> r.user_id));
      console.log(`[getBehaviorMetrics] distinctUsers since ${sinceIso}: filtered ${filteredRows.length} rows, ${set.size} unique users`);
      return set.size;
    };
    
    const dau = distinctUsers(rows, since1);
    const wau = distinctUsers(rows, since7);
    const mau = distinctUsers(rows, since30);
    
    // 计算会话时长统计
    const avgSession = (rows&&rows.length) ? Math.round(rows.reduce((s,r)=> s + (Number(r.duration)||0), 0) / rows.length) : 0;
    const sessionDurations = rows.map(r => Number(r.duration) || 0).filter(d => d > 0);
    const sessionStats = {
      avg: avgSession,
      min: sessionDurations.length ? Math.min(...sessionDurations) : 0,
      max: sessionDurations.length ? Math.max(...sessionDurations) : 0,
      total: sessionDurations.reduce((sum, d) => sum + d, 0)
    };
    
    console.log(`[getBehaviorMetrics] DAU: ${dau}, WAU: ${wau}, MAU: ${mau}, avgSession: ${avgSession}`);

    // 按天统计活跃用户
    const byDay = new Map();
    const sessionsByDay = new Map();
    for (const r of (rows||[])) {
      const k = startOfDay(r.start_time).toISOString().slice(0,10);
      if (!byDay.has(k)) {
        byDay.set(k, new Set());
        sessionsByDay.set(k, []);
      }
      byDay.get(k).add(r.user_id);
      sessionsByDay.get(k).push(r);
    }
    
    const labels = Array.from({length:30}, (_,i)=>{
      const d = new Date(); d.setDate(d.getDate()- (29-i));
      return d.toISOString().slice(0,10);
    });
    
    const active30 = labels.map(k => (byDay.get(k)?.size || 0));
    const sessions30 = labels.map(k => (sessionsByDay.get(k)?.length || 0));
    const avgDuration30 = labels.map(k => {
      const daySessions = sessionsByDay.get(k) || [];
      return daySessions.length ? Math.round(daySessions.reduce((sum, s) => sum + (Number(s.duration)||0), 0) / daySessions.length) : 0;
    });
    
    console.log(`[getBehaviorMetrics] 30-day active users:`, active30);

    // 获取功能使用数据
    const [homework, exams, notes, flashcards, pomodoro] = await Promise.all([
      supabase.from('homework').select('id, created_at, user_id').gte('created_at', since30).limit(10000).then(r => {
        console.log(`[getBehaviorMetrics] Homework count: ${(r.data||[]).length}`);
        return r.data || [];
      }).catch(e => {
        console.error(`[getBehaviorMetrics] Error fetching homework:`, e);
        return [];
      }),
      supabase.from('exams').select('id, created_at, user_id').gte('created_at', since30).limit(10000).then(r => {
        console.log(`[getBehaviorMetrics] Exams count: ${(r.data||[]).length}`);
        return r.data || [];
      }).catch(e => {
        console.error(`[getBehaviorMetrics] Error fetching exams:`, e);
        return [];
      }),
      supabase.from('notes').select('id, created_at, user_id').gte('created_at', since30).limit(10000).then(r => {
        console.log(`[getBehaviorMetrics] Notes count: ${(r.data||[]).length}`);
        return r.data || [];
      }).catch(e => {
        console.error(`[getBehaviorMetrics] Error fetching notes:`, e);
        return [];
      }),
      supabase.from('flashcards').select('id, created_at, user_id').gte('created_at', since30).limit(10000).then(r => {
        console.log(`[getBehaviorMetrics] Flashcards count: ${(r.data||[]).length}`);
        return r.data || [];
      }).catch(e => {
        console.error(`[getBehaviorMetrics] Error fetching flashcards:`, e);
        return [];
      }),
      supabase.from('pomodoro_sessions').select('id, created_at, user_id, duration').gte('created_at', since30).limit(10000).then(r => {
        console.log(`[getBehaviorMetrics] Pomodoro sessions count: ${(r.data||[]).length}`);
        return r.data || [];
      }).catch(e => {
        console.error(`[getBehaviorMetrics] Error fetching pomodoro:`, e);
        return [];
      })
    ]);
    
    // 计算功能使用趋势
    const featureTrends = {
      homework: calculateDailyTrend(homework, labels),
      exams: calculateDailyTrend(exams, labels),
      notes: calculateDailyTrend(notes, labels),
      flashcards: calculateDailyTrend(flashcards, labels),
      pomodoro: calculateDailyTrend(pomodoro, labels)
    };
    
    const featureUsage = {
      labels: ['任务管理','考试规划','笔记','闪卡学习','番茄时钟'],
      values: [homework.length||0, exams.length||0, notes.length||0, flashcards.length||0, pomodoro.length||0],
    };
    
    // 计算用户参与度
    const userEngagement = calculateUserEngagement(rows, since30);
    
    // 计算会话频率分布
    const sessionFrequency = calculateSessionFrequency(rows);
    
    // 计算会话深度分析
    const sessionDepth = calculateSessionDepth(rows);
    
    console.log(`[getBehaviorMetrics] Feature usage:`, featureUsage);

    const result = { 
      dau, 
      wau, 
      mau,
      avgSessionMin: avgSession,
      sessionStats,
      retentionD1: 0, 
      active30, 
      sessions30,
      avgDuration30,
      featureUsage,
      featureTrends,
      userEngagement,
      sessionFrequency,
      sessionDepth
    };
    
    console.log(`[getBehaviorMetrics] Final result:`, JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    console.error(`[getBehaviorMetrics] Unexpected error:`, e);
    return { 
      dau: 0, 
      wau: 0, 
      mau: 0,
      avgSessionMin: 0,
      sessionStats: { avg: 0, min: 0, max: 0, total: 0 },
      retentionD1: 0, 
      active30: Array(30).fill(0), 
      sessions30: Array(30).fill(0),
      avgDuration30: Array(30).fill(0),
      featureUsage: { labels: [], values: [] },
      featureTrends: {},
      userEngagement: {},
      sessionFrequency: {},
      sessionDepth: {
        durationDistribution: { '0-5分钟': 0, '5-15分钟': 0, '15-30分钟': 0, '30-60分钟': 0, '60+分钟': 0 },
        timeOfDayDistribution: { '凌晨 (0-6点)': 0, '上午 (6-12点)': 0, '下午 (12-18点)': 0, '晚上 (18-24点)': 0 },
        sessionIntensity: { '短时高频': 0, '长时低频': 0, '均衡使用': 0, '浅度使用': 0 },
        avgSessionsPerDay: 0,
        maxConsecutiveDays: 0
      }
    };
  }
}

// 计算每日趋势
function calculateDailyTrend(data, labels) {
  const byDay = new Map();
  for (const item of data) {
    if (!item.created_at) continue;
    const k = startOfDay(item.created_at).toISOString().slice(0,10);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  return labels.map(k => byDay.get(k) || 0);
}

// 计算用户参与度
function calculateUserEngagement(sessions, since30) {
  const userSessionMap = new Map();
  for (const session of sessions) {
    if (!session.user_id) continue;
    if (!userSessionMap.has(session.user_id)) {
      userSessionMap.set(session.user_id, []);
    }
    userSessionMap.get(session.user_id).push(session);
  }
  
  const engagementLevels = {
    high: 0,    // 每周3次以上
    medium: 0,  // 每周1-2次
    low: 0,     // 每月1-3次
    inactive: 0 // 30天内无活动
  };
  
  for (const [userId, sessions] of userSessionMap.entries()) {
    const sessionCount = sessions.length;
    if (sessionCount >= 12) engagementLevels.high++;
    else if (sessionCount >= 4) engagementLevels.medium++;
    else if (sessionCount >= 1) engagementLevels.low++;
    else engagementLevels.inactive++;
  }
  
  return engagementLevels;
}

// 计算会话频率分布
function calculateSessionFrequency(sessions) {
  const frequency = {
    '1-2次': 0,
    '3-5次': 0,
    '6-10次': 0,
    '11-20次': 0,
    '20+次': 0
  };
  
  const userSessionCount = new Map();
  for (const session of sessions) {
    if (!session.user_id) continue;
    userSessionCount.set(session.user_id, (userSessionCount.get(session.user_id) || 0) + 1);
  }
  
  for (const count of userSessionCount.values()) {
    if (count <= 2) frequency['1-2次']++;
    else if (count <= 5) frequency['3-5次']++;
    else if (count <= 10) frequency['6-10次']++;
    else if (count <= 20) frequency['11-20次']++;
    else frequency['20+次']++;
  }
  
  return frequency;
}

// 计算会话深度分析
function calculateSessionDepth(sessions) {
  const depthAnalysis = {
    // 会话时长分布
    durationDistribution: {
      '0-5分钟': 0,
      '5-15分钟': 0,
      '15-30分钟': 0,
      '30-60分钟': 0,
      '60+分钟': 0
    },
    // 每日会话时段分布
    timeOfDayDistribution: {
      '凌晨 (0-6点)': 0,
      '上午 (6-12点)': 0,
      '下午 (12-18点)': 0,
      '晚上 (18-24点)': 0
    },
    // 会话强度分析
    sessionIntensity: {
      '短时高频': 0,    // 单次短但频繁
      '长时低频': 0,    // 单次长但不频繁
      '均衡使用': 0,     // 中等时长和频率
      '浅度使用': 0      // 短时低频
    },
    // 平均每日会话次数
    avgSessionsPerDay: 0,
    // 最长连续使用天数
    maxConsecutiveDays: 0
  };

  // 分析会话时长分布
  for (const session of sessions) {
    const duration = Number(session.duration) || 0;
    const minutes = Math.floor(duration / 60);
    
    if (minutes <= 5) depthAnalysis.durationDistribution['0-5分钟']++;
    else if (minutes <= 15) depthAnalysis.durationDistribution['5-15分钟']++;
    else if (minutes <= 30) depthAnalysis.durationDistribution['15-30分钟']++;
    else if (minutes <= 60) depthAnalysis.durationDistribution['30-60分钟']++;
    else depthAnalysis.durationDistribution['60+分钟']++;
    
    // 分析时段分布
    if (session.start_time) {
      const hour = new Date(session.start_time).getHours();
      if (hour >= 0 && hour < 6) depthAnalysis.timeOfDayDistribution['凌晨 (0-6点)']++;
      else if (hour >= 6 && hour < 12) depthAnalysis.timeOfDayDistribution['上午 (6-12点)']++;
      else if (hour >= 12 && hour < 18) depthAnalysis.timeOfDayDistribution['下午 (12-18点)']++;
      else depthAnalysis.timeOfDayDistribution['晚上 (18-24点)']++;
    }
  }

  // 分析用户会话模式
  const userSessions = new Map();
  const userDays = new Map();
  
  for (const session of sessions) {
    if (!session.user_id) continue;
    
    // 按用户统计会话
    if (!userSessions.has(session.user_id)) {
      userSessions.set(session.user_id, []);
    }
    userSessions.get(session.user_id).push(session);
    
    // 按用户统计使用天数
    if (session.start_time) {
      const date = new Date(session.start_time).toISOString().slice(0, 10);
      if (!userDays.has(session.user_id)) {
        userDays.set(session.user_id, new Set());
      }
      userDays.get(session.user_id).add(date);
    }
  }

  // 计算平均每日会话次数
  const totalSessions = sessions.length;
  const uniqueDays = new Set();
  for (const session of sessions) {
    if (session.start_time) {
      uniqueDays.add(new Date(session.start_time).toISOString().slice(0, 10));
    }
  }
  depthAnalysis.avgSessionsPerDay = uniqueDays.size > 0 ? (totalSessions / uniqueDays.size).toFixed(2) : 0;

  // 计算最长连续使用天数
  let maxConsecutive = 0;
  for (const [userId, datesSet] of userDays.entries()) {
    const dates = Array.from(datesSet).sort();
    let currentConsecutive = 1;
    let maxUserConsecutive = 1;
    
    for (let i = 1; i < dates.length; i++) {
      const prevDate = new Date(dates[i-1]);
      const currDate = new Date(dates[i]);
      const diffDays = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        currentConsecutive++;
        maxUserConsecutive = Math.max(maxUserConsecutive, currentConsecutive);
      } else if (diffDays > 1) {
        currentConsecutive = 1;
      }
    }
    maxConsecutive = Math.max(maxConsecutive, maxUserConsecutive);
  }
  depthAnalysis.maxConsecutiveDays = maxConsecutive;

  // 分析会话强度
  for (const [userId, userSessionsList] of userSessions.entries()) {
    const sessionCount = userSessionsList.length;
    const totalDuration = userSessionsList.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    const avgDuration = sessionCount > 0 ? totalDuration / sessionCount : 0;
    
    if (avgDuration < 300 && sessionCount >= 10) { // 短时但频繁
      depthAnalysis.sessionIntensity['短时高频']++;
    } else if (avgDuration >= 600 && sessionCount < 5) { // 长时但不频繁
      depthAnalysis.sessionIntensity['长时低频']++;
    } else if (avgDuration >= 300 && sessionCount >= 5) { // 中等使用
      depthAnalysis.sessionIntensity['均衡使用']++;
    } else { // 浅度使用
      depthAnalysis.sessionIntensity['浅度使用']++;
    }
  }

  return depthAnalysis;
}

async function getFeedback() {
  try {
    const { data: fb } = await supabase
      .from('feedback')
      .select('id, user_id, overall_experience, issue_details, feature_requests, additional_comments, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    const list = fb || [];
    const userIds = Array.from(new Set(list.map(x=>x.user_id).filter(Boolean)));
    let roleMap = new Map();
    let nameMap = new Map();
    let emailMap = new Map();
    if (userIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, role, full_name, email')
        .in('id', userIds)
        .limit(10000);
      roleMap = new Map((profs||[]).map(p=> [p.id, p.role]));
      nameMap = new Map((profs||[]).map(p=> [p.id, p.full_name]));
      emailMap = new Map((profs||[]).map(p=> [p.id, p.email]));
    }
    return list.map(x=>({
      id: x.id,
      user_id: x.user_id,
      user_email: emailMap.get(x.user_id) || x.user_email || '',
      user_name: nameMap.get(x.user_id) || '',
      role: roleMap.get(x.user_id) || 'student',
      rating: x.overall_experience || 0,
      text: x.additional_comments || x.feature_requests || x.issue_details || '',
      issue_details: x.issue_details || '',
      feature_requests: x.feature_requests || '',
      additional_comments: x.additional_comments || '',
      created_at: x.created_at,
    }));
  } catch {
    // Fallback: common alternate table name
    const { data } = await supabase
      .from('survey_responses')
      .select('id, role, rating, text, created_at')
      .order('created_at', { ascending: false })
      .limit(1000)
      .then(({data})=>({ data }))
      .catch(()=>({ data: [] }));
    return data || [];
  }
}

async function getPaymentMetrics() {
  // Try "payments" first
  try {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('amount, created_at, plan')
      .limit(50000);
    if (!error && payments) {
      const revenueTotal = payments.reduce((s, p) => s + (Number(p.amount)||0), 0);
      const paidUsers = 0; // unknown without user relation
      const byMonth = new Map();
      for (const p of payments) {
        const d = new Date(p.created_at);
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        byMonth.set(k, (byMonth.get(k)||0) + (Number(p.amount)||0));
      }
      const months = Array.from({length:12}, (_,i)=>{
        const d = new Date(); d.setMonth(d.getMonth()- (11-i));
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      });
      const revenueMonthly = months.map(k=> byMonth.get(k)||0);
      const planMap = new Map();
      for (const p of payments) planMap.set(p.plan||'unknown', (planMap.get(p.plan||'unknown')||0)+1);
      const plans = { labels: Array.from(planMap.keys()), values: Array.from(planMap.values()) };
      return { unavailable: false, revenueTotal, paidUsers, conversion: 0, mrrGrowth: 0, revenueMonthly, plans };
    }
  } catch (e) {}
  // Try "subscriptions"
  try {
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('status, plan, amount, created_at')
      .limit(50000);
    if (!error && subs) {
      const active = subs.filter(s=> (s.status||'').toLowerCase()==='active');
      const paidUsers = active.length;
      const revenueTotal = subs.reduce((s, p)=> s + (Number(p.amount)||0), 0);
      const byMonth = new Map();
      for (const p of subs) {
        const d = new Date(p.created_at);
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        byMonth.set(k, (byMonth.get(k)||0) + (Number(p.amount)||0));
      }
      const months = Array.from({length:12}, (_,i)=>{
        const d = new Date(); d.setMonth(d.getMonth()- (11-i));
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      });
      const revenueMonthly = months.map(k=> byMonth.get(k)||0);
      const planMap = new Map();
      for (const p of subs) planMap.set(p.plan||'unknown', (planMap.get(p.plan||'unknown')||0)+1);
      const plans = { labels: Array.from(planMap.keys()), values: Array.from(planMap.values()) };
      return { unavailable: false, revenueTotal, paidUsers, conversion: 0, mrrGrowth: 0, revenueMonthly, plans };
    }
  } catch (e) {}

  return { unavailable: true, revenueTotal: 0, paidUsers: 0, conversion: 0, mrrGrowth: 0, revenueMonthly: [], plans: { labels: [], values: [] } };
}

async function previewMaintenance() {
  const [courses, homework, exams, sessionsOld, notesRows, learningSessions] = await Promise.all([
    supabase.from('course_schedules').select('id').limit(100000).then(({data})=>({ data })).catch(()=>({ data: [] })),
    supabase.from('homework').select('id, course_id, user_id, title, created_at').limit(50000).then(({data})=>({ data })).catch(()=>({ data: [] })),
    supabase.from('exams').select('id, course_id, user_id, title, created_at').limit(50000).then(({data})=>({ data })).catch(()=>({ data: [] })),
    supabase.from('learning_sessions').select('id, start_time, task_id').lt('start_time', daysAgo(180)).limit(100000).then(({data})=>({ data })).catch(()=>({ data: [] })),
    supabase.from('notes').select('id, course_schedule_id, user_id, title, created_at').limit(50000).then(({data})=>({ data })).catch(()=>({ data: [] })),
    supabase.from('learning_sessions').select('id, task_id').limit(50000).then(({data})=>({ data })).catch(()=>({ data: [] })),
  ]);
  const courseIds = new Set((courses.data||[]).map(c=>c.id));
  const orphanHomework = (homework.data||[]).filter(h=> h.course_id && !courseIds.has(h.course_id));
  const orphanExams = (exams.data||[]).filter(e=> e.course_id && !courseIds.has(e.course_id));
  const orphanNotes = (notesRows.data||[]).filter(n=> n.course_schedule_id && !courseIds.has(n.course_schedule_id));
  const hwIds = new Set((homework.data||[]).map(h=>h.id));
  const orphanSessions = (learningSessions.data||[]).filter(s=> s.task_id && !hwIds.has(s.task_id));
  const orphans = orphanHomework.length + orphanExams.length + orphanNotes.length + orphanSessions.length;

  // Duplicates (homework by user_id+title on same day)
  const dupMap = new Map();
  for (const h of homework.data||[]) {
    const day = new Date(h.created_at).toISOString().slice(0,10);
    const key = `${h.user_id}|${(h.title||'').trim().toLowerCase()}|${day}`;
    dupMap.set(key, (dupMap.get(key)||0)+1);
  }
  let duplicates = 0; for (const v of dupMap.values()) { if (v>1) duplicates += (v-1); }

  // Archives: sessions over 180 days
  const archives = sessionsOld.data?.length || 0;
  return { orphans, duplicates, archives, sample: { orphanHomework: orphanHomework.slice(0,5), orphanExams: orphanExams.slice(0,5), orphanNotes: orphanNotes.slice(0,5), orphanSessions: orphanSessions.slice(0,5) } };
}

async function doCleanup() {
  const [courses, homework, exams] = await Promise.all([
    supabase.from('course_schedules').select('id').limit(100000).then(({data})=>({ data })).catch(()=>({ data: [] })),
    supabase.from('homework').select('id, course_id').limit(50000).then(({data})=>({ data })).catch(()=>({ data: [] })),
    supabase.from('exams').select('id, course_id').limit(50000).then(({data})=>({ data })).catch(()=>({ data: [] })),
  ]);
  const courseIds = new Set((courses.data||[]).map(c=>c.id));
  const orphanHIds = (homework.data||[]).filter(h=> h.course_id && !courseIds.has(h.course_id)).map(h=>h.id);
  const orphanEIds = (exams.data||[]).filter(e=> e.course_id && !courseIds.has(e.course_id)).map(e=>e.id);
  let deleted = 0;
  if (orphanHIds.length) {
    const { error } = await supabase.from('homework').delete().in('id', orphanHIds.slice(0, 1000));
    if (error) throw error; deleted += Math.min(orphanHIds.length, 1000);
  }
  if (orphanEIds.length) {
    const { error } = await supabase.from('exams').delete().in('id', orphanEIds.slice(0, 1000));
    if (error) throw error; deleted += Math.min(orphanEIds.length, 1000);
  }
  return { deleted, orphanHIds: orphanHIds.length, orphanEIds: orphanEIds.length };
}

async function doDedupe() {
  const { data: hw } = await supabase.from('homework').select('id, user_id, title, created_at').limit(50000).then(({data})=>({ data })).catch(()=>({ data: [] }));
  const groups = new Map();
  for (const h of hw||[]) {
    const day = new Date(h.created_at).toISOString().slice(0,10);
    const key = `${h.user_id}|${(h.title||'').trim().toLowerCase()}|${day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  const deleteIds = [];
  for (const arr of groups.values()) {
    if (arr.length>1) {
      arr.sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
      deleteIds.push(...arr.slice(1).map(x=>x.id));
    }
  }
  if (deleteIds.length) {
    const { error } = await supabase.from('homework').delete().in('id', deleteIds.slice(0, 1000));
    if (error) throw error;
  }
  return { deleted: Math.min(deleteIds.length, 1000) };
}

async function deleteUserCascade(userId) {
  const tables = [
    { table: 'homework', col: 'user_id' },
    { table: 'exams', col: 'user_id' },
    { table: 'notes', col: 'user_id' },
    { table: 'learning_sessions', col: 'user_id' },
    { table: 'feedback', col: 'user_id' },
  ];
  for (const t of tables) {
    try { await supabase.from(t.table).delete().eq(t.col, userId); } catch (e) {}
  }
  try { await supabase.from('profiles').delete().eq('id', userId); } catch (e) {}
  let authDeleted = false;
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (!error) authDeleted = true;
  } catch (e) {}
  return { authDeleted };
}

// Banner visibility management functions
async function getBannerVisibility() {
  try {
    // 使用Supabase存储banner状态
    const { data, error } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'banner_visible')
      .single();
    
    if (error) {
      console.log('Banner visibility check failed, trying file fallback:', error.message);
      // 如果表不存在或记录不存在，尝试文件fallback
      return getBannerVisibilityFromFile();
    }
    
    return data.value === 'true' || data.value === true;
  } catch (e) {
    console.error('Failed to get banner visibility:', e);
    return getBannerVisibilityFromFile(); // 尝试文件fallback
  }
}

function getBannerVisibilityFromFile() {
  try {
    const fs = require('fs');
    const path = require('path');
    const bannerFile = path.join(__dirname, 'banner_state.json');
    
    if (fs.existsSync(bannerFile)) {
      const data = fs.readFileSync(bannerFile, 'utf8');
      const state = JSON.parse(data);
      return state.visible !== false; // 默认为true
    }
    
    return true; // 默认显示
  } catch (e) {
    console.error('Failed to read banner state from file:', e);
    return true; // 默认显示
  }
}

async function setBannerVisibility(visible) {
  try {
    // 首先检查admin_settings表是否存在
    const { error: checkError } = await supabase
      .from('admin_settings')
      .select('key')
      .limit(1);
    
    if (checkError) {
      console.log('admin_settings table does not exist, using file fallback');
      // 表不存在，使用文件存储作为fallback
      return setBannerVisibilityToFile(visible);
    }
    
    // 表存在，使用Supabase存储
    const { error } = await supabase
      .from('admin_settings')
      .upsert(
        { 
          key: 'banner_visible', 
          value: visible,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'key' }
      );
    
    if (error) {
      console.error('Failed to set banner visibility in database, using file fallback:', error);
      // 数据库操作失败，使用文件fallback
      return setBannerVisibilityToFile(visible);
    }
    
    return true;
  } catch (e) {
    console.error('Failed to set banner visibility:', e);
    // 任何错误都使用文件fallback
    return setBannerVisibilityToFile(visible);
  }
}

function setBannerVisibilityToFile(visible) {
  try {
    const fs = require('fs');
    const path = require('path');
    const bannerFile = path.join(__dirname, 'banner_state.json');
    
    const state = { visible, updated: new Date().toISOString() };
    fs.writeFileSync(bannerFile, JSON.stringify(state, null, 2));
    console.log('Banner visibility saved to file:', visible);
    return true;
  } catch (e) {
    console.error('Failed to save banner state to file:', e);
    throw new Error('File storage failed');
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, {});

  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;
  
  const forcedPath = url.searchParams.get('__path');
  if (forcedPath) {
    pathname = forcedPath.startsWith('/') ? forcedPath : `/${forcedPath}`;
  } else if (pathname.startsWith('/api')) {
    pathname = pathname.replace(/^\/api/, '');
    if (pathname === '') pathname = '/';
  }
  
  // 调试端点
  if (pathname === '/debug') {
    return send(res, 200, {
      ok: true,
      env: {
        SUPABASE_URL_SET: !!SUPABASE_URL,
        PORT: process.env.PORT,
        VERCEL: process.env.VERCEL
      },
      request: {
        url: req.url,
        pathname: pathname,
        method: req.method,
        headers: req.headers
      }
    });
  }

  const role = url.searchParams.get('role') || 'all';
  const isAdmin = requireAdmin(req);

  try {
    if (pathname === '/' || pathname === '/admin' || pathname === '/admin.html') {
      const filePath = path.join(__dirname, '..', 'studyflow-web', 'admin.html');
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        return sendText(res, 200, html, 'text/html; charset=utf-8');
      } catch (e) {
        return send(res, 500, { ok: false, error: 'Admin frontend not found' });
      }
    }

    if (pathname === '/styles.css') {
      const cssPath = path.join(__dirname, '..', 'studyflow-web', 'styles.css');
      try {
        const css = fs.readFileSync(cssPath, 'utf8');
        return sendText(res, 200, css, 'text/css; charset=utf-8');
      } catch (e) {
        return bad(res, 'Not Found');
      }
    }

    if (pathname === '/health') return ok(res, { status: 'ok' });

    if (pathname === '/ai/parse-voice-task' && req.method === 'POST') {
        return send(res, 500, { ok: false, error: 'Server AI key not configured' });
      }
      let body;
      try { body = await readJson(req); } catch (e) { return bad(res, e.message); }
      const inputText = String((body && body.inputText) || '').trim();
      const subject = body && body.subject ? String(body.subject) : '';
      if (!inputText) return bad(res, 'Missing inputText');
      const flashUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
      const liteUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=' + apiKey;
      const systemInstruction = buildTaskInstruction(subject ? { subject } : null);
      const reqBody = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemInstruction + '\n\nInput:\n' + inputText }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512
        }
      };
      let data;
      try {
        data = await postGeminiWithRetry(flashUrl, reqBody, { maxRetries: 2, baseDelayMs: 1000 });
      } catch (e) {
        const msg = String((e && e.message) || '');
        if (/429/.test(msg) || /RESOURCE_EXHAUSTED/i.test(msg)) {
          data = await postGeminiWithRetry(liteUrl, reqBody, { maxRetries: 2, baseDelayMs: 1200 });
        } else if (/Gemini API error: 4(01|03)/.test(msg)) {
          return send(res, 401, { ok: false, error: 'Missing or invalid Google API key' });
        } else {
          return send(res, 500, { ok: false, error: msg || 'AI parse failed' });
        }
      }
      const parts = (((data || {}).candidates || [])[0] || {}).content ? (((data || {}).candidates || [])[0]).content.parts : [];
      const textOut = (Array.isArray(parts) ? parts : []).map(p => p && p.text).filter(t => typeof t === 'string').join('\n') || '';
      let parsed;
      try {
        parsed = extractJson(textOut);
      } catch (e) {
        return send(res, 500, { ok: false, error: 'AI returned invalid JSON' });
      }
      if (parsed && parsed.time && typeof parsed.time === 'string') {
        const t = parsed.time.trim();
        if (/^\d{2}:\d{2}$/.test(t)) {
          parsed.time = t + ':00';
        }
      }
      if (parsed && parsed.priority && !['low', 'normal', 'important'].includes(parsed.priority)) {
        parsed.priority = 'normal';
      }
      if (parsed && parsed.title) parsed.title = String(parsed.title).trim();
      if (parsed && parsed.description) parsed.description = String(parsed.description).trim();
      return ok(res, { result: parsed });
    }

    if (pathname === '/ai/parse-timetable' && req.method === 'POST') {
        return send(res, 500, { ok: false, error: 'Server AI key not configured' });
      }
      let body;
      try { body = await readJson(req); } catch (e) { return bad(res, e.message); }
      const imageBase64 = String((body && body.imageBase64) || '').trim();
      const mimeType = String((body && body.mimeType) || 'image/jpeg');
      if (!imageBase64) return bad(res, 'Missing imageBase64');
      // Log key prefix for debugging
      console.log('[admin-api] Using Google API Key:', apiKey.substring(0, 10) + '...');
      
      const flashUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
      const liteUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=' + apiKey;
      
      const reqBody = {
        contents: [ { role: 'user', parts: [ { text: buildTimetableInstruction() }, { inline_data: { mime_type: mimeType, data: imageBase64 } } ] } ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, response_mime_type: 'application/json' }
      };
      let data;
      try {
        console.log('[admin-api] AI parse timetable: using', flashUrl);
        // More aggressive retries: 3 retries, start at 2s
        data = await postGeminiWithRetry(flashUrl, reqBody, { maxRetries: 3, baseDelayMs: 2000 });
      } catch (e) {
        const msg = String((e && e.message) || '');
        console.error('[admin-api] Flash model failed:', msg);
        
        // Try Lite model
        try {
          console.log('[admin-api] AI parse timetable fallback: using', liteUrl);
          data = await postGeminiWithRetry(liteUrl, reqBody, { maxRetries: 3, baseDelayMs: 2000 });
        }
        catch (e2) {
          const m2 = String((e2 && e2.message) || '');
          console.error('[admin-api] Flash-Lite model failed:', m2);
          
          if (/429/.test(m2) || /RESOURCE_EXHAUSTED/i.test(m2)) {
            return send(res, 503, { ok: false, error: 'AI service busy. Please try again later.' });
          } else {
            return send(res, 500, { ok: false, error: m2 || 'AI parse failed' });
          }
        }
      }
      const parts = (((data || {}).candidates || [])[0] || {}).content ? (((data || {}).candidates || [])[0]).content.parts : [];
      const textOut = (Array.isArray(parts) ? parts : []).map(p => p && p.text).filter(t => typeof t === 'string').join('\n') || '';
      let parsed;
      try { parsed = extractJson(textOut); } catch {
        const retryBody = {
          contents: [ { role: 'user', parts: [ { text: buildTimetableInstruction() + '\nReturn only valid JSON.' }, { inline_data: { mime_type: mimeType, data: imageBase64 } } ] } ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        };
        let retryData;
        try {
          console.log('[admin-api] AI parse timetable JSON retry: using', flashUrl);
          retryData = await postGeminiWithRetry(flashUrl, retryBody, { maxRetries: 1, baseDelayMs: 800 });
        }
        catch (e2) {
          const m2 = String((e2 && e2.message) || '');
          if (/429/.test(m2) || /RESOURCE_EXHAUSTED/i.test(m2)) {
            console.log('[admin-api] AI parse timetable JSON retry fallback: using', liteUrl);
            retryData = await postGeminiWithRetry(liteUrl, retryBody, { maxRetries: 1, baseDelayMs: 1000 });
          } else {
            console.log('[admin-api] AI parse timetable JSON retry non-429 fallback: using', liteUrl);
            retryData = await postGeminiWithRetry(liteUrl, retryBody, { maxRetries: 1, baseDelayMs: 1000 });
          }
        }
        const parts2 = (((retryData || {}).candidates || [])[0] || {}).content ? (((retryData || {}).candidates || [])[0]).content.parts : [];
        const retryText = (Array.isArray(parts2) ? parts2 : []).map(p => p && p.text).filter(t => typeof t === 'string').join('\n') || '';
        parsed = extractJson(retryText);
      }
      const classes = Array.isArray(parsed && parsed.classes) ? parsed.classes : [];
      const normalized = classes.map(c => {
        const dayIdx = dayNameToIndex(String(((c || {}).dayOfWeek || (c || {}).day || (c || {}).weekday || (c || {}).dayIndex || '')));
        const start = normalizeHM(String(((c || {}).startTime || (c || {}).start || (c || {}).start_time || '')));
        const end = normalizeHM(String(((c || {}).endTime || (c || {}).end || (c || {}).end_time || '')));
        return {
          subject: String(((c || {}).subject || (c || {}).course || (c || {}).name || '')).trim(),
          teacher: (c && c.teacher) ? String(c.teacher).trim() : undefined,
          room: (c && c.room) ? String(c.room).trim() : undefined,
          dayOfWeek: dayIdx,
          startTime: start,
          endTime: end,
        };
      }).filter(c => c.subject && c.dayOfWeek >= 1 && c.startTime && c.endTime);
      return ok(res, { result: { classes: normalized } });
    }

    if (pathname === '/metrics/users') {
      if (!isAdmin) return unauthorized(res);
      const m = await getUsersMetrics(role);
      return ok(res, { metrics: { total: m.total, parents: m.parents, students: m.students, new7: m.new7, registrationTrend: m.registrationTrend } });
    }
    if (pathname === '/users/delete' && req.method === 'POST') {
      if (!isAdmin) return unauthorized(res);
      let body;
      try { body = await readJson(req); } catch (e) { return bad(res, e.message); }
      const userId = (body && body.id) ? String(body.id) : '';
      if (!userId) return bad(res, 'Missing id');
      const result = await deleteUserCascade(userId);
      return ok(res, { result });
    }
    if (pathname === '/users') {
      if (!isAdmin) return unauthorized(res);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const result = await getUsersList(role, page, limit);
      return ok(res, result);
    }
    if (pathname === '/metrics/behavior') {
      if (!isAdmin) return unauthorized(res);
      const m = await getBehaviorMetrics(role);
      return ok(res, { metrics: m });
    }
    if (pathname === '/feedback') {
      if (!isAdmin) return unauthorized(res);
      const list = await getFeedback();
      return ok(res, { items: list });
    }
    if (pathname === '/backup/data' && req.method === 'GET') {
      if (!isAdmin) return unauthorized(res);
      
      try {
        // 获取所有重要数据表的原始数据
        const [profiles, feedback, courses, homework, exams, sessions, notes, flashcards, pomodoro] = await Promise.all([
          supabase.from('profiles').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('feedback').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('course_schedules').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('homework').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('exams').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('learning_sessions').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('notes').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('flashcards').select('*').limit(10000).then(({data}) => data || []),
          supabase.from('pomodoro_sessions').select('*').limit(10000).then(({data}) => data || [])
        ]);
        
        const backupData = {
          timestamp: new Date().toISOString(),
          version: '1.0',
          tables: {
            profiles,
            feedback,
            course_schedules: courses,
            homework,
            exams,
            learning_sessions: sessions,
            notes,
            flashcards,
            pomodoro_sessions: pomodoro
          },
          metadata: {
            totalRecords: profiles.length + feedback.length + courses.length + homework.length + 
                         exams.length + sessions.length + notes.length + flashcards.length + pomodoro.length,
            backupType: 'full'
          }
        };
        
        return ok(res, backupData);
      } catch (error) {
        console.error('Backup error:', error);
        return send(res, 500, { ok: false, error: 'Backup failed: ' + error.message });
      }
    }
    
    if (pathname === '/feedback/delete' && req.method === 'POST') {
      if (!isAdmin) return unauthorized(res);
      let body;
      try { body = await readJson(req); } catch (e) { return bad(res, e.message); }
      
      const userId = body && body.user_id ? String(body.user_id) : '';
      
      console.log('删除反馈请求:', { userId, userEmail: body.user_email, feedbackId: body.feedback_id });
        
        if (!userId && !body.feedback_id) {
          console.log('缺少 user_id 或 feedback_id 参数');
          return bad(res, 'Missing user_id or feedback_id');
        }
        
        try {
          let query = supabase.from('feedback').delete();
          
          if (body.feedback_id) {
            console.log('正在删除单个反馈:', body.feedback_id);
            query = query.eq('id', body.feedback_id);
          } else {
            console.log('正在删除用户所有反馈:', userId);
            query = query.eq('user_id', userId);
          }
          
          const { error } = await query;
          
          if (error) {
            console.error('删除反馈数据库错误:', error);
            throw error;
          }
          
          console.log('成功删除反馈');
          return ok(res, { deleted: true, message: 'Feedback deleted successfully' });
        } catch (error) {
          console.error('删除反馈错误:', error);
          return send(res, 500, { ok: false, error: 'Failed to delete feedback' });
        }
    }
    if (pathname === '/metrics/payment') {
      if (!isAdmin) return unauthorized(res);
      const m = await getPaymentMetrics();
      return ok(res, { metrics: m });
    }
    if (pathname === '/maintenance/preview') {
      if (!isAdmin) return unauthorized(res);
      const m = await previewMaintenance();
      return ok(res, { metrics: m });
    }
    if (pathname === '/maintenance/cleanup') {
      if (!isAdmin) return unauthorized(res);
      const result = await doCleanup();
      return ok(res, { result });
    }
    if (pathname === '/maintenance/dedupe') {
      if (!isAdmin) return unauthorized(res);
      const result = await doDedupe();
      return ok(res, { result });
    }
    if (pathname === '/maintenance/reindex' || pathname === '/maintenance/archive' || pathname === '/maintenance/vacuum') {
      if (!isAdmin) return unauthorized(res);
      return ok(res, { result: { message: 'noop (requires managed environment)' } });
    }

    // Banner visibility control endpoints
    if (pathname === '/banner/status') {
      if (req.method === 'GET') {
        const visible = await getBannerVisibility();
        return ok(res, { visible });
      } else if (req.method === 'POST') {
        if (!isAdmin) return unauthorized(res);
        let body;
        try { body = await readJson(req); } catch (e) { return bad(res, e.message); }
        const visible = body && typeof body.visible === 'boolean' ? body.visible : true;
        await setBannerVisibility(visible);
        return ok(res, { visible });
      }
  }

  // 数据库恢复端点 - 从备份文件恢复数据
    if (pathname === '/backup/restore' && req.method === 'POST') {
      if (!isAdmin) return unauthorized(res);
      
      let body;
      try { body = await readJson(req); } catch (e) { return bad(res, e.message); }
      
      if (!body || !body.backupData) {
        return bad(res, 'Missing backupData in request body');
      }
      
      // 安全选项验证
      const safeMode = body.safeMode !== false; // 默认启用安全模式
      const dryRun = body.dryRun === true;      // 干跑模式，只验证不实际插入
      
      try {
        const backupData = body.backupData;
        let totalRestored = 0;
        const restoreResults = {};
        
        // 验证备份文件时间戳（避免恢复太旧的备份）
        if (safeMode && backupData.timestamp) {
          const backupDate = new Date(backupData.timestamp);
          const now = new Date();
          const diffDays = Math.floor((now - backupDate) / (1000 * 60 * 60 * 24));
          
          if (diffDays > 30) {
            return send(res, 400, { 
              ok: false, 
              error: `备份文件过于陈旧（${diffDays}天前）。如需强制恢复，请禁用安全模式。` 
            });
          }
        }
        
        // 按依赖顺序恢复表（减少外键错误）
        const restoreOrder = [
          'profiles',          // 用户表最先恢复
          'course_schedules',  // 课程安排
          'learning_sessions', // 学习会话
          'notes',             // 笔记
          'flashcards',        // 闪卡
          'pomodoro_sessions', // 番茄钟
          'homework',          // 作业
          'exams',             // 考试
          'feedback'           // 反馈最后
        ];
        
        for (const tableName of restoreOrder) {
          const records = backupData.tables[tableName];
          if (Array.isArray(records) && records.length > 0) {
            
            if (dryRun) {
              // 干跑模式：只验证不插入
              restoreResults[tableName] = { 
                success: true, 
                records: records.length,
                dryRun: true,
                message: '验证通过（干跑模式）'
              };
              totalRestored += records.length;
              continue;
            }
            
            // 分批插入数据（避免一次性插入太多数据）
            const batchSize = 50; // 减小批次大小提高安全性
            let successCount = 0;
            
            for (let i = 0; i < records.length; i += batchSize) {
              const batch = records.slice(i, i + batchSize);
              
              if (safeMode) {
                // 安全模式：使用upsert避免覆盖现有数据
                const { error } = await supabase.from(tableName).upsert(batch, {
                  onConflict: 'id',
                  ignoreDuplicates: true // 忽略重复记录
                });
                
                if (error) {
                  console.error(`恢复表 ${tableName} 批次 ${i/batchSize + 1} 失败:`, error);
                  restoreResults[tableName] = { success: false, error: error.message };
                  break;
                }
                successCount += batch.length;
                
              } else {
                // 非安全模式：直接upsert可能覆盖现有数据
                const { error } = await supabase.from(tableName).upsert(batch);
                
                if (error) {
                  console.error(`恢复表 ${tableName} 批次 ${i/batchSize + 1} 失败:`, error);
                  restoreResults[tableName] = { success: false, error: error.message };
                  break;
                }
                successCount += batch.length;
              }
            }
            
            if (!restoreResults[tableName] || restoreResults[tableName].success !== false) {
              restoreResults[tableName] = { success: true, records: successCount };
              totalRestored += successCount;
            }
          }
        }
        
        return ok(res, {
          success: true,
          totalRestored,
          results: restoreResults,
          dryRun: dryRun,
          safeMode: safeMode,
          message: dryRun ? 
            `干跑模式完成：验证 ${totalRestored} 条记录` : 
            `成功恢复 ${totalRestored} 条记录`
        });
        
      } catch (error) {
        console.error('恢复错误:', error);
        return send(res, 500, { ok: false, error: 'Restore failed: ' + error.message });
      }
    }
    
    // 数据库结构备份端点（获取表结构信息）
    if (pathname === '/backup/schema' && req.method === 'GET') {
      if (!isAdmin) return unauthorized(res);
      
      try {
        // 获取所有表名
        const { data: tables, error } = await supabase
          .from('information_schema.tables')
          .select('table_name')
          .eq('table_schema', 'public');
        
        if (error) throw error;
        
        const schemaInfo = {};
        
        // 获取每个表的列信息
        for (const table of tables) {
          const { data: columns } = await supabase
            .from('information_schema.columns')
            .select('*')
            .eq('table_schema', 'public')
            .eq('table_name', table.table_name);
          
          schemaInfo[table.table_name] = columns || [];
        }
        
        return ok(res, {
          timestamp: new Date().toISOString(),
          schema: schemaInfo
        });
        
      } catch (error) {
        console.error('Schema backup error:', error);
        return send(res, 500, { ok: false, error: 'Schema backup failed: ' + error.message });
      }
    }
    
    return bad(res, 'Not Found');
  } catch (e) {
    console.error('[admin-api] error:', e);
    return send(res, 500, { ok: false, error: e.message || String(e) });
  }
};
