/**
 * The icon set (lucide, ISC licence; D-080). One icon per screen and per alert kind so the same
 * concept always looks the same.
 */
import {
  Banknote,
  Bell,
  Bomb,
  Cpu,
  Factory,
  FileText,
  Flag,
  FlaskConical,
  Flame,
  Handshake,
  Info,
  Landmark,
  LineChart,
  Newspaper,
  Radiation,
  Rocket,
  Satellite,
  Settings,
  Shield,
  Swords,
  TrendingDown,
  Eye,
  Bird,
  type LucideIcon,
} from 'lucide-react';

export type ScreenId =
  | 'budget'
  | 'economy'
  | 'production'
  | 'research'
  | 'diplomacy'
  | 'military'
  | 'summary'
  | 'settings'
  | 'nuclear'
  | 'battle'
  | 'escalation'
  | 'news'
  | 'wire';

export const SCREEN_ICON: Record<ScreenId, LucideIcon> = {
  budget: Banknote,
  economy: LineChart,
  production: Factory,
  research: FlaskConical,
  diplomacy: Handshake,
  military: Shield,
  summary: FileText,
  settings: Settings,
  nuclear: Radiation,
  battle: Swords,
  escalation: Flame,
  news: Newspaper,
  wire: Landmark,
};

export const ALERT_ICON: Record<string, LucideIcon> = {
  war: Swords,
  peace: Bird,
  battle: Swords,
  capture: Flag,
  diplomacy: Handshake,
  economy: TrendingDown,
  research: FlaskConical,
  event: Newspaper,
  nuclear: Radiation,
  production: Factory,
  capitulation: Flag,
  strike: Rocket,
  cyber: Cpu,
  space: Satellite,
  intel: Eye,
  info: Info,
  bomb: Bomb,
  alert: Bell,
};

