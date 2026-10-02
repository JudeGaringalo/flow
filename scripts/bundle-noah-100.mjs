import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PMTiles, TileType } from 'pmtiles';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'lib', 'hazard-100.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const archivePath = process.argv[2] && resolve(process.argv[2]);
if (!archivePath) throw new Error('Pass the local flood_100yr.pmtiles archive path.');
const outputPath = join(root, 'public', 'hazard', manifest.version);
const stagePath = `${outputPath}.building`;
const backupPath = `${outputPath}.previous`;

function tileX(longitude, zoom) {
  return Math.max(0, Math.min(2 ** zoom - 1,
    Math.floor((longitude + 180) / 360 * 2 ** zoom)));
}

function tileY(latitude, zoom) {
  const radians = latitude * Math.PI / 180;
  return Math.max(0, Math.min(2 ** zoom - 1,
    Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom)));
}

function varint(value) {
  const bytes = [];
  do {
    bytes.push((value & 127) | (value > 127 ? 128 : 0));
    value = Math.floor(value / 128);
  } while (value);
  return Buffer.from(bytes);
}

function emptyTile() {
  const name = Buffer.from('flood_100yr');
  const layer = Buffer.concat([
    Buffer.from([0x0a]), varint(name.length), name,
    Buffer.from([0x28]), varint(4096), Buffer.from([0x78, 0x02]),
  ]);
  return Buffer.concat([Buffer.from([0x1a]), varint(layer.length), layer]);
}

const handle = await open(archivePath, 'r');
try {
  const source = {
    getKey: () => archivePath,
    getBytes: async (offset, length) => {
      const bytes = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(bytes, read, length - read, offset + read);
        if (!bytesRead) throw new Error('The flood archive is incomplete.');
        read += bytesRead;
      }
      return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    },
  };
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  const metadata = await archive.getMetadata();
  if (header.tileType !== TileType.Mvt || header.maxZoom < manifest.maxzoom ||
      header.tileDataOffset + header.tileDataLength > (await stat(archivePath)).size ||
      !metadata.vector_layers?.some(layer => layer.id === 'flood_100yr')) {
    throw new Error('Expected the complete NOAH 100-year vector archive.');
  }

  await rm(stagePath, { recursive: true, force: true });
  const blank = emptyTile();
  let tileCount = 0;
  let dataTiles = 0;
  let totalBytes = 0;
  for (let zoom = 0; zoom <= manifest.maxzoom; zoom++) {
    const [west, south, east, north] = zoom <= manifest.overviewMaxzoom
      ? manifest.overviewBounds : manifest.detailBounds;
    for (let x = tileX(west, zoom); x <= tileX(east, zoom); x++) {
      await mkdir(join(stagePath, String(zoom), String(x)), { recursive: true });
      for (let y = tileY(north, zoom); y <= tileY(south, zoom); y++) {
        const tile = await archive.getZxy(zoom, x, y);
        const bytes = gzipSync(tile ? Buffer.from(tile.data) : blank);
        await writeFile(join(stagePath, String(zoom), String(x), `${y}.pbf.gz`), bytes);
        tileCount++;
        if (tile) dataTiles++;
        totalBytes += bytes.length;
      }
    }
  }
  if (dataTiles < 500) throw new Error('The archive did not provide the expected flood tiles.');

  await rm(backupPath, { recursive: true, force: true });
  try { await rename(outputPath, backupPath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try { await rename(stagePath, outputPath); } catch (error) {
    try { await rename(backupPath, outputPath); } catch { /* Preserve the original error. */ }
    throw error;
  }
  await writeFile(manifestPath, `${JSON.stringify({
    ...manifest, ready: true, tileCount, dataTiles, compressed: true,
    dataBounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
  }, null, 2)}\n`);
  await rm(backupPath, { recursive: true, force: true });
  console.log(`100-year flood map: ${dataTiles}/${tileCount} data tiles, ${(totalBytes / 1048576).toFixed(1)} MB.`);
} finally {
  await handle.close();
  await rm(stagePath, { recursive: true, force: true });
}
