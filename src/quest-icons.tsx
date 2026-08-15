import {
  BookOpen,
  Blocks,
  CloudSun,
  CupSoda,
  Footprints,
  Hand,
  Milk,
  Palette,
  PenLine,
  Rabbit,
  ScanFace,
  Sparkles,
  Sprout,
  Sun,
  Sunset,
  Trophy,
  Utensils,
  type LucideIcon,
} from "lucide-react";

const QUEST_ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Blocks,
  CloudSun,
  CupSoda,
  Footprints,
  Hand,
  Milk,
  Palette,
  PenLine,
  Rabbit,
  ScanFace,
  Sparkles,
  Sprout,
  Sun,
  Sunset,
  Utensils,
};

export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && QUEST_ICONS[name]) || Trophy;
}
