import { useState } from 'react'
import { voidWidthReading } from '../../lib/supabase/milling'

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message
  }
  return fallback
}

// Same preset + custom-reason pattern as CorrectionForm's REASON_PRESETS,
// with wording specific to why a reading gets voided rather than corrected.
const VOID_REASON_PRESETS = [
  { id: 'duplicate', label: 'Duplicate entry' },
  { id: 'field-error', label: 'Entered in error' },
  { id: 'other', label: 'Other' },
] as const

type VoidReasonPresetId = (typeof VOID_REASON_PRESETS)[number]['id']

export function VoidReadingForm({
  readingId,
  station,
  width,
  onClose,
  onSaved,
  isPastDayVoid = false,
}: {
  readingId: string
  station: number
  width: number
  onClose: () => void
  onSaved?: () => void
  /** True when voiding a reading from a past day via the read-only review screen, not the current live session. */
  isPastDayVoid?: boolean
}) {
  const [reasonPreset, setReasonPreset] = useState<VoidReasonPresetId | null>(null)
  const [customReason, setCustomReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reason =
    reasonPreset === 'other' ? customReason.trim() : (VOID_REASON_PRESETS.find((p) => p.id === reasonPreset)?.label ?? '')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (reason === '') {
      setError(reasonPreset === 'other' ? 'Enter a reason for voiding this reading.' : 'Select a reason for voiding this reading.')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      await voidWidthReading(readingId, reason)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to void this reading.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="milling-correction-backdrop" onClick={onClose}>
      <form className="milling-correction-form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Void Reading</h2>
        <p className="milling-correction-original">
          {station} m, {width} m wide
        </p>

        <div className="milling-field">
          <span>Reason (required)</span>
          <div className="milling-reason-presets">
            {VOID_REASON_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={
                  'milling-reason-preset' + (reasonPreset === preset.id ? ' milling-reason-preset-selected' : '')
                }
                onClick={() => setReasonPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {reasonPreset === 'other' && (
          <label className="milling-field">
            <span>Describe the reason</span>
            <textarea
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              rows={3}
              placeholder="Why is this being voided?"
            />
          </label>
        )}

        {isPastDayVoid && (
          <p className="milling-correction-past-day-warning">This may affect previously calculated totals.</p>
        )}

        {error && <p className="milling-error">{error}</p>}

        <div className="milling-correction-actions">
          <button type="button" onClick={onClose} className="milling-cancel" disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="milling-submit" disabled={submitting}>
            {submitting ? 'Voiding…' : 'Void Reading'}
          </button>
        </div>
      </form>
    </div>
  )
}
