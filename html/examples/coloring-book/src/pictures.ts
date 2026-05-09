// Static catalog. Vite resolves the ?url imports at build time and gives us
// hashed asset URLs we can feed straight to Phaser's loader.

import appleLines from "../assets/apple_lines.png?url";
import appleLabels from "../assets/apple_labels.png?url";
import houseLines from "../assets/house_lines.png?url";
import houseLabels from "../assets/house_labels.png?url";
import starLines from "../assets/star_lines.png?url";
import starLabels from "../assets/star_labels.png?url";
import catLines from "../assets/cat_lines.png?url";
import catLabels from "../assets/cat_labels.png?url";
import fishLines from "../assets/fish_lines.png?url";
import fishLabels from "../assets/fish_labels.png?url";
import balloonLines from "../assets/balloon_lines.png?url";
import balloonLabels from "../assets/balloon_labels.png?url";
import cupcakeLines from "../assets/cupcake_lines.png?url";
import cupcakeLabels from "../assets/cupcake_labels.png?url";
import robotLines from "../assets/robot_lines.png?url";
import robotLabels from "../assets/robot_labels.png?url";
import sailboatLines from "../assets/sailboat_lines.png?url";
import sailboatLabels from "../assets/sailboat_labels.png?url";
import flowerLines from "../assets/flower_lines.png?url";
import flowerLabels from "../assets/flower_labels.png?url";
import wolfLines from "../assets/wolf_lines.png?url";
import wolfLabels from "../assets/wolf_labels.png?url";
import mermaidLines from "../assets/mermaid_lines.png?url";
import mermaidLabels from "../assets/mermaid_labels.png?url";
import unicornLines from "../assets/unicorn_lines.png?url";
import unicornLabels from "../assets/unicorn_labels.png?url";
// Auto-parsed subjects — line-art PNG → parser → lines/labels pair.
// Source PNGs live in ../source-art/, regenerate via `npm run gen-autoparsed-assets`.
import butterflyLines from "../assets/butterfly_lines.png?url";
import butterflyLabels from "../assets/butterfly_labels.png?url";
import rocketLines from "../assets/rocket_lines.png?url";
import rocketLabels from "../assets/rocket_labels.png?url";
import cakeLines from "../assets/cake_lines.png?url";
import cakeLabels from "../assets/cake_labels.png?url";
import dragonLines from "../assets/dragon_lines.png?url";
import dragonLabels from "../assets/dragon_labels.png?url";
import whaleLines from "../assets/whale_lines.png?url";
import whaleLabels from "../assets/whale_labels.png?url";

import { events } from "./events";

export interface Picture {
  slug: string;
  title: string;
  linesUrl: string;
  labelsUrl: string;
  imported?: boolean;
}

export interface ImportedPicture {
  id: string; // stable slug used as Phaser texture key
  name: string;
  linesPng: string; // data URL
  labelsPng: string; // data URL
  addedAt: number; // epoch ms
}

