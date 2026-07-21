-- ============================================================
-- Ordela – Play-Abo-Lebenszyklus: Kauf↔Nutzer-Zuordnung + idempotente Ablauf-Sync
-- Für: (1) Re-Verifikation beim App-Start, (3) RTDN-Verlängerung/Storno.
-- Voraussetzung: profiles/families vorhanden (tiers/family-entitlements/trial-and-play).
-- Im Supabase SQL-Editor ausführen. Mehrfach ausführbar.
-- ============================================================

-- 1) Zuordnung purchaseToken → Nutzer (damit RTDN weiß, wen es betrifft).
create table if not exists public.play_purchases (
  purchase_token text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  sku            text not null,
  ptype          text not null default 'subs',
  expiry_ms      bigint,                    -- Googles expiryTimeMillis (für Add-on-Sitzplätze; >now = aktiv)
  updated_at     timestamptz not null default now()
);
alter table public.play_purchases add column if not exists expiry_ms bigint;
-- revoked_at: Marke gegen doppelten Entzug. Pub/Sub stellt bei JEDEM Nicht-200
-- erneut zu, und ein Netzfehler nach dem Entzug ist genau das. Ohne Marke zoege
-- der zweite Aufruf nochmal 1000 Credits ab.
alter table public.play_purchases add column if not exists revoked_at timestamptz;
-- Was der Kauf tatsaechlich gegeben hat. Beim Entzug wird GENAU das
-- zurueckgenommen, statt aus dem heutigen Zustand zu raten: zwischen Kauf und
-- Erstattung kann das Familienabo ablaufen oder der Rang wechseln, und dann
-- traefe der Entzug den falschen Topf.
alter table public.play_purchases add column if not exists credited_fid uuid;      -- Familien-Topf, in den die Credits gingen
alter table public.play_purchases add column if not exists credited_scope text;   -- 'family' | 'personal' | null(=Altkauf ohne Vermerk); loest die Zweideutigkeit von credited_fid=null
alter table public.play_purchases add column if not exists prev_tier text;         -- Rang VOR dem Kauf
-- user_id darf null sein: ein Tombstone fuer einen erstatteten, nie verifizierten
-- Token hat keinen Nutzer (siehe void_play_purchase, not-found-Zweig).
alter table public.play_purchases alter column user_id drop not null;
-- Von der zentralen Rang-Nachbewertung gelesen (Stripe-Premium-Frist).
alter table public.profiles add column if not exists stripe_until timestamptz;
create index if not exists play_purchases_user_idx on public.play_purchases(user_id);
alter table public.play_purchases enable row level security;
revoke all on public.play_purchases from anon, authenticated;   -- nur service_role (Edge Functions)

-- 2) Ablaufdatum idempotent setzen (SET, NICHT verlängern → kein Runaway bei häufiger Re-Verifikation).
--    p_expiry_ms = Googles expiryTimeMillis. Liegt es in der Vergangenheit (Storno/Ablauf),
--    fällt der Zugang automatisch (effective_tier/get_entitlements stufen zurück).
create or replace function public.sync_play_expiry(p_user uuid, p_sku text, p_expiry_ms bigint)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_exp  timestamptz := to_timestamp(p_expiry_ms / 1000.0);
  v_fid  uuid;
  v_code text;
begin
  if p_sku = 'effyra_premium' then
    update public.profiles
       set tier = 'premium', plan = 'premium',
           premium_since = coalesce(premium_since, now()),
           premium_until = v_exp
     where id = p_user;
  elsif p_sku = 'effyra_family' then
    -- SELBSTHEILEND: Falls der Erstkauf-Grant (apply_family_purchase) nie ankam und
    -- daher noch KEINE Familie mit plan_by=Käufer existiert, hier eine anlegen –
    -- sonst würde der Sync den Käufer nur auf premium heben und Family bliebe „free".
    select fm.family_id into v_fid from public.family_members fm where fm.user_id = p_user limit 1;
    if v_fid is null then
      loop
        v_code := public.gen_family_code(8);   -- siehe supabase-codes.sql (CSPRNG, 31er-Alphabet)
        exit when not exists (select 1 from public.families where code = v_code);
      end loop;
      insert into public.families (code, created_by) values (v_code, p_user) returning id into v_fid;
      insert into public.family_members (family_id, user_id) values (v_fid, p_user) on conflict do nothing;
    end if;
    -- Familien-Abo IDEMPOTENT auf Googles echtes Ablaufdatum setzen (SET, keine kumulative Verlängerung)
    -- NUR schreiben, wenn die Familie keinen Zahler hat oder es derselbe ist.
    -- Vorher kippte ein beitretendes Mitglied mit einem alten Token das laufende
    -- Abo der ganzen Familie auf sein eigenes (moeglicherweise abgelaufenes)
    -- Datum – alle verloren den Zugang.
    update public.families set plan = 'family', plan_by = p_user, plan_until = v_exp
     where id = v_fid and (plan_by is null or plan_by = p_user);
    -- … und den Käufer persönlich ebenfalls (er ist selbst Premium).
    update public.profiles
       set tier = 'premium', plan = 'premium',
           premium_since = coalesce(premium_since, now()),
           premium_until = v_exp
     where id = p_user;
  end if;
  return json_build_object('ok', true, 'sku', p_sku, 'until', v_exp);
