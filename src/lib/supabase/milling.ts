import type { Interval } from '../calculations/intervalCoverage'
import { supabase } from './client'

export interface ProjectOption {
  id: string
  contractNumber: string
  name: string
}

export interface SegmentCandidate {
  id: string
  direction: 'NB' | 'SB' | 'EB' | 'WB'
  fromStation: number
  toStation: number
  highway2FromStation: number | null
  highway2ToStation: number | null
  highway: string
}

export interface CurrentCrewMember {
  id: string
  name: string
  role: string
}

export interface WidthReadingRow {
  id: string
  direction: string
  stationSequence: number
  station: number
  width: number
  isCorrection: boolean
  supersededBy: string | null
  correctionReason: string | null
  entryTimestamp: string
}

export async function fetchProjects(): Promise<ProjectOption[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, contract_number, name')
    .order('contract_number')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    contractNumber: row.contract_number,
    name: row.name,
  }))
}

/**
 * All road_segments (both directions, every segment group) for a project,
 * in one call — the raw material segmentResolution.ts resolves a typed
 * station against. Deliberately not scoped to a single segment group: the
 * resolver itself decides which candidate a station belongs to (preferring
 * whichever segment is currently active), so the UI no longer needs the
 * person to manually pick a segment group/direction pair up front.
 */
export async function fetchProjectSegmentCandidates(projectId: string): Promise<SegmentCandidate[]> {
  const { data, error } = await supabase
    .from('road_segments')
    .select(
      'id, direction, from_station, to_station, highway_2_from_station, highway_2_to_station, road_segment_groups!inner(highway, jobs!inner(project_id))',
    )
    .eq('road_segment_groups.jobs.project_id', projectId)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    direction: row.direction,
    fromStation: Number(row.from_station),
    toStation: Number(row.to_station),
    highway2FromStation: row.highway_2_from_station === null ? null : Number(row.highway_2_from_station),
    highway2ToStation: row.highway_2_to_station === null ? null : Number(row.highway_2_to_station),
    highway: (row.road_segment_groups as unknown as { highway: string }).highway,
  }))
}

export async function fetchCurrentCrewMember(): Promise<CurrentCrewMember | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('crew_members')
    .select('id, name, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data
}

const WIDTH_READING_SELECT =
  'id, direction, station_sequence, station, width, is_correction, superseded_by, correction_reason, entry_timestamp'

function mapWidthReadingRow(row: {
  id: string
  direction: string
  station_sequence: number
  station: number
  width: number
  is_correction: boolean
  superseded_by: string | null
  correction_reason: string | null
  entry_timestamp: string
}): WidthReadingRow {
  return {
    id: row.id,
    direction: row.direction,
    stationSequence: row.station_sequence,
    station: Number(row.station),
    width: Number(row.width),
    isCorrection: row.is_correction,
    supersededBy: row.superseded_by,
    correctionReason: row.correction_reason,
    entryTimestamp: row.entry_timestamp,
  }
}

export async function fetchTodaysWidthReadings(
  roadSegmentId: string,
  date: string,
): Promise<WidthReadingRow[]> {
  const { data, error } = await supabase
    .from('width_readings')
    .select(WIDTH_READING_SELECT)
    .eq('road_segment_id', roadSegmentId)
    .eq('paving_date', date)
    .order('station_sequence', { ascending: true })
  if (error) throw error
  return (data ?? []).map(mapWidthReadingRow)
}

/**
 * One [min station, max station] interval per prior day that has active
 * (non-superseded) readings for this segment — the raw material for the
 * merge in intervalCoverage.ts. Excludes `excludeDate` (today) since that
 * day's coverage is computed live from the local Dexie queue instead, which
 * reflects not-yet-synced entries this server fetch wouldn't have yet.
 */
export async function fetchStationCoverageIntervals(
  roadSegmentId: string,
  excludeDate: string,
): Promise<Interval[]> {
  const { data, error } = await supabase
    .from('width_readings')
    .select('paving_date, station')
    .eq('road_segment_id', roadSegmentId)
    .is('superseded_by', null)
    .neq('paving_date', excludeDate)
  if (error) throw error

  const byDate = new Map<string, number[]>()
  for (const row of data ?? []) {
    const stations = byDate.get(row.paving_date)
    if (stations) stations.push(Number(row.station))
    else byDate.set(row.paving_date, [Number(row.station)])
  }

  return [...byDate.values()].map((stations) => ({
    lo: Math.min(...stations),
    hi: Math.max(...stations),
  }))
}

export async function insertWidthReading(params: {
  roadSegmentId: string
  direction: string
  date: string
  stationSequence: number
  station: number
  width: number
}): Promise<WidthReadingRow> {
  // entered_by is deliberately omitted — the server derives it from
  // auth.uid() via the DEFAULT + BEFORE INSERT trigger set up earlier; the
  // client never asserts who performed the entry.
  const { data, error } = await supabase
    .from('width_readings')
    .insert({
      road_segment_id: params.roadSegmentId,
      direction: params.direction,
      paving_date: params.date,
      station_sequence: params.stationSequence,
      station: params.station,
      width: params.width,
    })
    .select(WIDTH_READING_SELECT)
    .single()
  if (error) throw error
  return mapWidthReadingRow(data)
}

/**
 * Corrects an existing width_reading via the append-only supersede
 * workflow: insert a brand-new row with the corrected values, then point
 * the original at it. The original's row is never edited in place.
 *
 * The corrected row reuses the original's station_sequence — superseded
 * rows are always filtered out before any area calculation, so there's no
 * ordering conflict; the correction simply takes over that slot in the
 * field-entry sequence rather than getting appended at the end (which
 * would put it in the wrong position relative to readings taken after it).
 *
 * The second step (setting the original's superseded_by) is role-gated at
 * the database level: only the crew member who entered the original, or a
 * coordinator, may do this. A caller without that permission gets a clear
 * Postgres error, not a silent partial success — though note this does
 * leave the new row inserted even if the second step is rejected; the
 * caller should surface the error so the user knows the correction didn't
 * fully take effect.
 */
export async function supersedeWidthReading(params: {
  originalId: string
  roadSegmentId: string
  direction: string
  date: string
  stationSequence: number
  correctedStation: number
  correctedWidth: number
  reason: string
}): Promise<WidthReadingRow> {
  const { data: inserted, error: insertError } = await supabase
    .from('width_readings')
    .insert({
      road_segment_id: params.roadSegmentId,
      direction: params.direction,
      paving_date: params.date,
      station_sequence: params.stationSequence,
      station: params.correctedStation,
      width: params.correctedWidth,
      is_correction: true,
      correction_reason: params.reason,
    })
    .select(WIDTH_READING_SELECT)
    .single()
  if (insertError) throw insertError

  const { error: updateError } = await supabase
    .from('width_readings')
    .update({ superseded_by: inserted.id, correction_reason: params.reason })
    .eq('id', params.originalId)
  if (updateError) throw updateError

  return mapWidthReadingRow(inserted)
}
