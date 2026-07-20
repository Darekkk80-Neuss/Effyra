// Effyra – gemeinsame Helfer für alle Edge Functions
// ----------------------------------------------------------------------------
// Ordner mit führendem "_" wird von Supabase nicht als eigene Function deployt,
// sondern in die importierenden Functions hineingebündelt.
//
// Drei Bausteine, die vorher überall gefehlt haben:
//   pMap    – begrenzt nebenläufige Verarbeitung statt sequenzieller for-Schleife
//   fetchT  – fetch MIT Timeout (ohne läuft ein hängender Anbieter ins Function-Limit)
//   pageAll – blättert über PostgREST-Seiten (max_rows kappt sonst still bei 1000)

/** Führt fn für alle items aus, höchstens `limit` gleichzeitig. Reihenfolge des
 *  Ergebnisses entspricht der Eingabe. Ein Fehler in fn bricht alles ab –
 *  Aufrufer fangen ihn deshalb typischerweise innerhalb von fn ab. */
export async function pMap<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** fetch mit hartem Timeout. Ohne diesen hängt ein langsamer Drittanbieter die
 *  Function bis zum Plattform-Limit auf und reißt den ganzen Lauf mit. */
export function fetchT(input: string | URL | Request, init: RequestInit = {}, ms = 15000): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
}

/** Versucht `primary`, nutzt bei einem Fehler `fallback`.
 *  Gedacht für die schlanken JSON-Pfad-Selects (`lang:data->profile->>lang`):
 *  spart viel Übertragung, hängt aber an der PostgREST-Version. Scheitert sie,
 *  soll der Lauf nicht ausfallen, sondern nur wieder den vollen Blob laden. */
export async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try { return await primary(); } catch (_e) { return await fallback(); }
}

/** Zerlegt eine Liste in Blöcke fester Größe. Nötig für .in()-Filter: PostgREST
 *  überträgt sie als Query-String, tausende IDs laufen sonst in ein 414. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Wie pageAll, gibt die Seiten aber EINZELN weiter, statt alles zu sammeln.
 *  Entscheidend, wenn die Zeilen groß sind (JSONB-Blobs): der Speicherbedarf
 *  bleibt bei einer Seite statt bei der ganzen Tabelle, und die 256-MB-Grenze
 *  der Edge Functions ist damit unabhängig von der Nutzerzahl.
 *
 *  WICHTIG: Der Aufrufer MUSS eine stabile Sortierung setzen (.order(...)).
 *  Ohne order by garantiert Postgres bei range()/OFFSET keine konsistente
 *  Reihenfolge – Zeilen könnten übersprungen oder doppelt verarbeitet werden. */
export async function pageEach<T = any>(
  build: () => any,
  onPage: (rows: T[]) => Promise<void> | void,
  size = 500,
  hardLimit = 200000,
): Promise<number> {
  let total = 0;
  for (let from = 0; from < hardLimit; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    total += data.length;
    await onPage(data as T[]);
    if (data.length < size) break;
  }
  return total;
}

/** Liest ALLE Zeilen einer PostgREST-Abfrage seitenweise.
 *  `build` muss den Query bei jedem Aufruf NEU erzeugen (Builder sind einmalig).
 *  Wichtig, weil ein nacktes .select() serverseitig bei max_rows (Default 1000)
 *  abgeschnitten wird – ohne Fehler, ohne Hinweis. */
export async function pageAll<T = any>(
  build: () => any,
  size = 1000,
  hardLimit = 100000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < hardLimit; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    rows.push(...(data as T[]));
    if (data.length < size) break;
  }
  return rows;
}
