import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type ChangeEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  ArrowLeft, Check, Image as ImageIcon, LockKeyhole, LogOut, Menu, MessageCircle,
  MonitorSmartphone, MoreHorizontal, Paperclip, Pencil, Plus, RefreshCw, Reply, Search, Send,
  Server, Settings, ShieldCheck, ShieldX, SmilePlus, Trash2, UserPlus, Users, X
} from 'lucide-react';
import { api, API_URL } from './api';
import { createIdentity, decryptEnvelope, encryptForMembers, restoreIdentity } from './crypto';
import { normalizeServerUrl, SERVER_STORAGE_KEY } from './serverUrl';
import {
  clearServerDeviceId, DEVICE_ID_KEY, getOrCreateDeviceIdentity,
  rotateDeviceIdentity, saveServerDeviceId
} from './deviceIdentity';
import type { Conversation, DecryptedMessage, Device, EncryptedMessage, Payload, Reaction, User } from './types';

const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

function avatarText(user?: User | null) {
  return (user?.displayName || user?.username || '?').trim().slice(0, 2).toUpperCase();
}

function Avatar({ user, size = 42 }: { user?: User | null; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size, minWidth: size }}>
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : avatarText(user)}
    </div>
  );
}

function conversationTitle(c: Conversation, me: User) {
  if (c.type === 'group') return c.name || 'Group';
  return c.members.find(m => m.id !== me.id)?.displayName || 'Direct message';
}

function conversationPeer(c: Conversation, me: User) {
  return c.members.find(m => m.id !== me.id);
}

function formatTime(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function AuthScreen({ onAuth }: { onAuth: (user: User, token: string, secretKey: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverSettings, setServerSettings] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const device = getOrCreateDeviceIdentity();
      if (mode === 'register') {
        const identity = await createIdentity(password);
        const result = await api<{ token: string; deviceId: string; user: User }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, displayName, password, publicKey: identity.publicKey, keyBackup: identity.keyBackup, keySalt: identity.keySalt, device })
        });
        localStorage.setItem('krypt_token', result.token);
        localStorage.setItem('krypt_secret', identity.secretKey);
        saveServerDeviceId(result.deviceId);
        onAuth(result.user, result.token, identity.secretKey);
      } else {
        const result = await api<{ token: string; deviceId: string; user: User; keyBackup: string; keySalt: string }>('/api/auth/login', {
          method: 'POST', body: JSON.stringify({ username, password, device })
        });
        const secretKey = await restoreIdentity(password, result.keyBackup, result.keySalt);
        localStorage.setItem('krypt_token', result.token);
        localStorage.setItem('krypt_secret', secretKey);
        saveServerDeviceId(result.deviceId);
        onAuth(result.user, result.token, secretKey);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-glow" />
      <main className="auth-card">
        <div className="brand brand-large"><span className="brand-mark"><LockKeyhole size={22} /></span>KRYPT</div>
        <p className="eyebrow">PRIVATE BY DESIGN</p>
        <h1>{mode === 'register' ? 'Create your encrypted space.' : 'Welcome back.'}</h1>
        <p className="auth-copy">Messages are encrypted in your browser before they reach the KRYPT server.</p>
        <div className="auth-tabs">
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button>
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <label>Display name<input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Blood" required maxLength={48} /></label>}
          <label>Username<input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="blood" required minLength={3} maxLength={24} /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" required minLength={8} /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button" disabled={loading}>{loading ? 'Working…' : mode === 'register' ? 'Create KRYPT account' : 'Enter KRYPT'}</button>
        </form>
        <div className="security-note"><ShieldCheck size={16} /><span>Your private encryption key is backed up only in password-encrypted form.</span></div>
        <button className="server-button" type="button" onClick={() => setServerSettings(true)}>
          <Server size={15} /><span>Server</span><b>{new URL(API_URL).host}</b>
        </button>
      </main>
      {serverSettings && <ServerModal onClose={() => setServerSettings(false)} />}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><h3>{title}</h3><button className="icon-button" onClick={onClose}><X size={19} /></button></div>{children}</div></div>;
}

