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
];

export function findPicture(slug: string): Picture | undefined {
  return PICTURES.find((p) => p.slug === slug);
}
