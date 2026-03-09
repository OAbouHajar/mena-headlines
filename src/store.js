/**
 * Lightweight reactive state store backed by localStorage.
 */
import { DEFAULT_CHANNELS, KNOWN_CHANNEL_IDS, DEFAULT_GROUP_MAP, GROUP_LABELS, pickColor } from './channels.js';

const STORAGE_KEYS = {
  channels: 'ytmv_channels',
  active: 'ytmv_active',
  version: 'ytmv_version',
};

// Bump this number whenever DEFAULT_CHANNELS or schema changes.
// This triggers a merge-migration: new defaults are added, old ones updated,
// custom user channels are kept.
const STORE_VERSION = 2;

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
    const savedVersion = load(STORAGE_KEYS.version, 0);
    const needsUpgrade = savedVersion < STORE_VERSION;

    // Load channels
    const savedChannels = load(STORAGE_KEYS.channels, null);
    if (savedChannels && savedChannels.length > 0) {
      this.channels = savedChannels;
      let migrated = false;

      // Build lookups from defaults
      const defaultLogos = Object.fromEntries(
        DEFAULT_CHANNELS.filter((c) => c.logo).map((c) => [c.channelId, c.logo])
      );

      // Per-channel field migration
      this.channels.forEach((ch) => {
        if (!ch.channelId && ch.handle && KNOWN_CHANNEL_IDS[ch.handle]) {
          ch.channelId = KNOWN_CHANNEL_IDS[ch.handle];
          migrated = true;
        }
        if (!ch.id) { ch.id = uid(); migrated = true; }
        if (ch.channelId && defaultLogos[ch.channelId] && ch.logo !== defaultLogos[ch.channelId]) {
          ch.logo = defaultLogos[ch.channelId];
          migrated = true;
        }
        if (!ch.group && ch.channelId && DEFAULT_GROUP_MAP[ch.channelId]) {
          ch.group = DEFAULT_GROUP_MAP[ch.channelId];
          migrated = true;
        }
      });

      // Version upgrade: merge new default channels the user doesn't have yet
      if (needsUpgrade) {
        const existingIds = new Set(this.channels.map((c) => c.channelId));
        DEFAULT_CHANNELS.forEach((def) => {
          if (!existingIds.has(def.channelId)) {
            this.channels.push({ ...def, id: uid() });
            migrated = true;
          }
        });
      }

      if (migrated || needsUpgrade) save(STORAGE_KEYS.channels, this.channels);
    } else {
      this.channels = DEFAULT_CHANNELS.map((ch) => ({ ...ch, id: uid() }));
      save(STORAGE_KEYS.channels, this.channels);
    }

    // Persist new version
    if (needsUpgrade) {
      save(STORAGE_KEYS.version, STORE_VERSION);
    }

    // Load active
    this.active = load(STORAGE_KEYS.active, []);
    // Validate active IDs still exist
    const validIds = new Set(this.channels.map((c) => c.id));
    this.active = this.active.filter((id) => validIds.has(id));

    // Default: activate first 4 channels only
    if (this.active.length === 0) {
      this.active = this.channels.slice(0, 4).map((c) => c.id);
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

  addChannel({ name, handle, channelId, logo, group }) {
    const ch = {
      id: uid(),
      name,
      handle: handle || '',
      channelId: channelId || '',
      color: pickColor(this.channels.length),
      logo: logo || '',
      group: group || '',
    };
    this.channels.push(ch);
    this._save();
    this._emit();
    return ch;
  }

  updateChannel(id, { name, handle, channelId, group }) {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return;
    if (name !== undefined) ch.name = name;
    if (handle !== undefined) ch.handle = handle;
    if (channelId !== undefined) ch.channelId = channelId;
    if (group !== undefined) ch.group = group;
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

  reorderChannel(startIndex, endIndex) {
    if (startIndex === endIndex) return;
    const [movedChannel] = this.channels.splice(startIndex, 1);
    this.channels.splice(endIndex, 0, movedChannel);
    this._save();
    this._emit();
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

  /** Get ordered list of unique groups used by current channels */
  getGroups() {
    const order = Object.keys(GROUP_LABELS);
    const seen = new Set();
    const groups = [];
    this.channels.forEach((ch) => {
      const g = ch.group || '';
      if (g && !seen.has(g)) { seen.add(g); groups.push(g); }
    });
    // Sort: built-in groups first (in defined order), then custom alphabetically
    groups.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return groups;
  }

  /** Toggle all channels in a group */
  toggleGroup(groupKey) {
    const groupChannels = groupKey === '__fav__'
      ? this.channels.filter((c) => c.fav)
      : this.channels.filter((c) => c.group === groupKey);
    const allActive = groupChannels.every((c) => this.active.includes(c.id));
    if (allActive) {
      // Deactivate all in group
      groupChannels.forEach((c) => {
        const idx = this.active.indexOf(c.id);
        if (idx >= 0) this.active.splice(idx, 1);
      });
    } else {
      // Activate all in group
      groupChannels.forEach((c) => {
        if (!this.active.includes(c.id)) this.active.push(c.id);
      });
    }
    this._save();
    this._emit();
  }

  /** Toggle favorite status on a channel */
  toggleFav(id) {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.fav = !ch.fav;
    this._save();
    this._emit();
  }
}

export const store = new Store();