function ServerModal({ onClose }: { onClose: () => void }) {
  const [serverUrl, setServerUrl] = useState(API_URL);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function connect() {
    setError('');
    setChecking(true);
    try {
      const normalized = normalizeServerUrl(serverUrl);
      const response = await fetch(`${normalized}/api/health`);
      if (!response.ok) throw new Error(`Server health check failed (${response.status}).`);
      const body = await response.json().catch(() => null);
      if (body?.service !== 'krypt-api') throw new Error('This URL is not a KRYPT server.');

      if (normalized === API_URL) {
        onClose();
        return;
      }

      if (localStorage.getItem('krypt_token')) {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      }
      localStorage.setItem(SERVER_STORAGE_KEY, normalized);
      localStorage.removeItem('krypt_token');
      localStorage.removeItem('krypt_secret');
      clearServerDeviceId();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to server.');
    } finally {
      setChecking(false);
    }
  }

  async function useDefaultServer() {
    if (localStorage.getItem('krypt_token')) {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    }
    localStorage.removeItem(SERVER_STORAGE_KEY);
    localStorage.removeItem('krypt_token');
    localStorage.removeItem('krypt_secret');
    clearServerDeviceId();
    window.location.reload();
  }

  return <Modal title="KRYPT server" onClose={onClose}>
    <div className="connection-card">
      <Server size={20} />
      <div><b>Current server</b><p>{API_URL}</p></div>
    </div>
    <label className="modal-label">Shared server URL
      <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://krypt.example.com" autoCapitalize="none" autoCorrect="off" />
    </label>
    <p className="connection-help">Remote servers must use HTTPS. Localhost and 127.0.0.1 may use HTTP. Changing server signs this client out because accounts and encrypted key backups belong to that server.</p>
    {error && <div className="error-box connection-error">{error}</div>}
    <div className="connection-actions">
      <button className="secondary-button" type="button" onClick={useDefaultServer}>Use app default</button>
      <button className="primary-button" type="button" onClick={connect} disabled={checking}>{checking ? 'Checking…' : 'Connect'}</button>
    </div>
  </Modal>;
}

function NewChatModal({ onClose, onOpen }: { onClose: () => void; onOpen: (c: Conversation) => void }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) return setUsers([]);
      setLoading(true);
      try { setUsers(await api(`/api/users?q=${encodeURIComponent(q)}`)); } finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);
  async function open(user: User) {
    const c = await api<Conversation>('/api/conversations/direct', { method: 'POST', body: JSON.stringify({ userId: user.id }) });
    onOpen(c); onClose();
  }
  return <Modal title="New encrypted chat" onClose={onClose}><div className="search-field"><Search size={18} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search username or name" /></div><div className="modal-list">{loading && <p className="muted pad">Searching…</p>}{users.map(u => <button className="user-row" key={u.id} onClick={() => open(u)}><Avatar user={u} /><div><b>{u.displayName}</b><span>@{u.username}</span></div><MessageCircle size={18} /></button>)}{q && !loading && !users.length && <p className="muted pad">No users found.</p>}</div></Modal>;
}

function GroupModal({ onClose, onOpen }: { onClose: () => void; onOpen: (c: Conversation) => void }) {
  const [name, setName] = useState(''); const [q, setQ] = useState(''); const [users, setUsers] = useState<User[]>([]); const [picked, setPicked] = useState<User[]>([]);
  useEffect(() => { const t = setTimeout(async () => { if (!q.trim()) return setUsers([]); setUsers(await api(`/api/users?q=${encodeURIComponent(q)}`)); }, 200); return () => clearTimeout(t); }, [q]);
  function toggle(u: User) { setPicked(p => p.some(x => x.id === u.id) ? p.filter(x => x.id !== u.id) : [...p, u]); }
  async function create() { if (!name.trim()) return; const c = await api<Conversation>('/api/conversations/group', { method: 'POST', body: JSON.stringify({ name, memberIds: picked.map(x => x.id) }) }); onOpen(c); onClose(); }
  return <Modal title="Create group" onClose={onClose}><label className="modal-label">Group name<input value={name} onChange={e => setName(e.target.value)} placeholder="Core team" maxLength={64} /></label>{picked.length > 0 && <div className="chips">{picked.map(u => <button key={u.id} onClick={() => toggle(u)}>{u.displayName}<X size={12} /></button>)}</div>}<div className="search-field"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Add people" /></div><div className="modal-list compact">{users.map(u => <button className="user-row" key={u.id} onClick={() => toggle(u)}><Avatar user={u} size={36} /><div><b>{u.displayName}</b><span>@{u.username}</span></div><span className={`pick ${picked.some(x => x.id === u.id) ? 'on' : ''}`}>{picked.some(x => x.id === u.id) && <Check size={13} />}</span></button>)}</div><button className="primary-button modal-action" onClick={create} disabled={!name.trim()}>Create encrypted group</button></Modal>;
}

function ProfileModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (u: User) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl || null);
  const [serverSettings, setServerSettings] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const [deviceBusy, setDeviceBusy] = useState('');

  async function loadDevices() {
    try {
      setDeviceError('');
      setDevices(await api<Device[]>('/api/devices'));
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Could not load devices');
    }
  }

  useEffect(() => { loadDevices(); }, []);

  async function file(e: ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; if (f.size > 1_000_000) return alert('Avatar must be under 1 MB.'); const reader = new FileReader(); reader.onload = () => setAvatarUrl(String(reader.result)); reader.readAsDataURL(f); }
  async function save() { const updated = await api<User>('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName, avatarUrl }) }); onSaved(updated); onClose(); }

  async function revokeDevice(device: Device) {
    if (device.current || device.revokedAt) return;
    if (!confirm(`Remove ${device.name} from this KRYPT account?`)) return;
    setDeviceBusy(device.id);
    try {
      await api(`/api/devices/${device.id}`, { method: 'DELETE' });
      await loadDevices();
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Could not remove device');
    } finally {
      setDeviceBusy('');
    }
  }

  async function rotateCurrentDevice() {
    const currentId = localStorage.getItem(DEVICE_ID_KEY);
    if (!currentId) return;
    setDeviceBusy(currentId);
    try {
      const publicKey = rotateDeviceIdentity();
      await api(`/api/devices/${currentId}/key`, { method: 'POST', body: JSON.stringify({ publicKey }) });
      await loadDevices();
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Could not rotate device key');
    } finally {
      setDeviceBusy('');
    }
  }

  return <>
    <Modal title="Profile & security" onClose={onClose}>
      <div className="profile-editor"><Avatar user={{ ...user, displayName, avatarUrl }} size={76} /><label className="secondary-button file-button">Change photo<input type="file" accept="image/*" onChange={file} /></label></div>
      <label className="modal-label">Display name<input value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>
      <div className="security-card"><ShieldCheck size={20} /><div><b>End-to-end encryption enabled</b><p>Message content is encrypted before upload. Device verification identities are separate from the current MVP message key.</p></div></div>
      <div className="device-section">
        <div className="device-section-head"><div><b>Known devices</b><span>Remove devices you no longer trust.</span></div><MonitorSmartphone size={19} /></div>
        {deviceError && <div className="error-box">{deviceError}</div>}
        <div className="device-list">
          {devices.map(device => <div className={`device-row ${device.revokedAt ? 'revoked' : ''}`} key={device.id}>
            <div className="device-icon"><MonitorSmartphone size={17} /></div>
            <div className="device-copy"><b>{device.name}{device.current ? ' · this device' : ''}</b><span>{device.platform} · key v{device.keyVersion} · seen {formatTime(device.lastSeenAt)}</span></div>
            {device.current && !device.revokedAt
              ? <button className="device-action" title="Rotate verification key" onClick={rotateCurrentDevice} disabled={deviceBusy === device.id}><RefreshCw size={15} /></button>
              : !device.revokedAt
                ? <button className="device-action danger" title="Remove device" onClick={() => revokeDevice(device)} disabled={deviceBusy === device.id}><ShieldX size={15} /></button>
                : <span className="device-revoked">revoked</span>}
          </div>)}
          {!devices.length && !deviceError && <p className="connection-help">No device records available.</p>}
        </div>
      </div>
      <button className="server-button modal-server-button" type="button" onClick={() => setServerSettings(true)}><Server size={15} /><span>Server</span><b>{new URL(API_URL).host}</b></button>
      <button className="primary-button modal-action" onClick={save}>Save profile</button>
    </Modal>
    {serverSettings && <ServerModal onClose={() => setServerSettings(false)} />}
  </>;
}

function MessageBubble({ message, me, conversation, allMessages, onReply, onEdit, onDelete, onReact }: { message: DecryptedMessage; me: User; conversation: Conversation; allMessages: DecryptedMessage[]; onReply: () => void; onEdit: () => void; onDelete: () => void; onReact: (emoji: string) => void }) {
  const mine = message.senderId === me.id;
  const sender = conversation.members.find(m => m.id === message.senderId);
  const reply = message.replyToId ? allMessages.find(m => m.id === message.replyToId) : undefined;
  const grouped = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of message.reactions || []) map.set(r.emoji, [...(map.get(r.emoji) || []), r]);
    return [...map.entries()];
  }, [message.reactions]);
  return <div className={`message-row ${mine ? 'mine' : ''}`}><div className="message-stack">{conversation.type === 'group' && !mine && <span className="sender-name">{sender?.displayName}</span>}<div className={`bubble ${message.deletedAt ? 'deleted' : ''}`}>{message.deletedAt ? <em>Message deleted</em> : <>{reply && <div className="reply-preview"><Reply size={12} /><span>{reply.deletedAt ? 'Deleted message' : reply.payload?.kind === 'text' ? reply.payload.text.slice(0, 90) : 'Image'}</span></div>}{message.payload?.kind === 'image' && <img className="message-image" src={message.payload.dataUrl} alt="Shared encrypted attachment" />}{message.payload?.kind === 'text' && <p>{message.payload.text}</p>}{message.payload?.kind === 'image' && message.payload.caption && <p>{message.payload.caption}</p>}<div className="bubble-meta"><span>{formatTime(message.createdAt)}</span>{message.editedAt && <span>edited</span>}{mine && <span>✓✓</span>}</div></>} {!message.deletedAt && <div className="message-actions"><button onClick={onReply} title="Reply"><Reply size={14} /></button><div className="reaction-picker"><button title="React"><SmilePlus size={14} /></button><div className="reaction-pop">{REACTIONS.map(e => <button key={e} onClick={() => onReact(e)}>{e}</button>)}</div></div>{mine && message.payload?.kind === 'text' && <button onClick={onEdit} title="Edit"><Pencil size={14} /></button>}{mine && <button onClick={onDelete} title="Delete"><Trash2 size={14} /></button>}</div>}</div>{grouped.length > 0 && <div className="reaction-row">{grouped.map(([emoji, rs]) => <button key={emoji} className={rs.some(r => r.userId === me.id) ? 'mine-reaction' : ''} onClick={() => onReact(emoji)} title={rs.map(r => r.username).join(', ')}>{emoji} <span>{rs.length}</span></button>)}</div>}</div></div>;
}

