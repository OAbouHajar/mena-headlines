/**
 * Lightweight reactive state store backed by localStorage.
 */
import { DEFAULT_CHANNELS, KNOWN_CHANNEL_IDS, pickColor } from './channels.js';

const STORAGE_KEYS = {
  channels: 'ytmv_channels',
  active: 'ytmv_active',
};

function uid() {
  return 'ch_' + crypto.randomUUID().slice(0, 8);
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

class Store {
  constructor() {
    this._listeners = new Set();
    this._init();
  }

  _init() {
    // Load channels
    const savedChannels = load(STORAGE_KEYS.channels, null);
    if (savedChannels && savedChannels.length > 0) {
      this.channels = savedChannels;
      // Auto-migrate: add channelId from known mapping
      let migrated = false;
      this.channels.forEach((ch) => {
        if (!ch.channelId && ch.handle && KNOWN_CHANNEL_IDS[ch.handle]) {
          ch.channelId = KNOWN_CHANNEL_IDS[ch.handle];
          migrated = true;
        }
        if (!ch.id) { ch.id = uid(); migrated = true; }
      });
      if (migrated) save(STORAGE_KEYS.channels, this.channels);
    } else {
      this.channels = DEFAULT_CHANNELS.map((ch) => ({ ...ch, id: uid() }));
      save(STORAGE_KEYS.channels, this.channels);
    }

    // Load active
    this.active = load(STORAGE_KEYS.active, []);
    // Validate active IDs still exist
    const validIds = new Set(this.channels.map((c) => c.id));
    this.active = this.active.filter((id) => validIds.has(id));

    // Default: activate all channels
    if (this.active.length === 0) {
      this.active = this.channels.map((c) => c.id);
      save(STORAGE_KEYS.active, this.active);
    }
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    this._listeners.forEach((fn) => fn(this));
  }

  _save() {
    save(STORAGE_KEYS.channels, this.channels);
    save(STORAGE_KEYS.active, this.active);
  }

  toggleChannel(id) {
    const idx = this.active.indexOf(id);
    if (idx >= 0) {
      this.active.splice(idx, 1);
    } else {
      this.active.push(id);
    }
    this._save();
    this._emit();
  }

  addChannel({ name, handle, channelId }) {
    const ch = {
      id: uid(),
      name,
      handle: handle || '',
      channelId: channelId || '',
      color: pickColor(this.channels.length),
    };
    this.channels.push(ch);
    this._save();
    this._emit();
    return ch;
  }

  updateChannel(id, { name, handle, channelId }) {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return;
    if (name !== undefined) ch.name = name;
    if (handle !== undefined) ch.handle = handle;
    if (channelId !== undefined) ch.channelId = channelId;
    this._save();
    this._emit();
  }

  removeChannel(id) {
    const ch = this.channels.find((c) => c.id === id);
    this.channels = this.channels.filter((c) => c.id !== id);
    this.active = this.active.filter((a) => a !== id);
    this._save();
    this._emit();
    return ch;
  }

  /** Replace state entirely (used by cloud sync). */
  loadState(channels, active) {
    this.channels = channels.map((ch) => ({ ...ch, id: ch.id || uid() }));
    const validIds = new Set(this.channels.map((c) => c.id));
    this.active = (active || []).filter((id) => validIds.has(id));
    if (this.active.length === 0) {
      this.active = this.channels.map((c) => c.id);
    }
    this._save();
    this._emit();
  }

  resetToDefaults() {
    this.channels = DEFAULT_CHANNELS.map((ch) => ({ ...ch, id: uid() }));
    this.active = this.channels.map((c) => c.id);
    this._save();
    this._emit();
  }

  getChannel(id) {
    return this.channels.find((c) => c.id === id);
  }

  isActive(id) {
    return this.active.includes(id);
  }
}

export const store = new Store();
