import { defineComponent, h, type Component } from 'vue'
import {
  ArrowDown as ChevronDown,
  ArrowRight as LucideArrowRight,
  Award,
  BarChart2,
  Briefcase,
  Calendar as LucideCalendar,
  Check as LucideCheck,
  CircleCheck,
  Clock,
  Copy,
  Download as LucideDownload,
  Eye,
  Grid as LucideGrid,
  Heart,
  Key as LucideKey,
  Layers,
  Link as LucideLink,
  Link2,
  List as LucideList,
  Lock as LucideLock,
  Moon as LucideMoon,
  Plus as LucidePlus,
  RefreshCw,
  Search as LucideSearch,
  Settings,
  Sun,
  Tag,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Upload,
  UserRound,
  UserRoundCheck,
  Users,
  X,
  ChevronsLeft,
  ChevronsRight
} from '@lucide/vue'

function lucideIcon(icon: Component, name: string) {
  return defineComponent({
    name: `Lucide${name}`,
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h(icon, { size: '1em', ...attrs })
    }
  })
}

export const ArrowDown = lucideIcon(ChevronDown, 'ArrowDown')
export const ArrowRight = lucideIcon(LucideArrowRight, 'ArrowRight')
export const Calendar = lucideIcon(LucideCalendar, 'Calendar')
export const Check = lucideIcon(LucideCheck, 'Check')
export const CircleCheckFilled = lucideIcon(CircleCheck, 'CircleCheck')
export const Close = lucideIcon(X, 'X')
export const Collection = lucideIcon(Layers, 'Layers')
export const Connection = lucideIcon(Link2, 'Link2')
export const CopyDocument = lucideIcon(Copy, 'Copy')
export const DataAnalysis = lucideIcon(BarChart2, 'BarChart2')
export const Delete = lucideIcon(Trash2, 'Trash2')
export const Download = lucideIcon(LucideDownload, 'Download')
export const Expand = lucideIcon(ChevronsRight, 'ChevronsRight')
export const Fold = lucideIcon(ChevronsLeft, 'ChevronsLeft')
export const Grid = lucideIcon(LucideGrid, 'Grid')
export const Key = lucideIcon(LucideKey, 'Key')
export const Link = lucideIcon(LucideLink, 'Link')
export const List = lucideIcon(LucideList, 'List')
export const Lock = lucideIcon(LucideLock, 'Lock')
export const Moon = lucideIcon(LucideMoon, 'Moon')
export const OfficeBuilding = lucideIcon(Briefcase, 'Briefcase')
export const Plus = lucideIcon(LucidePlus, 'Plus')
export const Refresh = lucideIcon(RefreshCw, 'RefreshCw')
export const Search = lucideIcon(LucideSearch, 'Search')
export const Setting = lucideIcon(Settings, 'Settings')
export const Sunny = lucideIcon(Sun, 'Sun')
export const Tickets = lucideIcon(Tag, 'Tag')
export const Timer = lucideIcon(Clock, 'Clock')
export const TrendCharts = lucideIcon(TrendingUp, 'TrendingUp')
export const UploadFilled = lucideIcon(Upload, 'Upload')
export const User = lucideIcon(UserRound, 'UserRound')
export const UserFilled = lucideIcon(UserRoundCheck, 'UserRoundCheck')
export const View = lucideIcon(Eye, 'Eye')
export const WarningFilled = lucideIcon(TriangleAlert, 'TriangleAlert')