function App() {
  const [user, setUser] = useState<User | null>(null); const [token, setToken] = useState(localStorage.getItem('krypt_token') || ''); const [secretKey, setSecretKey] = useState(localStorage.getItem('krypt_secret') || '');
  const [booting, setBooting] = useState(true); const [conversations, setConversations] = useState<Conversation[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null); const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [text, setText] = useState(''); const [imageData, setImageData] = useState<string | null>(null); const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null); const [editTarget, setEditTarget] = useState<DecryptedMessage | null>(null);
  const [newChat, setNewChat] = useState(false); const [newGroup, setNewGroup] = useState(false); const [profile, setProfile] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(true); const [detailsOpen, setDetailsOpen] = useState(false);
  const [typing, setTyping] = useState<Record<string, string[]>>({}); const [online, setOnline] = useState<Record<string, boolean>>({}); const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null); const selectedRef = useRef<string | null>(null); const typingTimer = useRef<number | null>(null); const endRef = useRef<HTMLDivElement | null>(null);
  selectedRef.current = selectedId;

  useEffect(() => {
    (async () => {
      if (!token || !secretKey) { setBooting(false); return; }
      try { setUser(await api<User>('/api/me')); } catch { clearLocalSession(); }
      finally { setBooting(false); }
    })();
  }, []);

  async function loadConversations(selectFirst = false) {
    const data = await api<Conversation[]>('/api/conversations');
    setConversations(data);
    if ((selectFirst || !selectedRef.current) && data[0]) setSelectedId(data[0].id);
  }

  useEffect(() => { if (user) loadConversations(true).catch(() => {}); }, [user?.id]);

  async function decryptMessage(m: EncryptedMessage): Promise<DecryptedMessage> {
    if (m.deletedAt || !m.envelope) return { ...m, payload: null };
    try { return { ...m, payload: decryptEnvelope(m.envelope, secretKey) }; }
    catch { return { ...m, payload: { kind: 'text', text: '🔒 Unable to decrypt this message on this device.' } }; }
  }

  useEffect(() => {
    if (!selectedId || !user) return;
    setMessages([]); setError('');
    api<EncryptedMessage[]>(`/api/conversations/${selectedId}/messages`).then(async rows => setMessages(await Promise.all(rows.map(decryptMessage)))).catch(e => setError(e.message));
    socketRef.current?.emit('conversation:join', selectedId);
  }, [selectedId, user?.id, secretKey]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, typing[selectedId || '']?.length]);

  useEffect(() => {
    if (!user || !token || !secretKey) return;
    const socket = io(API_URL, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('message:new', async (m: EncryptedMessage) => {
      if (selectedRef.current === m.conversationId) {
        const decoded = await decryptMessage(m);
        setMessages(prev => prev.some(x => x.id === decoded.id) ? prev : [...prev, decoded]);
      }
      loadConversations(false).catch(() => {});
    });
    socket.on('message:updated', async (m: EncryptedMessage) => {
      const decoded = await decryptMessage(m);
      if (selectedRef.current === m.conversationId) setMessages(prev => prev.map(x => x.id === m.id ? decoded : x));
    });
    socket.on('message:deleted', ({ id, conversationId, deletedAt }) => { if (selectedRef.current === conversationId) setMessages(prev => prev.map(x => x.id === id ? { ...x, deletedAt, payload: null } : x)); });
    socket.on('reaction:update', ({ messageId, reactions }) => setMessages(prev => prev.map(x => x.id === messageId ? { ...x, reactions } : x)));
    socket.on('typing', ({ conversationId, username, isTyping }) => setTyping(prev => { const set = new Set(prev[conversationId] || []); isTyping ? set.add(username) : set.delete(username); return { ...prev, [conversationId]: [...set] }; }));
    socket.on('presence:update', ({ userId, online: isOnline }) => setOnline(prev => ({ ...prev, [userId]: isOnline })));
    socket.on('session:revoked', () => clearLocalSession());
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [user?.id, token, secretKey]);

  const selected = conversations.find(c => c.id === selectedId) || null;

  async function send() {
    if (!selected || (!text.trim() && !imageData)) return;
    setError('');
    try {
      const payload: Payload = imageData ? { kind: 'image', dataUrl: imageData, caption: text.trim() || undefined } : { kind: 'text', text: text.trim() };
      const envelopes = encryptForMembers(payload, selected.members);
      if (editTarget) {
        await api(`/api/messages/${editTarget.id}`, { method: 'PATCH', body: JSON.stringify({ envelopes, type: payload.kind }) });
      } else {
        await api(`/api/conversations/${selected.id}/messages`, { method: 'POST', body: JSON.stringify({ envelopes, type: payload.kind, replyToId: replyTo?.id || null }) });
      }
      setText(''); setImageData(null); setReplyTo(null); setEditTarget(null); emitTyping(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send'); }
  }

  function emitTyping(isTyping: boolean) {
    if (!selected) return;
    socketRef.current?.emit('typing', { conversationId: selected.id, isTyping });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    if (isTyping) typingTimer.current = window.setTimeout(() => socketRef.current?.emit('typing', { conversationId: selected.id, isTyping: false }), 1600);
  }

  async function chooseImage(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 2_500_000) return alert('For this MVP, encrypted images are limited to 2.5 MB.');
    const reader = new FileReader(); reader.onload = () => setImageData(String(reader.result)); reader.readAsDataURL(f); e.target.value = '';
  }

  async function react(messageId: string, emoji: string) { await api(`/api/messages/${messageId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }); }
  async function removeMessage(id: string) { if (confirm('Delete this message for everyone?')) await api(`/api/messages/${id}`, { method: 'DELETE' }); }

  function beginEdit(m: DecryptedMessage) { if (m.payload?.kind !== 'text') return; setEditTarget(m); setReplyTo(null); setImageData(null); setText(m.payload.text); }
  function beginReply(m: DecryptedMessage) { setReplyTo(m); setEditTarget(null); }

  function openConversation(c: Conversation) { setConversations(prev => prev.some(x => x.id === c.id) ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]); setSelectedId(c.id); setSidebarOpen(false); socketRef.current?.emit('conversation:join', c.id); }

  function clearLocalSession() {
    localStorage.removeItem('krypt_token');
    localStorage.removeItem('krypt_secret');
    setToken('');
    setSecretKey('');
    setUser(null);
    setConversations([]);
    setMessages([]);
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    catch { /* Local logout must still complete if the server is unavailable. */ }
    finally { clearLocalSession(); }
  }

  if (booting) return <div className="boot"><div className="brand"><span className="brand-mark"><LockKeyhole size={20} /></span>KRYPT</div></div>;
  if (!user) return <AuthScreen onAuth={(u, t, s) => { setUser(u); setToken(t); setSecretKey(s); }} />;

  const peer = selected ? conversationPeer(selected, user) : null;
  const typingNames = selected ? typing[selected.id] || [] : [];

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-head"><div className="brand"><span className="brand-mark"><LockKeyhole size={18} /></span>KRYPT</div><button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)}><X size={20} /></button></div>
      <div className="sidebar-actions"><button className="new-chat" onClick={() => setNewChat(true)}><Plus size={18} />New chat</button><button className="icon-button bordered" onClick={() => setNewGroup(true)} title="New group"><Users size={18} /></button></div>
      <div className="section-label">MESSAGES <span>{conversations.length}</span></div>
      <div className="conversation-list">{conversations.map(c => { const p = conversationPeer(c, user); const active = c.id === selectedId; return <button key={c.id} className={`conversation-row ${active ? 'active' : ''}`} onClick={() => { setSelectedId(c.id); setSidebarOpen(false); }}><div className="avatar-wrap">{c.type === 'group' ? <div className="group-avatar"><Users size={18} /></div> : <Avatar user={p} />}{p && online[p.id] && <span className="online-dot" />}</div><div className="conversation-copy"><div><b>{conversationTitle(c, user)}</b><time>{formatTime(c.lastMessageAt || c.createdAt)}</time></div><p><LockKeyhole size={11} /> Encrypted conversation</p></div></button>; })}{!conversations.length && <div className="empty-sidebar"><MessageCircle size={26} /><p>No chats yet.</p><span>Start an encrypted conversation.</span></div>}</div>
      <button className="profile-row" onClick={() => setProfile(true)}><Avatar user={user} size={38} /><div><b>{user.displayName}</b><span>@{user.username}</span></div><Settings size={17} /></button>
    </aside>

    <main className="chat-panel">
      {selected ? <>
        <header className="chat-header"><div className="chat-title"><button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>{selected.type === 'group' ? <div className="group-avatar"><Users size={18} /></div> : <Avatar user={peer} size={38} />}<div><h2>{conversationTitle(selected, user)}</h2><span>{typingNames.length ? `${typingNames.join(', ')} typing…` : selected.type === 'group' ? `${selected.members.length} members · encrypted` : peer && online[peer.id] ? 'Online · encrypted' : 'End-to-end encrypted'}</span></div></div><div className="header-actions"><span className="encrypted-pill"><ShieldCheck size={14} />Encrypted</span><button className="icon-button" onClick={() => setDetailsOpen(v => !v)}><MoreHorizontal size={20} /></button></div></header>
        <section className="messages"><div className="encryption-banner"><LockKeyhole size={16} /><div><b>Messages are end-to-end encrypted</b><span>KRYPT's server stores encrypted envelopes, not message plaintext.</span></div></div>{messages.map(m => <MessageBubble key={m.id} message={m} me={user} conversation={selected} allMessages={messages} onReply={() => beginReply(m)} onEdit={() => beginEdit(m)} onDelete={() => removeMessage(m.id)} onReact={emoji => react(m.id, emoji)} />)}{typingNames.length > 0 && <div className="typing-bubble"><i /><i /><i /></div>}<div ref={endRef} /></section>
        <footer className="composer-wrap">{error && <div className="composer-error">{error}</div>}{(replyTo || editTarget) && <div className="compose-context"><div>{editTarget ? <Pencil size={15} /> : <Reply size={15} />}<span><b>{editTarget ? 'Editing message' : 'Replying'}</b>{editTarget ? editTarget.payload?.kind === 'text' ? editTarget.payload.text : '' : replyTo?.payload?.kind === 'text' ? replyTo.payload.text : 'Image'}</span></div><button onClick={() => { setReplyTo(null); setEditTarget(null); setText(''); }}><X size={16} /></button></div>}{imageData && <div className="image-preview"><img src={imageData} alt="Upload preview" /><button onClick={() => setImageData(null)}><X size={15} /></button></div>}<div className="composer"><label className="icon-button"><Paperclip size={20} /><input type="file" accept="image/*" onChange={chooseImage} /></label><textarea rows={1} value={text} onChange={e => { setText(e.target.value); emitTyping(true); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={editTarget ? 'Edit encrypted message…' : `Message ${conversationTitle(selected, user)}`} /><button className="send-button" onClick={send} disabled={!text.trim() && !imageData}>{editTarget ? <Check size={19} /> : <Send size={19} />}</button></div></footer>
      </> : <div className="empty-chat"><div className="empty-lock"><LockKeyhole size={34} /></div><h2>Your conversations are private.</h2><p>Start a chat. KRYPT encrypts message content on your device.</p><button className="primary-button small" onClick={() => setNewChat(true)}><UserPlus size={17} />Start a chat</button></div>}
    </main>

    {selected && detailsOpen && <aside className="details-panel"><div className="details-head"><h3>Conversation</h3><button className="icon-button" onClick={() => setDetailsOpen(false)}><X size={19} /></button></div><div className="details-hero">{selected.type === 'group' ? <div className="group-avatar large"><Users size={25} /></div> : <Avatar user={peer} size={68} />}<h3>{conversationTitle(selected, user)}</h3><span>{selected.type === 'group' ? `${selected.members.length} members` : `@${peer?.username}`}</span></div><div className="security-card side"><ShieldCheck size={20} /><div><b>Encrypted content</b><p>Only members with valid private keys can decrypt message bodies.</p></div></div><div className="section-label">MEMBERS</div><div className="member-list">{selected.members.map(m => <div className="member-row" key={m.id}><div className="avatar-wrap"><Avatar user={m} size={34} />{online[m.id] && <span className="online-dot" />}</div><div><b>{m.displayName}</b><span>@{m.username}{m.role === 'owner' ? ' · owner' : ''}</span></div></div>)}</div>{selected.type === 'direct' && <button className="danger-button" onClick={logout}><LogOut size={16} />Log out of KRYPT</button>}</aside>}

    {newChat && <NewChatModal onClose={() => setNewChat(false)} onOpen={openConversation} />}
    {newGroup && <GroupModal onClose={() => setNewGroup(false)} onOpen={openConversation} />}
    {profile && <ProfileModal user={user} onClose={() => setProfile(false)} onSaved={setUser} />}
  </div>;
}

export default App;