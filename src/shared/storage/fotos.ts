/**
 * Dónde se guardan las fotos de recepción.
 *
 * En producción, en **Supabase Storage**, en un bucket privado: nada es
 * público, y el panel ve cada foto con un enlace firmado que vence en minutos.
 * El backend habla con la API de Storage con la clave de servicio, que vive
 * sólo en el servidor (Render), nunca en el panel.
 *
 * En desarrollo y en las pruebas, en una carpeta del disco, con enlaces
 * firmados por el propio backend (`/api/archivos/...`). Así se prueba todo el
 * flujo sin depender de Supabase.
 *
 * En producción **sin** la configuración de Supabase, las fotos quedan
 * desactivadas en vez de caer al disco: el de Render se borra en cada
 * despliegue, y una foto que se pierde sin aviso es peor que un mensaje que
 * dice que falta configurar algo.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../../config';

export interface Almacen {
  readonly nombre: 'supabase' | 'local';
  subir(ruta: string, bytes: Buffer, tipo: string): Promise<void>;
  /** Un enlace que deja ver el archivo durante `segundos`. */
  urlFirmada(ruta: string, segundos: number): Promise<string>;
  borrar(rutas: string[]): Promise<void>;
}

// ─── Supabase ────────────────────────────────────────────────────────────────

export class AlmacenSupabase implements Almacen {
  readonly nombre = 'supabase' as const;
  constructor(
    private readonly url: string,
    private readonly clave: string,
    private readonly bucket: string,
  ) {}

  private cabeceras(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.clave}`, apikey: this.clave, ...extra };
  }

  private async exigir(res: Response, que: string): Promise<void> {
    if (res.ok) return;
    // El cuerpo de error de Storage dice qué pasó (bucket inexistente, clave
    // mala); va al log, no al usuario.
    const detalle = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Storage: no se pudo ${que} (HTTP ${res.status}) ${detalle}`);
  }

  async subir(ruta: string, bytes: Buffer, tipo: string): Promise<void> {
    const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${ruta}`, {
      method: 'POST',
      headers: this.cabeceras({ 'Content-Type': tipo, 'x-upsert': 'false' }),
      body: bytes,
    });
    await this.exigir(res, 'subir la foto');
  }

  async urlFirmada(ruta: string, segundos: number): Promise<string> {
    const res = await fetch(`${this.url}/storage/v1/object/sign/${this.bucket}/${ruta}`, {
      method: 'POST',
      headers: this.cabeceras({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: segundos }),
    });
    await this.exigir(res, 'firmar el enlace');
    const { signedURL } = (await res.json()) as { signedURL: string };
    return `${this.url}/storage/v1${signedURL}`;
  }

  async borrar(rutas: string[]): Promise<void> {
    if (rutas.length === 0) return;
    const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}`, {
      method: 'DELETE',
      headers: this.cabeceras({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: rutas }),
    });
    await this.exigir(res, 'borrar las fotos');
  }
}

// ─── Disco (desarrollo y pruebas) ────────────────────────────────────────────

/** Firma de un enlace local: la ruta y el vencimiento, con el JWT_SECRET. */
function firma(ruta: string, vence: number): string {
  return createHmac('sha256', config.JWT_SECRET).update(`archivo:${ruta}:${vence}`).digest('base64url');
}

/** Rutas que genera este módulo: `<uuid>/<uuid>/<uuid>.jpg`. Nada más se sirve. */
const RUTA_VALIDA = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

class AlmacenLocal implements Almacen {
  readonly nombre = 'local' as const;
  constructor(readonly dir: string) {}

  private archivo(ruta: string): string {
    if (!RUTA_VALIDA.test(ruta)) throw new Error('Ruta de archivo inválida');
    return path.join(this.dir, ruta);
  }

  async subir(ruta: string, bytes: Buffer): Promise<void> {
    const f = this.archivo(ruta);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes, { flag: 'wx' });
  }

  async urlFirmada(ruta: string, segundos: number): Promise<string> {
    const vence = Math.floor(Date.now() / 1000) + segundos;
    return `/api/archivos/${ruta}?vence=${vence}&firma=${firma(ruta, vence)}`;
  }

  async borrar(rutas: string[]): Promise<void> {
    await Promise.all(rutas.map((r) => rm(this.archivo(r), { force: true })));
  }

  /** Para la ruta `/api/archivos/*`: el archivo si la firma vale y no venció. */
  async leerFirmado(ruta: string, vence: number, f: string): Promise<Buffer | null> {
    if (!RUTA_VALIDA.test(ruta) || !Number.isFinite(vence) || vence < Date.now() / 1000) return null;
    const esperada = Buffer.from(firma(ruta, vence));
    const recibida = Buffer.from(f);
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
    return readFile(this.archivo(ruta)).catch(() => null);
  }
}

// ─── Cuál se usa ─────────────────────────────────────────────────────────────

let almacen: Almacen | null | undefined;

/** El almacén configurado, o `null` si las fotos están desactivadas. */
export function obtenerAlmacen(): Almacen | null {
  if (almacen !== undefined) return almacen;
  if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
    almacen = new AlmacenSupabase(config.SUPABASE_URL.replace(/\/$/, ''), config.SUPABASE_SERVICE_ROLE_KEY, config.FOTOS_BUCKET);
  } else if (process.env.NODE_ENV === 'production') {
    almacen = null;
  } else {
    almacen = new AlmacenLocal(config.FOTOS_DIR ?? path.join(tmpdir(), 'qlarity-fotos'));
  }
  return almacen;
}

export function almacenLocal(): AlmacenLocal | null {
  const a = obtenerAlmacen();
  return a instanceof AlmacenLocal ? a : null;
}

/** Para las pruebas: cambiar el almacén por uno falso. */
export function usarAlmacen(a: Almacen | null | undefined): void {
  almacen = a;
}