// Built-in pictures are preloaded by the Phaser scene. Exported as PICTURES
// so existing call sites keep working. Imported pictures are surfaced via
// `getAllPictures()` (built-ins + imported) and loaded into Phaser on demand.
export const PICTURES: Picture[] = [
  { slug: "apple", title: "Apple", linesUrl: appleLines, labelsUrl: appleLabels },
  { slug: "house", title: "House", linesUrl: houseLines, labelsUrl: houseLabels },
  { slug: "star", title: "Star", linesUrl: starLines, labelsUrl: starLabels },
  { slug: "cat", title: "Cat", linesUrl: catLines, labelsUrl: catLabels },
  { slug: "fish", title: "Fish", linesUrl: fishLines, labelsUrl: fishLabels },
  {
    slug: "balloon",
    title: "Hot Air Balloon",
    linesUrl: balloonLines,
    labelsUrl: balloonLabels,
  },
  {
    slug: "cupcake",
    title: "Cupcake",
    linesUrl: cupcakeLines,
    labelsUrl: cupcakeLabels,
  },
  { slug: "robot", title: "Robot", linesUrl: robotLines, labelsUrl: robotLabels },
  {
    slug: "sailboat",
    title: "Sailboat",
    linesUrl: sailboatLines,
    labelsUrl: sailboatLabels,
  },
  {
    slug: "flower",
    title: "Flower",
    linesUrl: flowerLines,
    labelsUrl: flowerLabels,
  },
  { slug: "wolf", title: "Wolf", linesUrl: wolfLines, labelsUrl: wolfLabels },
  {
    slug: "mermaid",
    title: "Mermaid",
    linesUrl: mermaidLines,
    labelsUrl: mermaidLabels,
  },
  {
    slug: "unicorn",
    title: "Unicorn",
    linesUrl: unicornLines,
    labelsUrl: unicornLabels,
  },
  {
    slug: "butterfly",
    title: "Butterfly",
    linesUrl: butterflyLines,
    labelsUrl: butterflyLabels,
  },
  {
    slug: "rocket",
    title: "Rocket",
    linesUrl: rocketLines,
    labelsUrl: rocketLabels,
  },
  {
    slug: "cake",
    title: "Birthday Cake",
    linesUrl: cakeLines,
    labelsUrl: cakeLabels,
  },
  {
    slug: "dragon",
    title: "Dragon",
    linesUrl: dragonLines,
    labelsUrl: dragonLabels,
  },
  {
    slug: "whale",
    title: "Whale",
    linesUrl: whaleLines,
    labelsUrl: whaleLabels,
  },
];

const STORAGE_KEY = "coloringbook_imported_v1";
const IMPORT_CAP = 20;

let imported: ImportedPicture[] = loadImported();

function loadImported(): ImportedPicture[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isImportedPicture);
  } catch {
    return [];
  }
}

function isImportedPicture(v: unknown): v is ImportedPicture {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.linesPng === "string" &&
    typeof o.labelsPng === "string" &&
    typeof o.addedAt === "number"
  );
}

function importedAsPictures(): Picture[] {
  return imported.map((p) => ({
    slug: p.id,
    title: p.name,
    linesUrl: p.linesPng,
    labelsUrl: p.labelsPng,
    imported: true,
  }));
}

export function getImportedPictures(): readonly ImportedPicture[] {
  return imported;
}

export function getAllPictures(): Picture[] {
  return [...PICTURES, ...importedAsPictures()];
}

export function findPicture(slug: string): Picture | undefined {
  const built = PICTURES.find((p) => p.slug === slug);
  if (built) return built;
  const imp = imported.find((p) => p.id === slug);
  if (!imp) return undefined;
  return {
    slug: imp.id,
    title: imp.name,
    linesUrl: imp.linesPng,
    labelsUrl: imp.labelsPng,
    imported: true,
  };
}

// QuotaExceededError is the standard DOMException name; some browsers use a
// numeric code (22) instead of the string name. Cover both.
function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as { name?: string; code?: number };
  return e.name === "QuotaExceededError" || e.code === 22;
}

export class StorageQuotaError extends Error {
  constructor() {
    super("Storage full — remove an imported picture and try again.");
    this.name = "StorageQuotaError";
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
  } catch (err) {
    if (isQuotaError(err)) throw new StorageQuotaError();
    throw err;
  }
}

export function addImportedPicture(input: {
  name: string;
  linesPng: string;
  labelsPng: string;
}): ImportedPicture {
  const id = `imported-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const entry: ImportedPicture = {
    id,
    name: input.name,
    linesPng: input.linesPng,
    labelsPng: input.labelsPng,
    addedAt: Date.now(),
  };
  // FIFO eviction at the cap. Evict before persisting so we don't permanently
  // bloat storage past the cap if a write succeeds and a later one fails.
  const next = [...imported, entry];
  while (next.length > IMPORT_CAP) next.shift();
  const previous = imported;
  imported = next;
  try {
    persist();
  } catch (err) {
    imported = previous;
    throw err;
  }
  events.emit("pictures:update", undefined);
  return entry;
}

export function removeImportedPicture(id: string): void {
  const next = imported.filter((p) => p.id !== id);
  if (next.length === imported.length) return;
  const previous = imported;
  imported = next;
  try {
    persist();
  } catch (err) {
    imported = previous;
    throw err;
  }
  events.emit("pictures:update", undefined);
}
