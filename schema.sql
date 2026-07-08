-- Barber King — schéma Cloudflare D1
-- Toutes les dates/heures sont stockées en UTC (ISO 8601, ex. "2026-07-09T13:00:00.000Z").
-- La conversion vers l'heure de Delémont (Europe/Zurich) se fait côté Worker.

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_chf REAL NOT NULL,
  duration_minutes INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS barbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL, -- format international sans "+", ex. 41783528359
  active INTEGER NOT NULL DEFAULT 1
);

-- Horaires réguliers. weekday : 0 = dimanche ... 6 = samedi.
-- Un jour peut avoir plusieurs lignes (ex. vendredi matin + après-midi).
CREATE TABLE IF NOT EXISTS working_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barber_id INTEGER NOT NULL REFERENCES barbers(id),
  weekday INTEGER NOT NULL,
  start_minutes INTEGER NOT NULL, -- minutes depuis minuit, heure de Zurich
  end_minutes INTEGER NOT NULL
);

-- Blocages ponctuels (pause, vacances, rendez-vous personnel...) posés par Hassan.
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barber_id INTEGER NOT NULL REFERENCES barbers(id),
  start_at TEXT NOT NULL, -- ISO UTC
  end_at TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barber_id INTEGER NOT NULL REFERENCES barbers(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL, -- format international sans "+", ex. 41791234567
  start_at TEXT NOT NULL, -- ISO UTC
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
  manage_token TEXT NOT NULL UNIQUE, -- utilisé dans le lien d'annulation envoyé au client
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  whatsapp_confirm_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_barber_time ON appointments(barber_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_token ON appointments(manage_token);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Données de départ -----------------------------------------------------

INSERT INTO barbers (id, name, whatsapp_number, active)
VALUES (1, 'Hassan', '41783528359', 1);

INSERT INTO services (id, name, price_chf, duration_minutes, sort_order) VALUES
  (1, 'Coupe homme', 25, 30, 1),
  (2, 'Coupe enfant', 15, 20, 2),
  (3, 'Coupe et barbe', 35, 45, 3);

-- Horaires (identiques à ceux déjà affichés sur le site)
-- Lundi (1) : 13h00–18h30
INSERT INTO working_hours (barber_id, weekday, start_minutes, end_minutes) VALUES (1, 1, 780, 1110);
-- Mardi (2), Mercredi (3), Jeudi (4) : 9h00–18h30
INSERT INTO working_hours (barber_id, weekday, start_minutes, end_minutes) VALUES (1, 2, 540, 1110);
INSERT INTO working_hours (barber_id, weekday, start_minutes, end_minutes) VALUES (1, 3, 540, 1110);
INSERT INTO working_hours (barber_id, weekday, start_minutes, end_minutes) VALUES (1, 4, 540, 1110);
-- Vendredi (5) : 9h00–12h00 puis 13h30–18h30
INSERT INTO working_hours (barber_id, weekday, start_minutes, end_minutes) VALUES (1, 5, 540, 720);
INSERT INTO working_hours (barber_id, weekday, start_minutes, end_minutes) VALUES (1, 5, 810, 1110);
-- Samedi (6) : 8h30–17h00
INSERT INTO working_hours (barber_id, weekday, start_minutes, end_minutes) VALUES (1, 6, 510, 1020);
-- Dimanche (0) : fermé, aucune ligne.
