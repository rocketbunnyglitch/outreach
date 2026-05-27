/**
 * Data table primitives — Phase 1 of the Sheets-feel work.
 *
 * Import everything from "@/components/ui/data-table":
 *
 *   import {
 *     DataTable, DataTableHead, DataTableBody,
 *     SortableHeader, FilterRow, FilterTextInput, FilterChipSet,
 *     useColumnSort, useColumnFilter, parseSortParams, parseFilterParams,
 *     applyColumnFilters,
 *     useOptimisticMutation,
 *     InlineEditSelect, InlineEditDate,
 *   } from "@/components/ui/data-table";
 *
 * The text inline editor lives at @/components/ui/inline-cell (pre-existing).
 */

export {
  DataTable,
  DataTableHead,
  DataTableBody,
  SortableHeader,
  FilterRow,
  FilterTextInput,
  FilterChipSet,
  FilterCellEmpty,
} from "./data-table";

export {
  useColumnSort,
  parseSortParams,
  type ColumnSortEntry,
  type SortDirection,
  type UseColumnSortOptions,
  type UseColumnSortReturn,
} from "./use-column-sort";

export {
  useColumnFilter,
  parseFilterParams,
  applyColumnFilters,
  type UseColumnFilterReturn,
} from "./use-column-filter";

export {
  useOptimisticMutation,
  type MutationResult,
  type UseOptimisticMutationOptions,
  type UseOptimisticMutationReturn,
} from "./use-optimistic-mutation";

export { InlineEditSelect, type SelectOption } from "./inline-edit-select";
export { InlineEditDate } from "./inline-edit-date";

export {
  useRealtimeChannel,
  useRealtimeSubscription,
  formatRealtimeAgo,
  type RealtimeEvent,
  type UseRealtimeChannelOptions,
  type UseRealtimeChannelReturn,
} from "./use-realtime-channel";

export {
  usePresenceHeartbeat,
  type PresenceViewer,
  type UsePresenceHeartbeatOptions,
  type UsePresenceHeartbeatReturn,
} from "./use-presence-heartbeat";

export { PresenceAvatarStack, colorForStaff } from "./presence-avatar-stack";
