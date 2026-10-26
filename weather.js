// 天氣：Open-Meteo（免費、不需要金鑰）
const DEFAULT_LOC = { lat: 25.0772, lon: 121.3929, name: '林口區' };
const KEY = 'matrix-todo:weather';
const TTL = 30 * 60 * 1000;

const CODES = {
  0: ['☀️', '🌙', '晴朗'], 1: ['🌤️', '🌙', '大致晴朗'], 2: ['⛅', '☁️', '晴時多雲'], 3: ['☁️', '☁️', '陰天'],
  45: ['🌫️', '🌫️', '有霧'], 48: ['🌫️', '🌫️', '霧凇'],
  51: ['🌦️', '🌧️', '毛毛雨'], 53: ['🌦️', '🌧️', '毛毛雨'], 55: ['🌧️', '🌧️', '毛毛雨'],
  56: ['🌧️', '🌧️', '凍毛毛雨'], 57: ['🌧️', '🌧️', '凍毛毛雨'],
  61: ['🌦️', '🌧️', '小雨'], 63: ['🌧️', '🌧️', '下雨'], 65: ['🌧️', '🌧️', '大雨'],
  66: ['🌧️', '🌧️', '凍雨'], 67: ['🌧️', '🌧️', '凍雨'],
  71: ['🌨️', '🌨️', '小雪'], 73: ['🌨️', '🌨️', '下雪'], 75: ['❄️', '❄️', '大雪'], 77: ['🌨️', '🌨️', '雪粒'],
  80: ['🌦️', '🌧️', '陣雨'], 81: ['🌧️', '🌧️', '陣雨'], 82: ['⛈️', '⛈️', '強陣雨'],
  85: ['🌨️', '🌨️', '陣雪'], 86: ['🌨️', '🌨️', '陣雪'],
  95: ['⛈️', '⛈️', '雷雨'], 96: ['⛈️', '⛈️', '雷雨冰雹'], 99: ['⛈️', '⛈️', '雷雨冰雹'],
};
export const wIcon = (code, day = true) => (CODES[code] || ['🌡️', '🌡️'])[day ? 0 : 1];
export const wText = (code) => (CODES[code] || [, , '—'])[2];
export function uvText(uv) {
  if (uv == null) return '—';
  const v = Math.round(uv);
  const lv = v <= 2 ? '低量級' : v <= 5 ? '中量級' : v <= 7 ? '高量級' : v <= 10 ? '過量級' : '危險級';
  return `${v} ${lv}`;
}

export function cached() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, name: '目前位置' }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 3600 * 1000 },
    );
  });
}

export async function load({ useGps = false, unit = 'c', force = false } = {}) {
  const c = cached();
  if (!force && c && Date.now() - c.at < TTL && c.unit === unit && c.useGps === useGps) return c;
  const loc = (useGps && (await getPosition())) || DEFAULT_LOC;
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: loc.lat.toFixed(3), longitude: loc.lon.toFixed(3),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset',
    timezone: 'auto', past_days: '7', forecast_days: '14',
    temperature_unit: unit === 'f' ? 'fahrenheit' : 'celsius',
  });
  const r = await fetch(u);
  if (!r.ok) throw new Error('天氣讀取失敗');
  const j = await r.json();
  const days = {};
  j.daily.time.forEach((d, i) => {
    days[d] = {
      code: j.daily.weather_code[i], max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i],
      rain: j.daily.precipitation_probability_max[i], uv: j.daily.uv_index_max[i],
      sunrise: j.daily.sunrise[i]?.slice(11, 16), sunset: j.daily.sunset[i]?.slice(11, 16),
    };
  });
  const out = {
    at: Date.now(), unit, useGps, place: loc.name,
    now: {
      temp: j.current.temperature_2m, feel: j.current.apparent_temperature, hum: j.current.relative_humidity_2m,
      code: j.current.weather_code, wind: j.current.wind_speed_10m, day: !!j.current.is_day,
    },
    days,
  };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch {}
  return out;
}
