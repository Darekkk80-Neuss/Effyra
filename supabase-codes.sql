-- ============================================================
-- Effyra – Beitrittscodes härten
-- Im Supabase SQL-Editor komplett ausführen ("Run"). Mehrfach ausführbar.
-- ZUERST ausführen, DANN die Dateien, die gen_family_code() benutzen
-- (supabase-family.sql, supabase-kids.sql, supabase-play-purchases.sql,
--  supabase-family-entitlements.sql, migrations/20260719_...).
-- ============================================================
--
-- WARUM
-- Bisher: upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)).
-- Das ist HEX, also nur 16 Zeichen Alphabet: 16^6 ≈ 16,7 Mio. Möglichkeiten —
-- nicht die 2,1 Mrd., die das Eingabefeld [A-Z0-9]{6} suggeriert. join_family
-- und join_as_child sind für jeden angemeldeten Nutzer aufrufbar und hatten
-- kein Rate-Limit. Bei 10.000 aktiven Familien trifft ein Skript im Mittel alle
-- ~1.700 Versuche auf eine fremde Familie — und bekommt sofort den kompletten
-- Familien-Blob zurück: Namen und Geburtsdaten der Kinder, Termine, Aufgaben.
--
-- Jetzt: 8 Zeichen aus einem 31er-Alphabet ohne verwechselbare Zeichen
-- (kein I, L, O, 0, 1) ⇒ ≈ 8,5 · 10^11 Möglichkeiten, rund 50.000-mal mehr.
-- Zusätzlich ein Rate-Limit auf die Beitrittsversuche.
--
-- BESTANDSSCHUTZ: Alte 6-stellige Codes bleiben gültig – gesucht wird per
-- exaktem Vergleich, die Länge spielt dabei keine Rolle. Der Client akzeptiert
-- weiterhin 6 UND 8 Zeichen.

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- Codegenerator
-- ------------------------------------------------------------
-- gen_random_bytes statt random(): random() ist ein vorhersagbarer PRNG, dessen
-- Zustand sich aus beobachteten Werten ableiten lässt. Für einen Code, der
-- Zugang zu Familiendaten gibt, ist das die falsche Quelle.
create or replace function public.gen_family_code(p_len int default 8)
returns text language sql volatile set search_path = public, extensions as $fn$
  select string_agg(
           substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                  1 + (get_byte(b.bytes, g.i) % 31), 1), '')
    from (select extensions.gen_random_bytes(greatest(p_len, 1)) as bytes) b,
         generate_series(0, greatest(p_len, 1) - 1) g(i);
$fn$;

revoke execute on function public.gen_family_code(int) from public, anon, authenticated;

-- ------------------------------------------------------------
-- Rate-Limit für Beitrittsversuche
-- ------------------------------------------------------------
-- Nutzt rate_take aus supabase-optimierung.sql (atomarer Tageszähler).
-- 20 Versuche pro Konto und Tag reichen für jede legitime Nutzung – ein Code
-- wird abgetippt, nicht durchprobiert –, machen Brute-Force aber auch mit
-- vielen Konten unbezahlbar.
create or replace function public.join_rate_ok()
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_ok boolean;
begin
  select public.rate_take(auth.uid(), 'join_family', 20) into v_ok;
  return coalesce(v_ok, true);   -- fehlt rate_take, nicht aussperren
exception when others then
  return true;
end; $fn$;

revoke execute on function public.join_rate_ok() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Kontrolle:
--   select public.gen_family_code(8);        -- z. B. 'K7M2P4Q9'
--   select length(public.gen_family_code());  -- 8
