// Static catalog. Vite resolves the ?url imports at build time and gives us
// hashed asset URLs we can feed straight to Phaser's loader.

import appleLines from "../assets/apple_lines.png?url";
import appleLabels from "../assets/apple_labels.png?url";
import houseLines from "../assets/house_lines.png?url";
import houseLabels from "../assets/house_labels.png?url";
import starLines from "../assets/star_lines.png?url";
import starLabels from "../assets/star_labels.png?url";

export interface Picture {
  slug: string;
  title: string;
  linesUrl: string;
  labelsUrl: string;
}

export const PICTURES: Picture[] = [
  { slug: "apple", title: "Apple", linesUrl: appleLines, labelsUrl: appleLabels },
  { slug: "house", title: "House", linesUrl: houseLines, labelsUrl: houseLabels },
  { slug: "star", title: "Star", linesUrl: starLines, labelsUrl: starLabels },
];

export function findPicture(slug: string): Picture | undefined {
  return PICTURES.find((p) => p.slug === slug);
}
