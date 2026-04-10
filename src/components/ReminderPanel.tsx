import React, { useState, useEffect, useCallback } from 'react';

interface Reminder {
  id: string;
  petId: string;
  label: string;
  message: string;
  type: 'fixed' | 'interval';
  time?: string;
  intervalMinutes?: number;
  enabled: boolean;
  createdAt: string;
}

interface ReminderPanelProps {
  backendUrl: string;
  petId: string;
  light?: boolean; // light background mode (Electron overlay)
}

export default function ReminderPanel({ backendUrl, petId, light = false }: ReminderPanelProps) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // reminder id or 'new'
  const [form, setForm] = useState<Partial<Reminder>>({});

  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/api/pets/${petId}/reminders`);
      const data = await res.json();
      setReminders(data);
    } catch {}
  }, [backendUrl, petId]);

  useEffect(() => { fetchReminders(); }, [fetchReminders]);

  const toggleEnabled = async (r: Reminder) => {
    await fetch(`${backendUrl}/api/pets/${petId}/reminders/${r.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    fetchReminders();
  };

  const deleteReminder = async (id: string) => {
    await fetch(`${backendUrl}/api/pets/${petId}/reminders/${id}`, { method: 'DELETE' });
    fetchReminders();
  };

  const startEdit = (r?: Reminder) => {
    if (r) {
      setForm({ label: r.label, message: r.message, type: r.type, time: r.time, intervalMinutes: r.intervalMinutes });
      setEditing(r.id);
    } else {
      setForm({ label: '', message: '', type: 'fixed', time: '12:00', intervalMinutes: 60 });
      setEditing('new');
    }
  };

  const saveEdit = async () => {
    if (!form.label || !form.message) return;
    const body: any = { label: form.label, message: form.message, type: form.type };
    if (form.type === 'fixed') body.time = form.time;
    else body.intervalMinutes = form.intervalMinutes;

    if (editing === 'new') {
      await fetch(`${backendUrl}/api/pets/${petId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch(`${backendUrl}/api/pets/${petId}/reminders/${editing}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    setEditing(null);
    fetchReminders();
  };

  // Adaptive colors for light/dark modes
  const c = light
    ? { text: '#333', sub: '#666', muted: '#999', inputBg: 'rgba(0,0,0,0.06)', inputBorder: 'rgba(0,0,0,0.15)', itemBg: 'rgba(0,0,0,0.04)', labelOn: '#333', labelOff: '#aaa' }
    : { text: '#ddd', sub: '#aaa', muted: '#999', inputBg: 'rgba(255,255,255,0.1)', inputBorder: 'rgba(255,255,255,0.2)', itemBg: 'rgba(255,255,255,0.05)', labelOn: '#fff', labelOff: '#888' };

  if (editing) {
    return (
      <div style={styles.panel}>
        <div style={{ ...styles.header, color: c.text }}>
          <span>{editing === 'new' ? '新建提醒' : '编辑提醒'}</span>
          <button style={{ ...styles.closeBtn, color: c.muted }} onClick={() => setEditing(null)}>✕</button>
        </div>
        <label style={{ ...styles.fieldLabel, color: c.sub }}>标签</label>
        <input style={{ ...styles.input, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text }} value={form.label || ''} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="例：吃午饭" />
        <label style={{ ...styles.fieldLabel, color: c.sub }}>提醒消息</label>
        <input style={{ ...styles.input, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text }} value={form.message || ''} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="例：主人～该吃午饭啦！" />
        <label style={{ ...styles.fieldLabel, color: c.sub }}>类型</label>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <button style={{ ...styles.typeBtn, borderColor: c.inputBorder, color: form.type === 'fixed' ? c.text : c.muted, ...(form.type === 'fixed' ? { background: c.inputBg } : {}) }} onClick={() => setForm({ ...form, type: 'fixed' })}>定时</button>
          <button style={{ ...styles.typeBtn, borderColor: c.inputBorder, color: form.type === 'interval' ? c.text : c.muted, ...(form.type === 'interval' ? { background: c.inputBg } : {}) }} onClick={() => setForm({ ...form, type: 'interval' })}>间隔</button>
        </div>
        {form.type === 'fixed' ? (
          <input style={{ ...styles.input, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text }} type="time" value={form.time || '12:00'} onChange={e => setForm({ ...form, time: e.target.value })} />
        ) : (
          <input style={{ ...styles.input, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text }} type="number" min={1} value={form.intervalMinutes || 60} onChange={e => setForm({ ...form, intervalMinutes: parseInt(e.target.value) || 60 })} />
        )}
        <button style={styles.saveBtn} onClick={saveEdit}>保存</button>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={{ ...styles.header, color: c.text }}>
        <span>提醒列表</span>
        <button style={{ ...styles.addBtn, borderColor: c.inputBorder, background: c.inputBg }} onClick={() => startEdit()}>+ 新建</button>
      </div>
      {reminders.length === 0 && (
        <div style={{ fontSize: 10, color: c.muted, textAlign: 'center', padding: 6 }}>暂无提醒</div>
      )}
      {reminders.map(r => (
        <div key={r.id} style={{ ...styles.item, background: c.itemBg }}>
          <div style={styles.itemTop}>
            <button style={{ ...styles.toggle, background: r.enabled ? '#4CAF50' : '#bbb' }} onClick={() => toggleEnabled(r)}>{r.enabled ? 'ON' : 'OFF'}</button>
            <span style={{ flex: 1, fontSize: 11, color: r.enabled ? c.labelOn : c.labelOff }}>{r.label}</span>
            <button style={{ ...styles.iconBtn, color: c.muted }} onClick={() => startEdit(r)}>✎</button>
            <button style={{ ...styles.iconBtn, color: c.muted }} onClick={() => deleteReminder(r.id)}>✕</button>
          </div>
          <div style={{ fontSize: 9, color: c.muted, marginTop: 1 }}>
            {r.type === 'fixed' ? `每天 ${r.time}` : `每 ${r.intervalMinutes} 分钟`} · {r.message.length > 16 ? r.message.slice(0, 16) + '...' : r.message}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', gap: 3 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontWeight: 600, marginBottom: 2 },
  addBtn: { padding: '1px 6px', borderRadius: 5, border: '1px solid', color: '#4CAF50', fontSize: 9, cursor: 'pointer' },
  closeBtn: { background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', padding: '0 2px' },
  item: { padding: '4px 6px', borderRadius: 6, marginBottom: 1 },
  itemTop: { display: 'flex', alignItems: 'center', gap: 4 },
  toggle: { padding: '1px 5px', borderRadius: 4, border: 'none', color: '#fff', fontSize: 8, cursor: 'pointer', fontWeight: 600 },
  iconBtn: { background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', padding: '0 1px' },
  fieldLabel: { fontSize: 9, marginBottom: 1 },
  input: { padding: '3px 6px', borderRadius: 5, fontSize: 10, marginBottom: 4, outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  typeBtn: { flex: 1, padding: '2px 0', borderRadius: 5, border: '1px solid', background: 'transparent', fontSize: 9, cursor: 'pointer', textAlign: 'center' as const },
  saveBtn: { padding: '4px 0', borderRadius: 6, border: 'none', background: '#4CAF50', color: '#fff', fontSize: 10, cursor: 'pointer', fontWeight: 600, marginTop: 2 },
};
