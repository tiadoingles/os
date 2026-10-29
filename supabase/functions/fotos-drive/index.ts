// Edge Function "fotos-drive" (Produtor de carrosséis, Fase 3). Aba Conteúdo (ou ADM).
// op "sync": percorre a pasta pública do Drive "4. Materiais Visuais / 1. Fotos & Videos" (e subpastas) pela
//   listagem pública embeddedfolderview (a pasta está compartilhada por link; não precisa de chave de API) e grava
//   o catálogo em public.conteudo_fotos (service_role). Fotos que sumiram ficam ativo=false. Vídeos ficam de fora.
// op "imagem": devolve a foto (miniatura do Drive em até 2000 px, já em JPEG, inclusive HEIC/DNG) com CORS, para o
//   html-to-image conseguir exportar o PNG. Só serve ids que estão no catálogo (não é um proxy aberto).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

export const PASTA_RAIZ = "1BiXW-yO-sSyBqujek0P8ohbp1XMtxYeg"; // 4. Materiais Visuais / 1. Fotos & Videos
const EXT_FOTO = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "dng"]);
const ID_OK = /^[A-Za-z0-9_-]{10,80}$/;
const LIMITE_ARQUIVOS = 15000, LIMITE_PASTAS = 500, PROFUNDIDADE = 6;

const desescapar = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Uma pasta da listagem pública: subpastas e arquivos (id, nome). */
export function lerListagem(html: string) {
  const pastas: { id: string; nome: string }[] = [], arquivos: { id: string; nome: string; ext: string }[] = [];
  for (const b of html.split(/(?=<div class="flip-entry" id="entry-)/).slice(1)) {
    const id = (b.match(/^<div class="flip-entry" id="entry-([^"]+)"/) || [])[1];
    const href = (b.match(/<a href="([^"]+)"/) || [])[1] || "";
    const nome = desescapar((b.match(/flip-entry-title">([^<]*)</) || [])[1] || "");
    if (!id || !ID_OK.test(id) || !nome) continue;
    if (href.includes("/drive/folders/")) pastas.push({ id, nome });
    else {
      const ext = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
      if (EXT_FOTO.has(ext)) arquivos.push({ id, nome, ext });
    }
  }
  return { pastas, arquivos };
}

async function baixarListagem(id: string): Promise<string> {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, { signal: AbortSignal.timeout(15000), headers: { "accept-language": "pt-BR" } });
  if (!r.ok) throw new Error(`Drive respondeu ${r.status} para a pasta ${id}`);
  return await r.text();
}

/** Percorre a árvore (largura primeiro), 4 pastas por vez. */
export async function varrer(raiz = PASTA_RAIZ) {
  const fila: { id: string; caminho: string; nivel: number }[] = [{ id: raiz, caminho: "", nivel: 0 }];
  const vistas = new Set<string>([raiz]);
  const fotos: { drive_id: string; nome: string; pasta: string; pasta_id: string; extensao: string }[] = [];
  const erros: string[] = [];
  let pastasLidas = 0;
  while (fila.length && pastasLidas < LIMITE_PASTAS && fotos.length < LIMITE_ARQUIVOS) {
    const lote = fila.splice(0, 4);
    await Promise.all(lote.map(async (p) => {
      try {
        const { pastas, arquivos } = lerListagem(await baixarListagem(p.id));
        pastasLidas++;
        for (const a of arquivos) fotos.push({ drive_id: a.id, nome: a.nome, pasta: p.caminho || "(raiz)", pasta_id: p.id, extensao: a.ext });
        if (p.nivel < PROFUNDIDADE) for (const s of pastas) if (!vistas.has(s.id)) {
          vistas.add(s.id);
          fila.push({ id: s.id, caminho: p.caminho ? `${p.caminho} / ${s.nome}` : s.nome, nivel: p.nivel + 1 });
        }
      } catch (e) { erros.push(String((e as Error).message || e)); }
    }));
  }
  // O mesmo arquivo pode aparecer em duas pastas (atalho): fica a primeira.
  const unicas = new Map(fotos.map((f) => [f.drive_id, f]));
  return { fotos: [...unicas.values()].slice(0, LIMITE_ARQUIVOS), pastasLidas, erros };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "Não autenticado" }, 401);
  const { data: p } = await admin.from("profiles").select("role, areas").eq("id", u.user.id).maybeSingle();
  if (!p || !(p.role === "admin" || (Array.isArray(p.areas) && p.areas.includes("conteudo")))) return json({ error: "Sem permissão: esta ação é da aba Conteúdo." }, 403);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* vazio */ }

  if (body.op === "imagem") {
    const id = String(body.id || "");
    const w = Math.max(200, Math.min(2000, Number(body.w) || 1600));
    if (!ID_OK.test(id)) return json({ error: "id inválido" }, 400);
    const { data: f } = await admin.from("conteudo_fotos").select("drive_id").eq("drive_id", id).maybeSingle();
    if (!f) return json({ error: "Foto fora do catálogo" }, 404);
    try {
      const r = await fetch(`https://drive.google.com/thumbnail?id=${id}&sz=w${w}`, { redirect: "follow", signal: AbortSignal.timeout(20000) });
      const tipo = r.headers.get("content-type") || "";
      if (!r.ok || !tipo.startsWith("image/")) return json({ error: `O Drive não devolveu a imagem (HTTP ${r.status}). Confira se a pasta continua compartilhada por link.` }, 502);
      return new Response(r.body, { headers: { ...cors, "Content-Type": tipo, "Cache-Control": "private, max-age=86400" } });
    } catch (e) { return json({ error: "Falha ao buscar a foto: " + String((e as Error).message || e) }, 502); }
  }

  if (body.op === "sync") {
    const inicio = new Date().toISOString();
    const { fotos, pastasLidas, erros } = await varrer();
    if (!fotos.length) return json({ error: "Nenhuma foto encontrada. Confira se a pasta continua compartilhada por link.", erros }, 502);
    for (let i = 0; i < fotos.length; i += 500) {
      const { error } = await admin.from("conteudo_fotos").upsert(fotos.slice(i, i + 500).map((f) => ({ ...f, ativo: true, visto_em: inicio })), { onConflict: "drive_id" });
      if (error) return json({ error: error.message }, 500);
    }
    // Só desativa as que sumiram se a varredura terminou sem erro (senão uma pasta que falhou "apagaria" fotos).
    let desativadas = 0;
    if (!erros.length) {
      const { data } = await admin.from("conteudo_fotos").update({ ativo: false }).lt("visto_em", inicio).eq("ativo", true).select("drive_id");
      desativadas = (data || []).length;
    }
    return json({ ok: true, fotos: fotos.length, pastas: pastasLidas, desativadas, erros: erros.slice(0, 5) });
  }

  return json({ error: "op desconhecida" }, 400);
});