end $$;
revoke execute on function public.sync_play_expiry(uuid, text, bigint) from public, anon, authenticated;

-- 3) Familien-Sitzplätze IDEMPOTENT aus den aktiven Add-on-Abos neu berechnen.
--    seats_adults   = 2 (Basis) + Anzahl aktiver Erwachsenen-Add-ons in der Familie
--    seats_children = 3 (Basis) + Anzahl aktiver Kinder-Add-ons
--    „aktiv" = expiry_ms in der Zukunft. So gibt es kein Hochzählen bei Re-Verifikation/RTDN.
-- Variante nach FAMILIE statt nach Nutzer. Wird von leave_family gebraucht:
-- dort ist der Austretende schon aus family_members entfernt, die alte Familie
-- also über ihn nicht mehr auffindbar – ohne diese Funktion behielte sie die
-- Sitzplätze eines Add-ons, das mit dem Käufer längst weitergezogen ist.
create or replace function public.recompute_family_seats_fid(p_fid uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_ad int; v_ch int; v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_fid is null then return json_build_object('ok', false, 'reason', 'no_family'); end if;
  select count(*) filter (where pp.sku = 'effyra_adult'),
         count(*) filter (where pp.sku = 'effyra_child')
    into v_ad, v_ch
    from public.play_purchases pp
    join public.family_members fm on fm.user_id = pp.user_id
   where fm.family_id = p_fid
     and coalesce(pp.expiry_ms, 0) > v_now;
  update public.families
     set seats_adults   = 2 + coalesce(v_ad, 0),
         seats_children = 3 + coalesce(v_ch, 0)
   where id = p_fid;
  return json_build_object('ok', true, 'seats_adults', 2 + coalesce(v_ad, 0), 'seats_children', 3 + coalesce(v_ch, 0));
end $$;
revoke execute on function public.recompute_family_seats_fid(uuid) from public, anon, authenticated;

create or replace function public.recompute_family_seats(p_user uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_fid uuid; v_ad int; v_ch int; v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select family_id into v_fid from public.family_members where user_id = p_user limit 1;
  if v_fid is null then return json_build_object('ok', false, 'reason', 'no_family'); end if;
  select count(*) filter (where pp.sku = 'effyra_adult'),
         count(*) filter (where pp.sku = 'effyra_child')
    into v_ad, v_ch
    from public.play_purchases pp
    join public.family_members fm on fm.user_id = pp.user_id
   where fm.family_id = v_fid
     and coalesce(pp.expiry_ms, 0) > v_now;
  update public.families
     set seats_adults   = 2 + coalesce(v_ad, 0),
         seats_children = 3 + coalesce(v_ch, 0)
   where id = v_fid;
  return json_build_object('ok', true, 'seats_adults', 2 + coalesce(v_ad, 0), 'seats_children', 3 + coalesce(v_ch, 0));
end $$;
revoke execute on function public.recompute_family_seats(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 4) Erstattung/Ruecklastschrift: Leistung wieder entziehen
-- ------------------------------------------------------------
-- Google meldet Erstattungen als voidedPurchaseNotification. Ohne diesen Weg
-- blieb die Leistung bestehen: kaufen, erstatten lassen, Credits behalten -
-- beliebig oft wiederholbar. Besonders teuer beim KI-Boost, weil gekaufte
-- Credits ueberrollen und nicht verfallen.
--
-- Bewusst ohne Negativ-Guthaben: verbrauchte Credits werden nicht
-- zurueckgefordert, nur der noch offene Rest entzogen. Alles andere waere
-- gegenueber Nutzern unfair, die in gutem Glauben verbraucht haben.
create or replace function public.revoke_play_purchase(p_user uuid, p_sku text, p_credited_fid uuid default null, p_prev_tier text default null, p_credited_scope text default null)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_fid uuid; v_active_ms bigint; v_stripe_until timestamptz; v_eff_until timestamptz;
begin
  if p_sku = 'effyra_ai_boost' then
    -- Nur den noch vorhandenen Rest, nie unter null.
    -- Den beim KAUF vermerkten Topf treffen, nicht den heutigen raten. Zwischen
    -- Kauf und Erstattung kann das Familienabo abgelaufen sein – dann gingen die
    -- Credits der Familie zu, wuerden aber dem Profil abgezogen.
    -- Fehlt der Vermerk (Kauf vor dieser Aenderung), auf die alte Auswahl
    -- zurueckfallen, damit Altbestaende ueberhaupt entziehbar bleiben.
    if p_credited_scope = 'family' and p_credited_fid is not null then
      -- Beim Kauf vermerkter Familientopf: eindeutig, kein Raten.
      update public.families set ai_extra = greatest(0, coalesce(ai_extra, 0) - 1000) where id = p_credited_fid;
    elsif p_credited_scope = 'personal' then
      -- Beim Kauf vermerkt: der Boost ging aufs Profil, egal ob heute eine
      -- Familie aktiv ist. Genau das war die Zweideutigkeit von credited_fid=null.
      update public.profiles set ai_extra = greatest(0, coalesce(ai_extra, 0) - 1000) where id = p_user;
    else
      -- Kein Vermerk (Altkauf vor dieser Aenderung): auf die alte Heuristik
      -- zurueckfallen, damit Altbestaende ueberhaupt entziehbar bleiben.
      select fm.family_id into v_fid
        from public.family_members fm
        join public.families f on f.id = fm.family_id
       where fm.user_id = p_user
         and f.plan = 'family'
         and (f.plan_until is null or f.plan_until >= now())
       limit 1;
      if v_fid is not null then
        update public.families set ai_extra = greatest(0, coalesce(ai_extra, 0) - 1000) where id = v_fid;
      else
        update public.profiles set ai_extra = greatest(0, coalesce(ai_extra, 0) - 1000) where id = p_user;
      end if;
    end if;

  elsif p_sku = 'effyra_premium' then
    -- Nichts weiter zu tun: der erstattete Token steht bereits auf expiry_ms=0.
    -- Rang und premium_until bestimmt der zentrale Block am Ende der Funktion.
    null;

  elsif p_sku = 'effyra_family' then
    -- Nur die Familie treffen, deren Zahler die erstattende Person IST.
    -- plan_until MIT zuruecksetzen: sonst bliebe die Familie bis zum alten
    -- Ablaufdatum Premium, obwohl der Kauf erstattet wurde.
    select id into v_fid from public.families where plan_by = p_user limit 1;
    update public.families
       set plan = 'free', plan_until = null, plan_by = null
     where plan_by = p_user;
    -- Sitzplaetze NEU RECHNEN, nicht hart auf 2/3 setzen: Zusatzplaetze sind
    -- eigene Kaeufe und von dieser Erstattung gar nicht betroffen.
    if v_fid is not null then perform public.recompute_family_seats_fid(v_fid); end if;
    -- Rang/premium_until bestimmt der zentrale Block am Ende der Funktion.

  elsif p_sku = 'effyra_lifetime' then
    -- Nur die Dauerlizenz selbst entfernen. Rang und premium_until bestimmt der
    -- zentrale Block am Ende: fehlt danach jedes aktive Abo, faellt der Rang auf
    -- den beim Kauf vermerkten Vorkaufs-Rang (p_prev_tier) zurueck – bei einem
    -- 'free'-Nutzer also auf 'free', ohne dabei ein separat bezahltes 'medium'
    -- (Stripe) mitzunehmen.
    update public.profiles set lifetime = false where id = p_user;

  elsif p_sku in ('effyra_adult', 'effyra_child') then
    -- Sitzplaetze rechnet recompute aus den noch AKTIVEN Kaeufen neu; der
    -- erstattete Kauf steht zu diesem Zeitpunkt bereits auf expiry_ms = 0.
    perform public.recompute_family_seats(p_user);

  else
    -- Unbekannter SKU: NICHT stillschweigend Erfolg melden. Sonst quittiert
    -- play-verify die Nachricht mit 200, Google stellt nie erneut zu, und die
    -- Erstattung ist unbemerkt verloren.
    return json_build_object('ok', false, 'reason', 'sku_not_handled', 'sku', p_sku);
  end if;

  -- ---- Rang/premium_until zentral nachbewerten -------------------------------
  -- Nur nach Entzug einer premium-gebenden Leistung. Aus dem, was NACH dem
  -- Entzug noch gilt, statt aus dem Vorzustand zu raten:
  --  * Laeuft noch ein Premium-/Family-Abo, gilt DESSEN echtes Google-Ablauf-
  --    datum (die evtl. gestapelten Zusatztage des erstatteten Abos fallen weg).
  --  * Sonst premium_until kappen und den Rang auf den beim Kauf vermerkten
  --    Vorkaufs-Rang (p_prev_tier) zuruecksetzen. So behaelt ein Nutzer, der als
  --    'free' Premium kaufte und erstatten laesst, NICHTS; ein zuvor per Stripe
  --    oder Dauerlizenz erworbenes 'medium' bleibt erhalten. Ohne Vermerk
  --    (Altkauf) faellt es auf 'medium' zurueck – nie schlechter als bisher.
  --    Eine noch bestehende Dauerlizenz (lifetime=true) haelt 'medium'.
  -- Der natuerliche Ablauf eines Abos laeuft NICHT hier durch (kein void),
  -- sondern bleibt der bewussten 'abgelaufen -> medium'-Landung in effective_tier.
  if p_sku in ('effyra_premium', 'effyra_family', 'effyra_lifetime') then
    select max(pp.expiry_ms) into v_active_ms
      from public.play_purchases pp
     where pp.user_id = p_user
       and pp.sku in ('effyra_premium', 'effyra_family')
       and pp.revoked_at is null
       and coalesce(pp.expiry_ms, 0) > (extract(epoch from now()) * 1000)::bigint;
    -- premium_until aus BEIDEN Quellen bestimmen: dem noch aktiven Play-
    -- Ueberlebenden UND einer noch aktiven Stripe-Subscription. Sonst kappte
    -- der Play-Entzug die bezahlten Stripe-Tage eines Nutzers, der Web und App
    -- mischt.
    select stripe_until into v_stripe_until from public.profiles where id = p_user;
    v_eff_until := null;
    if v_active_ms is not null then v_eff_until := to_timestamp(v_active_ms / 1000.0); end if;
    if v_stripe_until is not null and v_stripe_until >= now() then
      v_eff_until := greatest(coalesce(v_eff_until, v_stripe_until), v_stripe_until);
    end if;
    if v_eff_until is not null then
      -- Noch eine bezahlte Premium-Quelle aktiv: deren spaetestes Datum gilt.
      update public.profiles
         set premium_until = v_eff_until, tier = 'premium'
       where id = p_user;
    else
      update public.profiles
         set premium_until = least(coalesce(premium_until, now()), now()),
             tier = case when lifetime then 'medium' else coalesce(p_prev_tier, 'medium') end
       where id = p_user;
    end if;
  end if;

  return json_build_object('ok', true, 'sku', p_sku);
end $$;
revoke execute on function public.revoke_play_purchase(uuid, text, uuid, text, text) from public, anon, authenticated;
-- Alle frueheren Signaturen entfernen, sonst ist der Aufruf mehrdeutig.
drop function if exists public.revoke_play_purchase(uuid, text);
drop function if exists public.revoke_play_purchase(uuid, text, uuid, text);

-- Ein Aufruf, eine Transaktion. Scheitert der Entzug, nimmt das raise die Marke
-- und expiry_ms automatisch mit zurueck – Pub/Sub bekommt kein 200 und stellt
-- erneut zu. Vorher lagen Anspruch, Entzug und Ruecknahme in drei getrennten
-- Schritten; schlug die Ruecknahme fehl, blieb der Kauf entwertet, ohne dass je
-- etwas entzogen wurde.
create or replace function public.void_play_purchase(p_token text)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_row public.play_purchases%rowtype; v_res json;
begin
  -- for update: zwei gleichzeitige Zustellungen desselben Tokens laufen
  -- nacheinander, die zweite sieht die Marke.
  select * into v_row from public.play_purchases where purchase_token = p_token for update;
  if not found then
    -- Der Token wurde erstattet, BEVOR ihn je eine Verifikation angelegt hat
    -- (Absturz/offline direkt nach dem Kauf). Einen Tombstone setzen: ein
    -- spaeterer Erstkauf trifft dann per onConflict diese Zeile, laeuft NICHT
    -- in isFirst und kann den erstatteten Kauf nicht doch noch gewaehren.
    insert into public.play_purchases (purchase_token, user_id, sku, ptype, expiry_ms, revoked_at, updated_at)
    values (p_token, null, 'unknown', 'unknown', 0, now(), now())
    on conflict (purchase_token) do nothing;
    return json_build_object('ok', true, 'note', 'tombstoned');
  end if;
  if v_row.revoked_at is not null then return json_build_object('ok', true, 'note', 'already'); end if;

  -- Entwerten VOR dem Entzug: recompute_family_seats zaehlt die noch AKTIVEN
  -- Kaeufe, der erstattete darf nicht mitzaehlen.
  update public.play_purchases
     set expiry_ms = 0, revoked_at = now(), updated_at = now()
   where purchase_token = p_token;

  v_res := public.revoke_play_purchase(v_row.user_id, v_row.sku, v_row.credited_fid, v_row.prev_tier, v_row.credited_scope);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    -- Rollt die gesamte Transaktion zurueck, Marke und expiry_ms eingeschlossen.
    raise exception 'revoke_failed: %', coalesce(v_res ->> 'reason', 'unknown') using errcode = '54000';
  end if;
  return json_build_object('ok', true, 'note', 'revoked', 'sku', v_row.sku, 'detail', v_res);
end $$;
revoke execute on function public.void_play_purchase(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
