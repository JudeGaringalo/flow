import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { PMTiles, TileType } from 'pmtiles';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'lib', 'hazard-bundle.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const [west, south, east, north] = manifest.bounds;
const archiveUrl = 'https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps/resolve/main/PMTiles/layers/flood_5yr.pmtiles';
const outputRoot = join(root, 'public', 'hazard');
const outputPath = join(outputRoot, manifest.version);
const tempRoot = await mkdtemp(join(tmpdir(), 'flow-noah-'));
const archivePath = process.argv[2] ? resolve(process.argv[2]) : join(tempRoot, 'flood_5yr.pmtiles');
const stagePath = join(outputRoot, `${manifest.version}.building`);
const backupPath = join(outputRoot, `${manifest.version}.previous`);

function xTile(longitude, zoom) {
  return Math.max(0, Math.min(2 ** zoom - 1,
    Math.floor((longitude + 180) / 360 * 2 ** zoom)));
}

function yTile(latitude, zoom) {
  const radians = latitude * Math.PI / 180;
  const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
  return Math.max(0, Math.min(2 ** zoom - 1, Math.floor(value)));
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
  const name = Buffer.from('flood_5yr');
  const layer = Buffer.concat([
    Buffer.from([0x0a]), varint(name.length), name,
    Buffer.from([0x28]), varint(4096),
    Buffer.from([0x78, 0x02]),
  ]);
  return Buffer.concat([Buffer.from([0x1a]), varint(layer.length), layer]);
}

async function downloadArchive(destination) {
  console.log('Downloading the NOAH 5-year archive once. This is about 510 MB.');
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`NOAH download failed: HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('text/html')) throw new Error('NOAH returned a webpage instead of the archive.');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function createFileSource(filePath) {
  const handle = await open(filePath, 'r');
  return {
    handle,
    source: {
      getKey: () => filePath,
      getBytes: async (offset, length) => {
        const bytes = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const { bytesRead } = await handle.read(bytes, read, length - read, offset + read);
          if (!bytesRead) throw new Error('NOAH archive is incomplete.');
          read += bytesRead;
        }
        return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
      },
    },
  };
}

try {
  if (!process.argv[2]) await downloadArchive(archivePath);
  const { handle, source } = await createFileSource(archivePath);
  try {
    const archive = new PMTiles(source);
    const header = await archive.getHeader();
    if (header.tileType !== TileType.Mvt || header.maxZoom < 12)
      throw new Error('This is not the NOAH vector tile archive expected by FLOW.');
    const expectedSize = header.tileDataOffset + (header.tileDataLength ?? 0);
    if (expectedSize > (await stat(archivePath)).size)
      throw new Error('NOAH archive is incomplete. Download it again.');
    const metadata = await archive.getMetadata();
    if (!metadata || typeof metadata !== 'object' ||
        !Array.isArray(metadata.vector_layers) ||
        !metadata.vector_layers.some(layer => layer.id === 'flood_5yr'))
      throw new Error('The archive does not contain the flood_5yr tile layer.');

    await mkdir(outputRoot, { recursive: true });
    await rm(stagePath, { recursive: true, force: true });
    const blank = emptyTile();
    let tileCount = 0;
    let dataTiles = 0;
    let detailedDataTiles = 0;
    let totalBytes = 0;
    const minimum = header.minZoom;
    const maximum = Math.min(manifest.maxzoom, header.maxZoom);
    for (let z = minimum; z <= maximum; z++) {
      const minX = xTile(west, z), maxX = xTile(east, z);
      const minY = yTile(north, z), maxY = yTile(south, z);
      for (let x = minX; x <= maxX; x++) {
        await mkdir(join(stagePath, String(z), String(x)), { recursive: true });
        for (let y = minY; y <= maxY; y++) {
          const tile = await archive.getZxy(z, x, y);
          const bytes = tile ? Buffer.from(tile.data) : blank;
          await writeFile(join(stagePath, String(z), String(x), `${y}.pbf`), bytes);
          tileCount++;
          if (tile) {
            dataTiles++;
            if (z >= 12) detailedDataTiles++;
          }
          totalBytes += bytes.length;
        }
      }
      console.log(`Zoom ${z} complete`);
    }
    if (!detailedDataTiles)
      throw new Error('NOAH returned no detailed flood tiles for the NCR bounds. The map was not switched to local data.');
    if (totalBytes > 80 * 1024 * 1024)
      throw new Error('Local tiles exceed 80 MB; a smaller regional bundle is needed.');

    await rm(backupPath, { recursive: true, force: true });
    try { await rename(outputPath, backupPath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try { await rename(stagePath, outputPath); } catch (error) {
      try { await rename(backupPath, outputPath); } catch {  }
      throw error;
    }
    const nextManifest = { ...manifest, ready: true, minzoom: minimum,
      maxzoom: maximum, tileCount, dataTiles, detailedDataTiles };
    await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    await rm(backupPath, { recursive: true, force: true });
    console.log(`Local NOAH tiles ready: ${dataTiles} data tiles, ${tileCount} files, ${(totalBytes / 1048576).toFixed(1)} MB.`);
    console.log('Commit lib/hazard-bundle.json and public/hazard with the app.');
  } finally {
    await handle.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(stagePath, { recursive: true, force: true });
  await rm(tempRoot, { recursive: true, force: true });
}
