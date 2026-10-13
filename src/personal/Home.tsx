import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarDays, CheckCircle2, CloudSun, Plus } from "lucide-react";
import type { Task } from "../types";
import { profileLocalStorage } from "../profileStorage";
import { personalSnapshot, subscribePersonal } from "./runtime";
import { taskOwnerLabel, PENDING } from "./model";
import "./home.css";

interface Weather { city: string; latitude: number; longitude: number; temperature: number; code: number; fetchedAt: string }
const WEATHER_KEY = "oceanseo.personal.weather.v1";
function readWeather(): Weather | null {
  try { const v = JSON.parse(profileLocalStorage.getItem(WEATHER_KEY) ?? "null");
    return v && typeof v.city === "string" && Number.isFinite(v.temperature) && Number.isFinite(v.latitude) && Number.isFinite(v.longitude) ? v : null;
  } catch { return null; }
}
function weatherLabel(code: number) {
  if (code === 0) return "晴";
  if (code <= 3) return "多云";
  if (code < 50) return "雾";
  if (code < 70) return "雨";
  if (code < 80) return "雪";
  if (code < 95) return "阵雨";
  return "雷雨";
}
export default function PersonalHome({ tasks, onOpenTask, onNewTask }: { tasks: Task[]; onOpenTask: (task: Task) => void; onNewTask: () => void }) {
  const doc = useSyncExternalStore(subscribePersonal, personalSnapshot)!;
  const [now, setNow] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [owner, setOwner] = useState("all");
  const [city, setCity] = useState("");
  const [weather, setWeather] = useState(readWeather);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  async function loadWeather() {
    if (!city.trim() || weatherBusy) return;
    setWeatherBusy(true); setWeatherError("");
    try {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&language=zh&format=json`, { signal: AbortSignal.timeout(15000) });
      if (!geo.ok) throw Error("城市查询暂不可用");
      const location = (await geo.json()).results?.[0];
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw Error("未找到城市，请尝试其他名称");
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,weather_code&timezone=auto`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error("天气服务暂不可用");
      const data = (await response.json()).current;
      if (!data || !Number.isFinite(data.temperature_2m) || !Number.isFinite(data.weather_code)) throw Error("天气数据暂不可用");
      const value: Weather = { city: location.name, latitude: location.latitude, longitude: location.longitude, temperature: data.temperature_2m, code: data.weather_code, fetchedAt: new Date().toISOString() };
      profileLocalStorage.setItem(WEATHER_KEY, JSON.stringify(value)); setWeather(value);
    } catch (e) { setWeatherError(e instanceof Error ? e.message : "天气暂不可用"); }
    finally { setWeatherBusy(false); }
  }
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const today = key(now);
  const active = tasks.filter(t => !t.completedAt && (owner === "all" || (doc.taskOwners[t.id] ?? PENDING) === owner));
  const firstDay = (month.getDay()+6)%7;
  const days = new Date(month.getFullYear(), month.getMonth()+1, 0).getDate();
  return <div className="personal-home">
    <section className="personal-home-time" aria-label="时间"><div><span className="personal-home-kicker">YOUR DAY, AT A GLANCE</span><h2>留一点空间，<br/>给今天的自己。</h2><p>{now.toLocaleDateString("zh-CN", { year:"numeric", month:"long", day:"numeric", weekday:"long" })}</p></div>
      <time dateTime={now.toISOString()}>{now.toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit", hour12:false })}<span>{String(now.getSeconds()).padStart(2,"0")}</span></time>
    </section>
    <div className="personal-home-widgets">
      <section className="personal-weather" aria-label="天气"><header><CloudSun size={18}/><h3>窗外的天气</h3></header>
        {weather ? <><strong>{Math.round(weather.temperature)}<span>°C</span></strong><p>{weather.city} · {weatherLabel(weather.code)}</p><small>更新于 {new Date(weather.fetchedAt).toLocaleString("zh-CN")} · Open-Meteo</small></> : <><strong className="weather-placeholder">—</strong><p>选择一座城市，看看今天的天气。</p></>}
        <form onSubmit={e => { e.preventDefault(); void loadWeather(); }}><label><span className="sr-only">天气城市</span><input aria-label="天气城市" value={city} onChange={e => setCity(e.target.value)} placeholder="输入城市名称" maxLength={80}/></label><button type="submit" disabled={weatherBusy || !city.trim()}>{weatherBusy ? "查询中" : "查询"}</button></form>
        <small>查询会将城市名称发送给 Open-Meteo。</small>{weatherError && <p role="status">{weatherError}</p>}
      </section>
      <section className="personal-calendar" aria-label="主页日历"><header><CalendarDays size={18}/><h3>{month.getFullYear()} 年 {month.getMonth()+1} 月</h3><button type="button" aria-label="上个月" onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>‹</button><button type="button" aria-label="下个月" onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>›</button></header>
        <div className="personal-calendar-grid">{["一","二","三","四","五","六","日"].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
          {Array.from({length:firstDay},(_,i) => <span key={`blank-${i}`}/>)}
          {Array.from({length:days},(_,i) => {
            const date = key(new Date(month.getFullYear(),month.getMonth(),i+1)); const dayTasks = tasks.filter(t => !t.completedAt && (t.startDate === date || t.dueDate === date));
            return <button type="button" key={date} aria-label={`${date}${dayTasks.length ? `，${dayTasks.length} 项待办` : ""}`} className={date === today ? "is-today" : ""} onClick={() => { if(dayTasks[0]) onOpenTask(dayTasks[0]); }}><span>{i+1}</span>{!!dayTasks.length && <small>{dayTasks.length}</small>}</button>;
          })}</div><p>日程来自所有工作区的共享待办。</p>
      </section>
    </div>
    <section className="personal-home-tasks" aria-label="总体待办"><header><div><span className="personal-home-kicker">ONE SHARED LIST</span><h3>总体待办 <span>{active.length}</span></h3></div>
      <label><span className="sr-only">按工作区筛选待办</span><select aria-label="按工作区筛选待办" value={owner} onChange={e => setOwner(e.target.value)}><option value="all">所有工作区</option><option value={PENDING}>待定</option>{doc.workspaces.filter(w=>!w.deleted).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <button type="button" onClick={onNewTask}><Plus size={15}/>添加待办</button></header>
      {active.map(task => <button className="personal-home-task" type="button" key={task.id} onClick={() => onOpenTask(task)}><CheckCircle2 size={18}/><span><strong>{task.title}</strong><small>{task.dueDate ? `${task.dueDate} 截止` : "不设期限"}</small></span><span className="task-workspace-label">{taskOwnerLabel(doc,task.id)}</span></button>)}
      {!active.length && <div className="personal-home-empty"><CheckCircle2 size={25}/><p>这里还没有待办。</p><button type="button" onClick={onNewTask}>记下第一件事</button></div>}
    </section>
  </div>;
}
