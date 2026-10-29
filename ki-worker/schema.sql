-- Ordela KI-Pakete: nur Guthaben und eingeloeste Kauf-Tokens, keine Inhalte.
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,          -- zufaellige Id aus der App (32 Hex-Zeichen)
  credits INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS redeemed (
  token TEXT PRIMARY KEY,       -- Google-Play-Kauf-Token: jeder nur einmal
  wallet TEXT NOT NULL,
  sku TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  exp INTEGER NOT NULL
);
