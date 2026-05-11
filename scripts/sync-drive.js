/**
 * sync-drive.js
 * Lee la carpeta raíz de Google Drive y regenera data.json
 * manteniendo la estructura exacta que consume la app.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_DRIVE_CREDENTIALS  — JSON completo de la service account (string)
 *   GOOGLE_DRIVE_ROOT_FOLDER_ID — ID de la carpeta raíz (opcional, tiene fallback)
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const ROOT_FOLDER_ID =
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '1t6O0c68HfImS3Lnukhs24a8DmpVqQvfH';

const DATA_JSON_PATH = path.join(__dirname, '..', 'data.json');

// Categorías canónicas: define orden, ID de app, nombre visible e ícono.
// El campo "match" lista variantes normalizadas que se aceptan desde Drive.
const CANONICAL_CATEGORIES = [
  {
    id: 'iny',
    name: 'INYECCIÓN',
    icon: 'fa-syringe',
    match: ['inyeccion', 'inyección', 'inyectores'],
  },
  {
    id: 'mot',
    name: 'MOTORES',
    icon: 'fa-car-side',
    match: ['motores', 'motor'],
  },
  {
    id: 'iot',
    name: 'IOT',
    icon: 'fa-microchip',
    match: ['iot'],
  },
  {
    id: 'pre',
    name: 'PRESENTACIÓN',
    icon: 'fa-desktop',
    match: ['presentacion', 'presentación', 'presentaciones'],
  },
  {
    id: 'mec',
    name: 'MECANIZADO',
    icon: 'fa-gears',
    match: ['mecanizado', 'mecanizados'],
  },
  {
    id: 'pru',
    name: 'BANCO PRUEBAS',
    icon: 'fa-gauge-high',
    match: ['banco pruebas', 'banco de pruebas', 'pruebas', 'banco'],
  },
  {
    id: 'cam',
    name: 'SERVICIO CAMPO',
    icon: 'fa-truck-fast',
    match: ['servicio campo', 'servicio a campo', 'campo'],
  },
  {
    id: 'gen',
    name: 'GENERACIÓN',
    icon: 'fa-bolt',
    match: ['generacion', 'generación', 'generadores', 'generador'],
  },
];

// MIME types aceptados (videos, imágenes, PDFs)
const ACCEPTED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/3gpp',
  'video/mpeg',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
]);

// ─── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Normaliza un string para comparación: minúsculas, sin tildes, sin espacios extra.
 */
function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // elimina diacríticos
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Intenta matchear el nombre de una carpeta de Drive con las categorías canónicas.
 * Devuelve la categoría canónica o null.
 */
function matchCategory(folderName) {
  const norm = normalize(folderName);
  for (const cat of CANONICAL_CATEGORIES) {
    for (const variant of cat.match) {
      if (norm === variant || norm.includes(variant) || variant.includes(norm)) {
        return cat;
      }
    }
  }
  return null;
}

/**
 * Elimina la extensión del nombre de archivo si existe.
 * Drive a veces incluye extensión en el nombre; la dejamos
 * si ya viene sin ella (comportamiento igual al original).
 */
function stripExtension(name) {
  // Solo elimina extensiones comunes de video/imagen/pdf
  return name.replace(/\.(mp4|mov|avi|mkv|webm|3gp|mpeg|jpg|jpeg|png|gif|webp|pdf)$/i, '');
}

/**
 * Genera el link de Drive en el formato que usa la app.
 */
function driveLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view?usp=drive_link`;
}

// ─── Google Drive API ─────────────────────────────────────────────────────────

function buildAuthClient() {
  const credJson = process.env.GOOGLE_DRIVE_CREDENTIALS;
  if (!credJson) {
    throw new Error(
      'La variable de entorno GOOGLE_DRIVE_CREDENTIALS no está definida.\n' +
      'Debe contener el JSON completo de la service account.'
    );
  }

  let creds;
  try {
    creds = JSON.parse(credJson);
  } catch {
    throw new Error('GOOGLE_DRIVE_CREDENTIALS no es un JSON válido.');
  }

  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

/**
 * Lista TODOS los elementos de una carpeta (paginación automática).
 * Filtra carpetas en papelera.
 */
async function listFolder(drive, folderId, extraQuery = '') {
  const items = [];
  let pageToken = null;

  const baseQuery = `'${folderId}' in parents and trashed = false${extraQuery}`;

  do {
    const res = await drive.files.list({
      q: baseQuery,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 1000,
      pageToken: pageToken || undefined,
    });
    items.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return items;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         ARSA — Sincronización Google Drive        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`📁 Carpeta raíz: ${ROOT_FOLDER_ID}`);
  console.log(`📄 Destino:      ${DATA_JSON_PATH}\n`);

  // 1. Autenticación
  const auth = buildAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  // 2. Listar subcarpetas directas de la raíz
  const allFolders = await listFolder(
    drive,
    ROOT_FOLDER_ID,
    " and mimeType = 'application/vnd.google-apps.folder'"
  );

  console.log(`📂 Subcarpetas encontradas en Drive: ${allFolders.length}`);
  allFolders.forEach(f => console.log(`   • ${f.name} (${f.id})`));
  console.log('');

  // 3. Matchear carpetas con categorías canónicas
  const categoryMap = new Map(); // cat.id → { cat, folder }

  for (const folder of allFolders) {
    const cat = matchCategory(folder.name);
    if (cat) {
      if (categoryMap.has(cat.id)) {
        console.warn(`⚠️  Carpeta duplicada para categoría "${cat.name}": se usará "${folder.name}" (ya había otra)`);
      } else {
        categoryMap.set(cat.id, { cat, folder });
        console.log(`✅ Match: "${folder.name}" → ${cat.id} (${cat.name})`);
      }
    } else {
      console.warn(`⚠️  Sin match: "${folder.name}" no corresponde a ninguna categoría conocida`);
    }
  }
  console.log('');

  // 4. Para cada categoría canónica (en orden), listar archivos
  const database = [];
  const fileNames = {};
  let totalLinks = 0;

  for (const cat of CANONICAL_CATEGORIES) {
    const entry = categoryMap.get(cat.id);

    if (!entry) {
      console.warn(`⚠️  Categoría "${cat.name}" (${cat.id}) no tiene carpeta en Drive. Se incluye vacía.`);
      database.push({ id: cat.id, name: cat.name, icon: cat.icon, links: [] });
      continue;
    }

    // Listar archivos directos (no subcarpetas) de la carpeta de la categoría
    const allFiles = await listFolder(
      drive,
      entry.folder.id,
      " and mimeType != 'application/vnd.google-apps.folder'"
    );

    // Filtrar por MIME types aceptados
    const accepted = allFiles.filter(f => ACCEPTED_MIME_TYPES.has(f.mimeType));
    const rejected = allFiles.filter(f => !ACCEPTED_MIME_TYPES.has(f.mimeType));

    if (rejected.length > 0) {
      rejected.forEach(f =>
        console.log(`   ⛔ Excluido: "${f.name}" (${f.mimeType})`)
      );
    }

    // Ordenar por nombre ascendente (estable entre ejecuciones)
    accepted.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

    // Generar links y fileNames
    const links = accepted.map(f => {
      const title = stripExtension(f.name);
      fileNames[f.id] = title;
      return driveLink(f.id);
    });

    totalLinks += links.length;

    console.log(`📋 ${cat.name}: ${links.length} archivos`);
    accepted.forEach(f => console.log(`   • ${f.name}`));

    database.push({ id: cat.id, name: cat.name, icon: cat.icon, links });
  }

  console.log('');
  console.log(`📊 Resumen:`);
  console.log(`   Categorías generadas : ${database.length}`);
  console.log(`   Links totales        : ${totalLinks}`);
  console.log(`   Entradas fileNames   : ${Object.keys(fileNames).length}`);

  // 5. Escribir data.json
  const output = { database, fileNames };
  fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n✅ data.json escrito correctamente en:\n   ${DATA_JSON_PATH}\n`);
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
