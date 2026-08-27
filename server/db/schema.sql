CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  color TEXT NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'Unknown',
  source TEXT NOT NULL CHECK(source IN ('local', 'youtube', 'spotify')),
  source_ref TEXT,
  file_path TEXT,
  added_by_session TEXT,
  vote_score INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'playing', 'played', 'removed')),
  created_at INTEGER NOT NULL,
  played_at INTEGER,
  download_status TEXT NOT NULL DEFAULT 'ready' CHECK(download_status IN ('pending', 'downloading', 'ready', 'failed')),
  download_error TEXT,
  duration_sec INTEGER,
  FOREIGN KEY (added_by_session) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS votes (
  track_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  direction INTEGER NOT NULL CHECK(direction IN (1, -1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (track_id, session_id),
  FOREIGN KEY (track_id) REFERENCES tracks(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
CREATE INDEX IF NOT EXISTS idx_tracks_vote ON tracks(vote_score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tracks_download ON tracks(status, download_status);

CREATE TABLE IF NOT EXISTS media_index (
  file_path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'Unknown',
  album TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  mtime REAL NOT NULL,
  duration_sec INTEGER
);

CREATE INDEX IF NOT EXISTS idx_media_title ON media_index(title);
CREATE INDEX IF NOT EXISTS idx_media_artist ON media_index(artist);
